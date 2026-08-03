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
import { deflateSync, inflateSync } from "node:zlib";

import { TypedEmmiter } from "../base/event";
import { BinaryDecoder, getTextFromTextComponent } from "../translator/decoder";
import { BinaryEncoder } from "../translator/encoder";
import { ClientNotReady, MissingAuthOption, SockerIsNotWritable } from "../base/error";
import { computeUUID } from "../base/math";
import { If } from "../base/typing";
import { Angle, BaseVec3 } from "../physics/direction";
import { packBlockPos, SectionsPerChunk } from "./static";
import { AuthClient, AuthOption } from "./auth";
import { ClientStatus, ConnectionState, Entity, SharedState } from "../world/state";
import { EncodeResult, VersionCodec } from "../version/codec";
import { PacketRegistry } from "../version/registry";

// Minecraft related typing



// TCP related typing
export interface TCPClientOption {
    /** Server host */
    host: string,
    /** Server port */
    port: number,
    /**
     * Server protocol version.
     * 
     * Currentlt support `776` or version `26.2`
     * 
     * @see https://minecraft.wiki/w/Minecraft_Wiki:Projects/wiki.vg_merge/Protocol_version_numbers
     */
    protocolVersion: number,
    /** Player name */
    playerName: string,
    /**
     * Set to true only if you are playing in offline server or crack server
     */
    isOffline?: boolean,

    /**
     * Send empty `Known Packet` to let server send all Registry data, which may consume a lot of bandwith
     */
    loadRegistry?: boolean,

    debug?: {
        /** Log the incoming packet */
        packetLogger: boolean
    },

    // For premium account
    auth?: AuthOption
}

export interface TCPClientEvents {
    connect: [],
    disconnect: [reason: string],
    disconnectRaw: [textComponent: TextComponent],
    raw: [buf: Buffer],

    /** Whenever client is ready to use */
    ready: [readyClient: TCPClient<true>],

    // Position
    /** 
     * Sync player position.
     * 
     * Noted that this fired when recived packet from server, not from the internal movement, meaning that calling `input` function would not fire this event. 
     */
    playerPosition: [position: BaseVec3],

    /** Load chunk section */
    loadChunk: [chunkX: number, sectionY: number, chunkZ: number],
    /** Unload chunk column */
    unloadChunk: [chunkX: number, chunkZ: number],

    /** Spawn an entity */
    spawnEntity: [entity: Entity],
    /** Update spawned entity */
    updateEntity: [entity: Entity],
    /** Remove entity */
    removeEntity: [entityId: number],

    // Chat
    /** Message, usually sent from player */
    message: [message: Message],
    /** Parsed system message, usually sent from the console, plugins, etc... */
    systemMessage: [message: string],
    /** Raw system messgae */
    systemMessageRaw: [textComponent: TextComponent],
    /** Parsed action bar message, the message appeared above your hot bar */
    actionBar: [message: string],
    /** Raw action bar */
    actionBarRaw: [textComponent: TextComponent],
}

export interface Message {
    sender: string,
    target?: string,
    content: string,
    raw: {
        sender: TextComponent,
        target?: TextComponent,
        content?: TextComponent
    }
}


// export enum TCPServerIntent {
//     Status = 1,
//     Login = 2,
//     Transfer = 3,
// }

/**
 * Low-level client. You SHOULD NOT use this client unless you know what are you doing
 * 
 * @see https://minecraft.wiki/w/Java_Edition_protocol/Packets?oldid=3445844
 */
export class TCPClient extends (EventEmitter as new () => TypedEmmiter<TCPClientEvents>) {
    public readonly socket: Socket;

    // Internal var
    /**
     * | Value | Meaning |
     * |-------|---------|
     * | 0     |  not set yet |
     * | -1    | dont compress |
     * | > 0   | compression threshold |
     */
    private bufferPool: Buffer = Buffer.alloc(0);

    constructor(
        private state: SharedState,
        public readonly option: TCPClientOption,
        socketOption?: SocketConstructorOpts
    ) {
        super();
        this.socket = new Socket(socketOption);
        this.wipePlayData();

        if (!option.isOffline && !option.auth)
            throw new MissingAuthOption();
    }

    public sendInitPacket: () => void = () => { throw new Error("method not implemented"); };
    public forwardPacket: (packetId: number, decoder: BinaryDecoder) => void = (...args) => { throw new Error("method not implemented"); };
    public parsePacket: (packetId: string | number, data: object) => EncodeResult = (...args) => { throw new Error("method not implemented"); };

    /**
     * Connect to server
     */
    public async connect() {
        if (!this.playerUUID) {
            if (this.option.auth) {
                const authClient = new AuthClient(this.option.auth);
                const { uuid } = await authClient.auth();
                this.playerUUID = Buffer.from(uuid);
            } else
                this.playerUUID = computeUUID(this.option.playerName);
        }

        this.status = ClientStatus.Connecting;
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
            if (this.state.status === ClientStatus.Disconnected) return;
            this.state.status = ClientStatus.Disconnected;
            this.state.state = ConnectionState.Disconnected;
            // this.emit("disconnect", "socket close");
        });
        connection.once("close", () => {
            if (this.status === ClientStatus.Disconnected) return;
            this.status = ClientStatus.Disconnected;
            this.state = ClientState.Disconnected;
            this.emit("disconnect", "socket close");
        });
    }

    public disconnect() {
        if (!this.socket.closed)
            this.socket.destroy();
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
            if (this.state.compressionThreshold === 0)
                packetID = decoder.readVarInt();
            else if (this.state.compressionThreshold === -1) {
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
            this.forwardPacket(packetID, decoder);

            this.bufferPool = this.bufferPool.subarray(expectedPacketEnd);
        }
    }

    /*
    * Send packet 
    */

    public write(buf: Buffer) {
        if (this.status == ClientStatus.Disconnected || !this.socket.writable)
            throw new SockerIsNotWritable();

        let sendBuffer = buf;
        if (this.state.cipher)
            sendBuffer = this.state.cipher.update(sendBuffer);

        this.socket.write(sendBuffer);
    }

    public sendPacket(packetId: number | string, data: Record<string, any>) {
        const { buffer: content, packet } = this.parsePacket(packetId, data);
        const encodePacketId = new BinaryEncoder();
        encodePacketId.writeVarInt(packet.id);
        const sendData = Buffer.concat([encodePacketId.getBuffer(), content]);

        let sendingPacket: Buffer;
        if (this.state.compressionThreshold !== 0) {
            let data: Buffer;
            let uncompressedLength: number;

            if (this.state.compressionThreshold > 0 && sendData.length > this.state.compressionThreshold) {
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
            sendingPacket = Buffer.concat([packetLengthEncoder.getBuffer(), dataLengthBuf, data]);
        } else {
            const packetLengthEncoder = new BinaryEncoder();
            packetLengthEncoder.writeVarInt(sendData.length);
            sendingPacket = Buffer.concat([packetLengthEncoder.getBuffer(), sendData]);
        }

        this.write(sendingPacket);
    }

}