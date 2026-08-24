import { Cipheriv, Decipheriv } from "node:crypto";
import { If } from "../base/typing";
import { Angle, BaseVec3 } from "../physics/direction";
import { AuthRelatedNotFound, ClientNotReady } from "../base/error";
import { ClientEvents, ClientOption } from "../client/client";
import { AuthClient } from "../client/auth";
import { MessageLink } from "../message/link";
import { SignatureCache } from "../message/sigCache";

export interface Server {
    knownPacks?: ServerKnownPack
}

export interface ServerKnownPack {
    namespace: string,
    id: string,
    version: string
}

/**
 * Represent world information
 */
export interface ServerWorld {
    /** Is hardcore enabled */
    hardcore: boolean,
    /** All dimensions */
    dimensions: string[],
    /** Max players allowed */
    maxPlayers: number,
    /** View distances */
    viewDistance: number,
    /** Simulation distance */
    simulationDistance: number,

    /**
     * The record key is a chunk section position packed as `Player Dimension:Chunk X:Chunk Z[Section Y]`
     * 
     * For `Section Y`, a chunk is splitted into several cubic 16x16x16 sections, or in other word, a chunk is a bund of 16x16x16 sections stacked on each other.
     */
    chunks: Record<string, ChunkColumn>,
    /**
     * The record key is entity ID
     */
    entities: Record<number, Entity>,
}

/** 
 * Represent a chunk collumns, which may contains multiple chunks sections 
 */
export interface ChunkColumn {
    sections: Record<number, ChunkSection>,
    blockEntities: Record<number, BlockEntity>
}

export interface ChunkSection {
    block: PaletteContainer,
    biome: PaletteContainer,
}

/**
 * Used for indirect mapping
 * 
 * @see https://minecraft.wiki/w/Java_Edition_protocol/Chunk_format#Paletted_Container_structure
 */
export interface PaletteContainer {
    bpe: number, // Bit per entry
    palette: number[],
    data: BigInt64Array | null, // null if the whole section contains one 1 type of block
}

/** Represent a block entity */
export interface BlockEntity {
    type: number,
    data: Record<string, any>
}

/** Represent an entity */
export interface Entity {
    id: number,
    type: number,
    position: BaseVec3,
    velocity: BaseVec3,
    angle: Angle,
    data: number
}

export enum GameMode {
    Survival = 0,
    Creative = 1,
    Adventure = 2,
    Spectator = 3
}

export interface ClientPlayer {
    /** Player UUID */
    uuid: string,
    /** Player username */
    username: string,
    /** Player entity ID */
    entityId: number,
    /** Current game mode */
    gameMode: GameMode,

    position: BaseVec3,
    velocity: BaseVec3,
    angle: Angle,

    /** Current dimension */
    dimension: string
}

export enum ClientStatus {
    Disconnected,
    Connecting,
    Logining,
    Ready,
}

export enum ConnectionState {
    Disconnected,
    Handshake,
    Login,
    Configure,
    Play
}

export interface ServerRegistryEntry {
    id: string,
    data: object
}

export type MutateState = (state: SharedState) => void;
export type EmittedEvent = {
    [K in keyof ClientEvents]: { event: K, args: ClientEvents[K] }
}[keyof ClientEvents]
export type SendingPacket = {
    id: string | number,
    data: Record<string, any>
}

export class SharedState<IsReady extends boolean = boolean> {
    private mutationQueue: MutateState[] = [];
    private eventQueue: EmittedEvent[] = [];
    private packetQueue: SendingPacket[] = [];

    public state: ConnectionState = ConnectionState.Disconnected;
    public status: ClientStatus = ClientStatus.Disconnected;
    public compressionThreshold: number = 0;

    // Auth stuffs
    public authClient: AuthClient | undefined = undefined;
    public playerUUID: string | undefined = undefined;
    public publicKey: Buffer | undefined = undefined;
    public signature: Buffer | undefined = undefined;
    public signatureExpireTime: number | undefined = undefined;
    // eslint-disable-next-line no-undef
    private signatureTimeoutInstance: NodeJS.Timeout | undefined = undefined;

