import { Socket, SocketConstructorOpts } from "node:net";
import { EventEmitter } from "node:events";
import {
    constants as crypto_constants,
    createPublicKey,
    publicEncrypt,
    randomBytes,
    createDecipheriv,
    createCipheriv,
    Cipheriv,
    Decipheriv
} from "node:crypto";

import { TypedEmmiter } from "../base/event";
import { BinaryDecoder } from "../translator/decoder";
import { BinaryEncoder } from "../translator/encoder";
import { SockerIsNotWritable } from "../base/error";
import { computeUUID } from "../base/player";
import { If } from "../base/typing";
import { Angle, Vec3 } from "../base/vector";
import { deflateSync, inflateSync } from "node:zlib";
import { packBlockPos, SectionsPerChunk } from "./static";

export interface TCPClientOption {
    host: string,
    port: number,
    protocolVersion: number,
    playerName: string,

    /**
     * Send empty `Known Packet` to let server send all Registry data, which may consume a lot of bandwith
     */
    loadRegistry?: boolean,

    debug?: {
        // Log packet
        packetLogger: boolean
    }
}

export interface TCPClientEvents {
    connect: [],
    disconnect: [reason: string],
    raw: [buf: Buffer],
    ready: []
}

export enum TCPClientStatus {
    Disconnected,
    Connecting,
    Logining,
    Ready,
}

export enum ClientState {
    Disconnected,
    Handshake,
    Login,
    Configure,
    Play
}

// export enum TCPServerIntent {
//     Status = 1,
//     Login = 2,
//     Transfer = 3,
// }

export interface Server {
    knownPacks?: ServerKnownPack,
    world?: ServerWorld
}

export interface ServerWorld {
    playerId: number,
    hardcore: boolean,
    dimensions: string[],
    maxPlayers: number,
    viewDistance: number,
    simulationDistance: number,
    gameMode: GameMode,

    /**
     * The record key is a chunk section position packed as `Chunk X:Section Y:Chunk Z`
     * 
     * For `Section Y`, a chunk is splitted into several cubic 16x16x16 sections, or in other word, a chunk is a bund of 16x16x16 sections stacked on each other.
     */
    chunks: Record<`${number}:${number}:${number}`, ChunkSection>,
    /**
     * The record key is entity ID
     */
    entities: Record<number, Entity>,
}

export interface ChunkSection {
    block: PaletteContainer,
    // blockEntities: any[], // TODO: Implement later
    biome: PaletteContainer,
}

export interface PaletteContainer {
    bpe: number, // Bit per entry
    palette: number[],
    data: BigInt64Array | null, // null if the whole section contains one 1 type of block
}

export interface BlockEntity {
    type: number,
    data: Record<string, any>
}

export interface Entity {
    type: number,
    position: Vec3,
    velocity: Vec3,
    angle: Angle,
    data: number
}

export enum GameMode {
    Survival = 0,
    Creative = 1,
    Adventure = 2,
    Spectator = 3
}

export interface ServerKnownPack {
    namespace: string,
    id: string,
    version: string
}

export interface ClientPlayer {
    uuid: string,
    username: string,

    position: Vec3,
    velocity: Vec3,
    angle: Angle,

    dimension: string
}

export interface ServerRegistryEntry {
    id: string,
    data: object
}

export class TCPClient<IsReady extends boolean> extends (EventEmitter as new () => TypedEmmiter<TCPClientEvents>) {
    public readonly socket: Socket;

    public server: Server | undefined = undefined;

    // Internal var
    /**
     * | Value | Meaning |
     * |-------|---------|
     * | 0     |  not set yet |
     * | -1    | dont compress |
     * | > 0   | compression threshold |
     */
    private compressionThreshold: number = 0;
    private bufferPool: Buffer = Buffer.alloc(0);
    public status: TCPClientStatus = TCPClientStatus.Disconnected;
    private state: ClientState = ClientState.Disconnected;

    // Encryption
    private sharedSecret: Buffer | undefined = undefined;
    private cipher: Cipheriv | undefined = undefined;
    private decipher: Decipheriv | undefined = undefined;

