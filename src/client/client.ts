import { EventEmitter } from "node:events";
import { BlockManager, BlockState } from "../world/block";
import { EntitiesManager } from "../world/entity";
import { Input, Player } from "../physics/player";
import { TickLoop } from "../world/tick";
import { Message, TCPClient, TCPClientOption } from "../net/tcp";
import { TypedEmmiter as TypedEmitter } from "../base/event";
import { BlockRegistry, EffectRegistry, EntityRegistry, PacketRegistry, ProtocolVersionMapping } from "../version/registry";
import { BaseVec3, Vec3 } from "../physics/direction";
import { TextComponent } from "../base/typing";
import { ClientStatus, ConnectionState, EmittedEvent as EmittedEvent, Entity, SharedState } from "../world/state";
import { Listener } from "../packet/listener";
import { VersionCodec } from "../version/codec";
import { AuthClient } from "./auth";
import { computeUUID } from "../base/math";
import { HaveSignatureButNotIndex } from "../base/error";
import { Sender } from "../packet/sender";
import { CacheImplementation } from "../base/cache";

export type ClientOption = Omit<TCPClientOption, "protocolVersion"> & {
    version: string,

    /**
     * Whenever should the client verify the message against the signature, if any
     * 
     * When set this option to true, you HAVE TO set `shouldVerifyMessageOrder` to true
     */
    shouldVerifyMessageSignature?: boolean,

    /**
     * Should verify the message orders to keep the sync with server.
     */
    shouldVerifyMessageOrder?: boolean,

    /**
     * Whether to load the whole chunk section (16x16x16) and keep them in the cache or just load the needed block.
     * 
     * Please consider this carefully since this can consume a lot of resource to calculate the whole chunk section and store it while you may not need that much.
     * 
     * This option is useful when you have to constantly access to the world chunk, e.g pathfinding.
     */
    loadAndCacheChunk?: boolean,

    /**
     * Custom cache class. Default to `LRUCache`
     */
    cacheImplementation?: new () => CacheImplementation<Uint16Array>,
}

export interface ClientEvents {
    // TCP Events
    /** When the TCP socket connect is initted sucessfully */
    connect: [],
    /** When the TCP socket connection is destroyed */
    destroy: [],

    /**
     * When the client is ready.
     * 
     * Specifically, when the packet `Login (play)` is received
     */
    ready: [],
    /**
     * When the client got disconnected from sevrer
     */
    disconnect: [reason: string],
    /**
     * When the disconection come with the raw Text Component
     */
    disconnectRaw: [textComponent: TextComponent],

    /**
     * When server send `Player Position Synchronization` packet
     * 
     * Note: this event is not fired when the client is moved by holding the input
     */
    playerPosition: [position: BaseVec3],

    /** When the chunk is loaded */
    loadChunk: [chunkX: number, sectionY: number, chunkZ: number],
    /** When the chunk got deleted by the server */
    unloadChunk: [chunkX: number, chunkZ: number],

    /** When an entity is spawned or appeared in the client view distance */
    spawnEntity: [entity: Entity],
    /** When an entity is updated, including position, rotation, etc... */
    updateEntity: [entityId: number],
    /** When an entity go out of client view distance or despawned */
    removeEntity: [entityId: number],

    // Chat
    /** When a chat message got broadcasted */
    message: [message: Message],
    /** When a message is failed to be verified against the signature sent with it */
    failedMessage: [message: Message],
    /** The system message */
    systemMessage: [message: string],
    /** The raw system message */
    systemMessageRaw: [textComponent: TextComponent],
    /** The action bar */
    actionBar: [message: string],
    /** The raw action bar */
    actionBarRaw: [textComponent: TextComponent],
}

/**
 * High-level client.
 */
export class Client<IsReady extends boolean = boolean> extends (EventEmitter as new () => TypedEmitter<ClientEvents>) {
    private static loadRegistry: boolean = false;

    private tickLoop: TickLoop;

    private blocks: BlockManager;
    private entities: EntitiesManager;
    private player: Player;

    private tcp: TCPClient;
    private state: SharedState<IsReady>;
    private packetListener: Listener;
    private packetSender: Sender;