    public sharedSecret: Buffer | undefined = undefined;
    public cipher: Cipheriv | undefined = undefined;
    public decipher: Decipheriv | undefined = undefined;
    public useEncryption: boolean = false;
    public sessionID: Buffer | undefined = undefined;

    public server: Server | undefined = undefined;
    public registry: Record<string, ServerRegistryEntry[]> | undefined = undefined;
    public world: If<IsReady, ServerWorld> = null as any;
    public player: If<IsReady, ClientPlayer> = null as any;

    /**
     * For maintaining message order.
     * 
     * A UUID map to a MessageLink.
     */
    public messageLinks: Record<string, MessageLink> | undefined = undefined;
    public messageSignatureCache: SignatureCache | undefined = undefined;

    constructor(
        public clientOptions: ClientOption,
    ) { }

    public isReady(): this is SharedState<true> {
        return this.status === ClientStatus.Ready;
    }

    public checkReady() {
        if (!this.isReady())
            throw new ClientNotReady();
    }

    public pruneStates() {
        this.mutationQueue = [];
        this.eventQueue = [];
        this.packetQueue = [];

        this.state = ConnectionState.Disconnected;
        this.status = ClientStatus.Disconnected;
        this.compressionThreshold = 0;

        this.authClient = undefined;
        this.playerUUID = undefined;
        this.publicKey = undefined;
        this.signature = undefined;

        this.sharedSecret = undefined;
        this.cipher = undefined;
        this.decipher = undefined;
        this.useEncryption = false;
        this.sessionID = undefined;
        this.signatureTimeoutInstance = undefined;

        this.server = undefined;
        this.registry = undefined;
        this.world = undefined as any;
        this.player = undefined as any;

        if (this.clientOptions.shouldVerifyMessageSignature)
            this.messageSignatureCache = SignatureCache.default();
        else
            this.messageSignatureCache = undefined;
        if (this.clientOptions.shouldVerifyMessageOrder)
            this.messageLinks = {};
        else
            this.messageLinks = undefined;
    }

    public getSignature() {
        if (this.publicKey && this.signature)
            return {
                publicKey: this.publicKey,
                signature: this.signature
            };
        throw new AuthRelatedNotFound("public key and signature");
    }

    private async fetchSignature() {
        if (!this.authClient)
            throw new AuthRelatedNotFound("instance of class AuthClient");
        const { publicKey, signature, expiresAt } = await this.authClient.getKeyPair();
        this.publicKey = Buffer.from(publicKey);
        this.signature = Buffer.from(signature);
        return expiresAt;
    }
    public async startSignatureLoop() {
        const expiresAt = await this.fetchSignature();
        this.signatureTimeoutInstance = setTimeout(
            async () => await this.startSignatureLoop(), 
            expiresAt - Date.now() - 10_000
        );
    }
    public stopSignatureLoop() {
        clearTimeout(this.signatureTimeoutInstance);
    }

    public enqueueMutation(mutation: MutateState) { this.mutationQueue.push(mutation); }

    public enqueuePacket(packet: string, data: object): void
    public enqueuePacket(packet: SendingPacket): void
    public enqueuePacket(packet: SendingPacket | string, data?: object) {
        if (typeof packet === "string")
            this.packetQueue.push({
                id: packet,
                data: data!
            });
        else
            this.packetQueue.push(packet);
    }

    public enqueueEvent<K extends keyof ClientEvents>(event: K, ...args: ClientEvents[K]): void
    public enqueueEvent(event: EmittedEvent): void
    public enqueueEvent(event: EmittedEvent, ...args: any[]) {
        if (typeof event === "string")
            this.eventQueue.push({
                event,
                args: args as any
            });
        else
            this.eventQueue.push(event);
    }

    public drainMutation() {
        while (true) {
            const mutation = this.mutationQueue.shift();
            if (mutation)
                mutation(this);
            else
                break;
        }
    }
    public drainEvent(consumer: (event: EmittedEvent) => void) {
        while (true) {
            const event = this.eventQueue.shift();
            if (event)
                consumer(event);
            else
                break;
        }
    }
    public drainPacket(consumer: (packet: SendingPacket) => void) {
        while (true) {
            const packet = this.packetQueue.shift();
            if (packet)
                consumer(packet);
            else
                break;
        }
    }
}