    // Play data
    public world?: If<IsReady, ServerWorld>;
    public player?: If<IsReady, ClientPlayer>;
    public registry?: If<IsReady, Record<string, ServerRegistryEntry[]>>;

    constructor(
        public readonly option: TCPClientOption,
        socketOption?: SocketConstructorOpts
    ) {
        // eslint-disable-next-line constructor-super
        super();
        this.socket = new Socket(socketOption);
        this.wipePlayData();
    }

    private wipePlayData() {
        this.world = null as any;
        this.player = null as any;
        this.registry = null as any;
    }

    /**
     * Connect to server
     */
    public connect() {
        this.status = TCPClientStatus.Connecting;
        const connection = this.socket.connect({
            host: this.option.host,
            port: this.option.port
        });

        connection.on("connect", () => {
            this.emit("connect");
            this.wipePlayData();
            this.sendHandshake();
            this.sendLoginStart();
        });
        connection.on("data", (data) => {
            let buf = Buffer.from(data);
            if (this.decipher) {
                buf = this.decipher.update(buf);
            }
            this.emit("raw", Buffer.from(buf));
            this.bufferPool = Buffer.concat([this.bufferPool, buf]);
            this.handlePacket();
        });
        connection.once("end", () => {
            if (this.status === TCPClientStatus.Disconnected) return;
            this.status = TCPClientStatus.Disconnected;
            this.emit("disconnect", "socket close");
        });
    }

    /*
     * Read packet
     */

    private handlePacket() {
        while (true) {
            if (this.bufferPool.length === 0) break;

            let decoder = new BinaryDecoder(this.bufferPool);
            let packetLength: number;
            try {
                packetLength = decoder.readVarInt();
            } catch (e) {
                break; // Not enough data to read VarInt
            }
            if (this.bufferPool.length - decoder.offset < packetLength) break;

            const expectedPacketEnd = decoder.offset + packetLength;

            let packetID: number;
            if (this.compressionThreshold === 0)
                packetID = decoder.readVarInt();
            else if (this.compressionThreshold === -1) {
                decoder.readVarInt();
                packetID = decoder.readVarInt();
            } else {
                const dataLength = decoder.readVarInt();
                if (dataLength === 0) {
                    packetID = decoder.readVarInt();
                } else {
                    const dataBuffer = this.bufferPool.subarray(decoder.offset, expectedPacketEnd);
                    const decompressed = inflateSync(dataBuffer);
                    decoder = new BinaryDecoder(decompressed);
                    packetID = decoder.readVarInt();
                }
            }

            // Debug
            if (this.option.debug?.packetLogger)
                console.dir({
                    state: ClientState[this.state],
                    packetID: "0x" + packetID.toString(16),
                    length: decoder.buffer.length
                });

            switch (packetID) {
                case 0x00:
                    if (this.state === ClientState.Login) this.handleLoginDisconnect();
                    break;
                case 0x01:
                    if (this.state === ClientState.Login) this.handleEncryption(decoder);
                    if (this.state === ClientState.Play) this.handleSpawnEntity(decoder);
                    break;
                case 0x02:
                    if (this.state === ClientState.Login) this.handleLoginSucess(decoder);
                    break;
                case 0x03:
                    if (this.state === ClientState.Login) this.handleSetCompression(decoder);
                    if (this.state === ClientState.Configure) this.sendConfigureAck();
                    break;
                case 0x07:
                    if (this.state === ClientState.Configure) this.handleRegistryData(decoder);
                    break;
                case 0x0A:
                    if (this.state === ClientState.Play) this.handleChangeGameMode(decoder);
                    break;
                case 0x23:
                    if (this.state === ClientState.Play) this.handleTeleportEntity(decoder);
                    break;
                case 0x2C:
                    if (this.state === ClientState.Play) this.handleChunkData(decoder);
                    break;
                case 0x0E:
                    if (this.state === ClientState.Configure) this.handleKnownPack(decoder);
                    break;
                case 0x2B:
                    if (this.state === ClientState.Play) this.handleKeepAlive(decoder);
                    break;
                case 0x30:
                    if (this.state === ClientState.Play) this.handlePlayLogin(decoder);
                    break;
                case 0x46:
                    if (this.state === ClientState.Play) this.handleSynchronizePlayerPosition(decoder);
                    break;
            }

            this.bufferPool = this.bufferPool.subarray(expectedPacketEnd);
        }
    }