    constructor(private options: ClientOption) {
        if (options.shouldVerifyMessageSignature === true && options.shouldVerifyMessageOrder !== true)
            throw new HaveSignatureButNotIndex();

        super();

        // For managing shared data
        this.state = new SharedState(options);
        // For handling packet
        this.packetSender = new Sender(this.state, this.emit.bind(this));
        this.packetListener = new Listener(this.state, this.emit.bind(this), this.packetSender);
        // For reading packet
        const versionCodec = new VersionCodec(this.state);
        // For throwing packet through internet
        this.tcp = new TCPClient(
            this.state,
            {
                ...options,
                protocolVersion: ProtocolVersionMapping[options.version]!
            }
        );

        this.tcp.forwardPacket = versionCodec.handlePacket.bind(versionCodec);
        this.tcp.parsePacket = versionCodec.encodePacket.bind(versionCodec);
        this.tcp.sendInitPacket = () => {
            this.packetSender.sendHandshake();
            this.packetSender.sendLoginStart();
        };
        this.packetSender.sendPacket = this.tcp.sendPacket.bind(this.tcp);
        this.packetListener.disconnect = this.disconnect.bind(this);
        versionCodec.consumePacket = this.packetListener.handlePacket.bind(this.packetListener);

        // For querying data
        this.blocks = new BlockManager(this.state);
        this.entities = new EntitiesManager(this.state);
        // For physics things
        this.player = new Player(
            this.state,
            this.on,
            this.entities,
            this.blocks,
        );
        this.player.sendPlayerPos = this.packetSender.sendPlayerPos;
        this.player.sendPlayerPosRot = this.packetSender.sendPlayerPosRot;
        this.player.sendPlayerRot = this.packetSender.sendPlayerRot;
        this.player.sendPlayerStatus = this.packetSender.sendPlayerStatus;

        // For tick-tock tick-tock
        this.tickLoop = new TickLoop(() => {
            this.state.drainMutation();
            this.state.drainEvent(event => this.emitEvent(event));
            this.state.drainPacket((packet) => this.tcp.sendPacket(packet.id, packet.data));
            this.player.tick();
        });

        // Forward TCP events
        this.tcp.on("connect", () => this.emit("connect"));
        this.tcp.on("destroy", () => this.emit("destroy"));
        this.on("loadChunk", (sx, sy, sz) => this.blocks.deleteChunkCache(sx, sy, sz));
        this.on("unloadChunk", (sx, sz) => {
            for (let sy = 0; sy < 16; sy++) 
                this.blocks.deleteChunkCache(sx, sy, sz);
        });
    }

    private emitEvent(event: EmittedEvent) {
        this.emit(event.event, ...event.args);
    }

    private async loadRegistries() {
        if (Client.loadRegistry) return;
        Client.loadRegistry = true;
        const { version } = this.options;
        await BlockRegistry.load(version);
        await EntityRegistry.load(version);
        await PacketRegistry.load(version);
        await EffectRegistry.load(version);
    }

    // Start / stop

    /**
     * Create a connection to the server
     */
    public async connect() {
        await this.loadRegistries();
        if (!this.state.playerUUID) {
            if (this.options.auth) {
                this.state.authClient = new AuthClient(this.options.auth);
                const { uuid } = await this.state.authClient.getUUID();
                this.state.playerUUID = uuid.replaceAll("-", "");
                await this.state.startSignatureLoop();
            } else
                this.state.playerUUID = computeUUID(this.options.playerName);
        }

        this.tcp.connect();

        this.once("ready", () => {
            this.player.pruneInitialVal();
            this.player.setInitialVal();
            this.tickLoop.start();
        });
        this.tcp.once("destroy", () => {
            if (this.state.state === ConnectionState.Disconnected) return;
            this.disconnect("socket close");
        });
    }
    /**
     * Destroy the connection
     */
    public disconnect(reason: string = "Disconnect", raw?: TextComponent) {
        this.state.state = ConnectionState.Disconnected;
        this.state.status = ClientStatus.Disconnected;
        this.tickLoop.stop();
        this.player.pruneInitialVal();
        this.state.pruneStates();
        this.emit("disconnect", reason);
        if (raw)
            this.emit("disconnectRaw", raw);
        this.tcp.disconnect();
        if (this.options.auth)
            this.state.stopSignatureLoop();
    }

    // Inputs
    /**
     * Press and hold a key
     */
    public hold(inout: Input) {
        this.player.input(inout);
    }
    /**
     * Release a key
     */
    public release(input: Input) {
        this.player.releaseInput(input);
    }
    /**
     * Release all key
     */
    public stopMoving() {
        this.player.releaseAllInputs();
    }

    /**
     * Send a message
     */
    public chat(message: string) {
        this.packetSender.sendMessage(message);
    }

    // World
    /**
     * Get the block state at position
     */
    public at(x: number, y: number, z: number): BlockState | null;
    public at(position: BaseVec3): BlockState | null;
    public at(a: BaseVec3 | number, b?: number, c?: number): BlockState | null {
        const vec3 = Vec3.loadArgs(a, b, c);
        return this.blocks.at(vec3);
    }

    /**
     * Rotate your face
     * @param yaw In degree
     * @param pitch In degree
     */
    public lookAt(yaw: number, pitch: number) {
        this.player.setAngle(yaw, pitch);
    }
}