    // Login

    private handleLoginDisconnect() {
        // Need to handle JSON Text component
        this.status = TCPClientStatus.Disconnected;
        this.wipePlayData();

        this.emit("disconnect", "server close connection");
        if (!this.socket.closed) this.socket.destroy();
    }

    private handleEncryption(decoder: BinaryDecoder) {
        const serverId = decoder.readString(); // Should be ignored in 1.7+ server
        const publicKey = decoder.readRawPrefixedArray(8);
        const verifyToken = decoder.readRawPrefixedArray(8);
        const shoudlCallMojang = decoder.readBoolean(); // I'm too lazy to do this D:

        const sharedSecret = randomBytes(16);
        this.sharedSecret = sharedSecret;
        this.cipher = createCipheriv("aes-128-cfb8", this.sharedSecret, this.sharedSecret);
        this.decipher = createDecipheriv("aes-128-cfb8", this.sharedSecret, this.sharedSecret);

        this.sendEncryptionResponse(publicKey, verifyToken);
    }

    private handleSetCompression(decoder: BinaryDecoder) {
        const threshold = decoder.readVarInt();
        if (threshold < 0) this.compressionThreshold = -1;
        else this.compressionThreshold = threshold;
    }

    private handleLoginSucess(decoder: BinaryDecoder) {
        const uuid = decoder.readUUID();
        const username = decoder.readString();
        this.player = {
            uuid,
            username,

            position: {
                x: 0,
                y: 0,
                z: 0,
            },
            velocity: {
                x: 0,
                y: 0,
                z: 0,
            },
            angle: {
                yaw: 0,
                pitch: 0,
            }
        } as ClientPlayer as any;
        this.sendLoginAck();
    }

    // Configure

    private handleKnownPack(decoder: BinaryDecoder) {
        const packs = decoder.readPrefixedArray((decoder) => ({
            namespace: decoder.readString(),
            id: decoder.readString(),
            version: decoder.readString()
        }));
        this.server!.knownPacks = packs as any;
        this.sendKnownPack(this.option.loadRegistry ? [] : packs);
    }

    private handleRegistryData(decoder: BinaryDecoder) {
        const id = decoder.readString();
        const entries = decoder.readPrefixedArray((decoder) => ({
            id: decoder.readString(),
            data: decoder.readPrefixedOptional((decoder) => decoder.readNBT())
        }));

        if (!this.registry) this.registry = {} as any;
        const registry = this.registry as Record<string, any[]>;
        if (!(id in registry)) registry[id] = [];
        registry[id]!.push(...entries);
        console.dir({ id });
    }

    // Play

    private handlePlayLogin(decoder: BinaryDecoder) {
        const entityId = decoder.readInt();
        const isHardcore = decoder.readBoolean();
        const dimensions = decoder.readPrefixedArray((decoder) => decoder.readString());
        const maxPlayers = decoder.readVarInt();
        const viewDistance = decoder.readVarInt();
        const simulationDistance = decoder.readVarInt();
        decoder.readBoolean(); // Reduced Debug Info
        decoder.readBoolean(); // Enable respawn screen 
        decoder.readBoolean(); // Do limited crafting
        decoder.readVarInt(); // Dimension Type
        const dimensionName = decoder.readString();
        decoder.readLong(); // Hashed seed
        const gameMode = decoder.readUByte();

        this.world = {
            playerId: entityId,
            hardcore: isHardcore,
            dimensions,
            maxPlayers,
            viewDistance,
            simulationDistance,
            gameMode,
            chunks: {}
        } as ServerWorld as any; // To avoid type conflict
        this.player!.dimension = dimensionName;

        this.emit("ready", this as TCPClient<true>);
    }

    private handleSynchronizePlayerPosition(decoder: BinaryDecoder) {
        const teleportId = decoder.readVarInt();
        const x = decoder.readDouble(),
            y = decoder.readDouble(),
            z = decoder.readDouble(),
            velX = decoder.readDouble(),
            velY = decoder.readDouble(),
            velZ = decoder.readDouble(),
            yaw = decoder.readFloat(),
            pitch = decoder.readFloat();
        const flag = decoder.readTeleportFlag();

        const { position, velocity, angle } = this.player!;
        let { x: newPosX, y: newPosY, z: newPosZ } = position;
        let { x: newVelX, y: newVelY, z: newVelZ } = velocity;
        let { yaw: newYaw, pitch: newPitch } = angle;
        if (flag.x) newPosX += x; else newPosX = x;
        if (flag.y) newPosY += y; else newPosY = y;
        if (flag.z) newPosZ += z; else newPosZ = z;
        if (flag.velX) newVelX += velX; else newVelX = velX;
        if (flag.velY) newVelY += velY; else newVelY = velY;
        if (flag.velZ) newVelZ += velZ; else newVelZ = velZ;
        if (flag.yaw) newYaw += yaw; else newYaw = yaw;
        if (flag.pitch) newPitch += pitch; else newPitch = pitch;

        this.player = {
            position: {
                x: newPosX,
                y: newPosY,
                z: newPosZ
            },
            velocity: {
                x: newVelX,
                y: newVelY,
                z: newVelZ
            },
            angle: {
                yaw: newYaw,
                pitch: newPitch
            }
        } as any;
        this.sendConfirmTeleportation(teleportId);
    }

    private handleKeepAlive(decoder: BinaryDecoder) {
        const aliveID = decoder.readLong();
        this.sendKeepAlive(aliveID);
    }

    private handleChangeGameMode(decoder: BinaryDecoder) {
        const gameMode = decoder.readUByte();
        this.world!.gameMode = gameMode;
    }

    // Chunk
    private handleChunkData(decoder: BinaryDecoder) {
        const chunkX = decoder.readInt(),
            chunkZ = decoder.readInt(),
            heightMap = decoder.readPrefixedArray(decoder => ({
                type: decoder.readVarInt(),
                data: decoder.readPrefixedArray(decoder => decoder.readLong())
            })), // Not used yet
            chunkData = decoder.readPrefixedArray(decoder => decoder.readByte()),
            blockEntities = decoder.readPrefixedArray(decoder => {
                const packedXZ = decoder.readUByte(),
                    y = decoder.readShort(),
                    type = decoder.readVarInt(),
                    nbt = decoder.readNBT();
                const x = packedXZ >> 4, z = packedXZ & 15;
                return { x, y, z, type, nbt };
            });


        const chunkDataDecoder = new BinaryDecoder(Buffer.from(chunkData));
        for (let height = 0; height < (SectionsPerChunk[this.world!.dimensionName] || 0); height++) {
            const blockCount = chunkDataDecoder.readShort();
            // const fluidCount = chunkDataDecoder.readShort(); // Since 21.1

            // Blocks
            let blockStateBPE = chunkDataDecoder.readUByte();
            let blockStatePalettes: number[] = [];

            if (blockStateBPE === 0) {
                blockStatePalettes = [chunkDataDecoder.readVarInt()];
            } else if (blockStateBPE <= 8) {
                // Indirect palette
                if (blockStateBPE < 4) blockStateBPE = 4; // BPE smaller than 4 ưill be rounđe up to 4
                blockStatePalettes = chunkDataDecoder.readPrefixedArray(decoder => decoder.readVarInt());
            } else {
                // Direct palette (no palette array)
            }

            const blockEntriesPerSection = 4096;
            const blockEntriesPerLong = Math.floor(64 / blockStateBPE);
            let blockDataArray: BigInt64Array | null = null;
            if (blockStateBPE !== 0) {
                const blockDataArrayLength = Math.floor((blockEntriesPerSection + blockEntriesPerLong - 1) / blockEntriesPerLong);
                blockDataArray = new BigInt64Array(chunkDataDecoder.readArray(blockDataArrayLength, (decoder) => decoder.readLong()));
            }


            // Biomes - Not used yet, but need to be read to advance decoder
            const biomeBPE = chunkDataDecoder.readUByte();
            let biomePalettes: number[] = [];
            if (biomeBPE === 0) {
                biomePalettes = [chunkDataDecoder.readVarInt()]; // Palette value
            } else if (biomeBPE <= 3) {
                // Indirect palette
                biomePalettes = chunkDataDecoder.readPrefixedArray(decoder => decoder.readVarInt());
            } else {
                // Direct palette (no palette array)
            }

            const biomeEntriesPerSection = 64;
            const biomeEntriesPerLong = Math.floor(64 / biomeBPE);
            let biomeDataArray: BigInt64Array | null = null;
            if (biomeBPE !== 0) {
                const biomeDataArrayLength = Math.floor((biomeEntriesPerSection + biomeEntriesPerLong - 1) / biomeEntriesPerLong);
                biomeDataArray = new BigInt64Array(chunkDataDecoder.readArray(biomeDataArrayLength, (decoder) => decoder.readLong()));
            }

            this.world!.chunks[`${chunkX}:${height}:${chunkZ}`] = {
                block: {
                    bpe: blockStateBPE,
                    palette: blockStatePalettes,
                    data: blockDataArray
                },
                biome: {
                    bpe: biomeBPE,
                    palette: biomePalettes,
                    data: biomeDataArray
                }
            };
        const blockEntitiesObj: Record<number, BlockEntity> = Object.fromEntries(
            blockEntities.map(val => [val.packedPosition, { type: val.type, data: val.nbt }])
        );
    private handleBlockEntityData(decoder: BinaryDecoder) {
        const location = decoder.readPosition(),
            type = decoder.readVarInt(),
            data = decoder.readNBT();

        const chunkX = Math.floor(location.x / 16),
            chunkZ = Math.floor(location.z / 16);
        const xWitinChunk = location.x % 16,
            zWitinChunk = location.z % 16;
        const packedPosition = packBlockPos(xWitinChunk, location.y, zWitinChunk);
        if (`${this.player!.dimension}:${chunkX}:${chunkZ}` in this.world!.chunks)
            this.world!.chunks[`${this.player!.dimension}:${chunkX}:${chunkZ}`]!.blockEntities[packedPosition] = {
                type,
                data
            };
    }

    // Entity
    private handleSpawnEntity(decoder: BinaryDecoder) {
        const id = decoder.readVarInt(),
            UUID = decoder.readUUID(),
            type = decoder.readVarInt(),
            x = decoder.readDouble(),
            y = decoder.readDouble(),
            z = decoder.readDouble(),
            velocity = decoder.readLpVec3(),
            pitch = decoder.readAngle(),
            yaw = decoder.readAngle(),
            headYaw = decoder.readAngle(),
            data = decoder.readVarInt();

        this.world!.entities[id] = {
            type,
            position: new Vec3(x, y, z),
            velocity,
            angle: {
                pitch,
                yaw
            },
            data
        };
    }

    private handleTeleportEntity(decoder: BinaryDecoder) {
        const id = decoder.readVarInt(),
            x = decoder.readDouble(),
            y = decoder.readDouble(),
            z = decoder.readDouble(),
            velX = decoder.readDouble(),
            velY = decoder.readDouble(),
            velZ = decoder.readDouble(),
            pitch = decoder.readAngle(),
            yaw = decoder.readAngle();

        if (id in this.world!.entities) {
            this.world!.entities[id]!.position = new Vec3(x, y, z);
            this.world!.entities[id]!.velocity = new Vec3(velX, velY, velZ);
            this.world!.entities[id]!.angle = { pitch, yaw };
        }
    }

    private handleUpdateEntityPosition(decoder: BinaryDecoder) {
        const id = decoder.readVarInt(),
            delX = decoder.readFixedPoint(decoder.readShort(), 12),
            delY = decoder.readFixedPoint(decoder.readShort(), 12),
            delZ = decoder.readFixedPoint(decoder.readShort(), 12);

        if (id in this.world!.entities) {
            let {x, y, z} = this.world!.entities[id]!.position;
            x += delX;
            y += delY;
            z += delZ;
            this.world!.entities[id]!.position = new Vec3(x, y, z);
        }
    }

    /*
     * Send packet 
     */

    private write(buf: Buffer) {
        if (this.status == TCPClientStatus.Disconnected || !this.socket.writable)
            throw new SockerIsNotWritable();

        let sendBuffer = buf;
        if (this.cipher)
            sendBuffer = this.cipher.update(sendBuffer);

        this.socket.write(sendBuffer);
    }

    private sendPacket(packetId: number, content: Buffer) {
        const encodePacketId = new BinaryEncoder();
        encodePacketId.writeVarInt(packetId);
        const sendData = Buffer.concat([encodePacketId.getBuffer(), content]);

        let packet: Buffer;
        if (this.compressionThreshold !== 0) {
            let data: Buffer;
            let uncompressedLength: number;

            if (this.compressionThreshold > 0 && sendData.length > this.compressionThreshold) {
                uncompressedLength = sendData.length;
                data = deflateSync(sendData);
            } else {
                uncompressedLength = 0;
                data = sendData;
            }

            const dataLengthEncoder = new BinaryEncoder();
            dataLengthEncoder.writeVarInt(uncompressedLength);
            const dataLengthBuf = dataLengthEncoder.getBuffer();

            const packetLengthEncoder = new BinaryEncoder();
            packetLengthEncoder.writeVarInt(dataLengthBuf.length + data.length);
            packet = Buffer.concat([packetLengthEncoder.getBuffer(), dataLengthBuf, data]);
        } else {
            const packetLengthEncoder = new BinaryEncoder();
            packetLengthEncoder.writeVarInt(sendData.length);
            packet = Buffer.concat([packetLengthEncoder.getBuffer(), sendData]);
        }

        this.write(packet);
    }

    // Login

    private sendHandshake() {
        this.state = ClientState.Handshake;
        const encoder = new BinaryEncoder();
        encoder.writeVarInt(this.option.protocolVersion);
        encoder.writeString(this.option.host);
        encoder.writeUShort(this.option.port);
        encoder.writeVarInt(2);
        this.sendPacket(0x00, encoder.getBuffer());
    }

    private sendLoginStart() {
        this.state = ClientState.Login;
        this.status = TCPClientStatus.Logining;
        const encoder = new BinaryEncoder();
        const playerName = this.option.playerName;
        const playerUUID = computeUUID(playerName);
        encoder.writeString(playerName);
        encoder.concat(playerUUID);
        this.sendPacket(0x00, encoder.getBuffer());
    }

    private sendEncryptionResponse(publicKey: Buffer, verifyToken: Buffer) {
        const encryptedSecret = publicEncrypt({
            key: createPublicKey({ key: publicKey, format: 'der', type: 'spki' }),
            padding: crypto_constants.RSA_PKCS1_PADDING
        }, this.sharedSecret!);
        const encryptedVerifyToken = publicEncrypt({
            key: createPublicKey({ key: publicKey, format: 'der', type: 'spki' }),
            padding: crypto_constants.RSA_PKCS1_PADDING
        }, verifyToken);
        const encoder = new BinaryEncoder();
        encoder.writeRawPrefixedArray(encryptedSecret, 8);
        encoder.writeRawPrefixedArray(encryptedVerifyToken, 8);
        this.sendPacket(0x01, encoder.getBuffer());
    }

    private sendLoginAck() {
        this.state = ClientState.Configure;
        this.server = {};
        this.sendPacket(0x03, Buffer.alloc(0));
    }

    // Configuring

    private sendKnownPack(knownPacks: ServerKnownPack[]) {
        const encoder = new BinaryEncoder();
        encoder.writePrefixedArray(knownPacks.length, (encoder, ind) => {
            const pack = knownPacks[ind]!;
            return encoder
                .writeString(pack.namespace)
                .writeString(pack.id)
                .writeString(pack.version);
        });
        this.sendPacket(0x07, encoder.getBuffer());
    }

    private sendConfigureAck() {
        this.state = ClientState.Play;
        this.status = TCPClientStatus.Ready;
        this.sendPacket(0x3, Buffer.alloc(0));
    }

    // Play

    private sendConfirmTeleportation(teleportId: number) {
        const encoder = new BinaryEncoder();
        encoder.writeVarInt(teleportId);
        this.sendPacket(0, encoder.getBuffer());
    }

    private sendKeepAlive(id: bigint) {
        const encoder = new BinaryEncoder();
        encoder.writeLong(id);
        this.sendPacket(0x1B, encoder.getBuffer());
    }
}