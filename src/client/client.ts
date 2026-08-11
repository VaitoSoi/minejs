import { EventEmitter } from "node:stream";
import { BlockManager, BlockState } from "../world/block";
import { EntitiesManager } from "../world/entity";
import { MoveDirection, Player } from "../physics/player";
import { TickLoop } from "../world/tick";
import { Message, TCPClient, TCPClientOption } from "./tcp";
import { TypedEmmiter as TypedEmitter } from "../base/event";
import { BlockRegistry, EntityRegistry, PacketRegistry, ProtocolVersionMapping } from "../version/registry";
import { BaseVec3, Vec3 } from "../physics/direction";
import { TextComponent } from "../base/typing";
import { EmittedEvent as EmittedEvent, Entity, SharedState } from "../world/state";
import { Dispatcher } from "../packet/dispatcher";
import { VersionCodec } from "../version/codec";
import { AuthClient } from "./auth";
import { computeUUID } from "../base/math";

export type ClientOption = Omit<TCPClientOption, "protocolVersion"> & {
    version: string,

    /**
     * Whenever should the client verify the message against the signature, if any
     * 
     * When set this option to true, you HAVE TO set `shouldVerifyMessageOrder` to true
     */
    shouldVerifyMessageSignature?: boolean

    /**
     * Should verify the message orders to keep the sync with server.
     */
    shouldVerifyMessageOrder?: boolean
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
    private uuid: Buffer = Buffer.alloc(0);

    private tcp: TCPClient;
    private state: SharedState<IsReady>;

    constructor(private options: ClientOption) {
        if (options.shouldVerifyMessageSignature === true && options.shouldVerifyMessageOrder !== true)
            throw new HaveSignatureButNotIndex();

        super();

        // For managing shared data
        this.state = new SharedState(options, () => this.uuid);
        // For handling packet
        const dispatcher = new Dispatcher(this.state, this.emit.bind(this));
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
            dispatcher.sendHandshake();
            dispatcher.sendLoginStart();
        };
        dispatcher.sendPacket = this.tcp.sendPacket.bind(this.tcp);
        dispatcher.disconnect = this.disconnect.bind(this);
        versionCodec.consumePacket = dispatcher.handlePacket.bind(dispatcher);

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

        // For tick-tock tick-tock
        this.tickLoop = new TickLoop(() => {
            this.state.drainMutation();
            this.state.drainEvent()
                .forEach(event => this.emitEvent(event));
            this.state.drainPacket()
                .forEach((packet) => this.tcp.sendPacket(packet.id, packet.data));
            this.player.tick();
        });

        // Forward TCP events
        this.tcp.on("connect", () => this.emit("connect"));
        this.tcp.on("destroy", () => this.emit("destroy"));
    }

    private emitEvent(event: EmittedEvent) {
        this.emit(event.event, ...event.args);
    }

    private async loadRegistries() {
        if (Client.loadRegistry) return;
        Client.loadRegistry = true;
        await BlockRegistry.load(this.options.version);
        await EntityRegistry.load(this.options.version);
        await PacketRegistry.load(this.options.version);
    }

    // Start / stop

    /**
     * Create a connection to the server
     */
    public async connect() {
        await this.loadRegistries();

        if (!this.uuid.length) {
            if (this.options.auth) {
                const authClient = new AuthClient(this.options.auth);
                const { uuid } = await authClient.auth();
                this.uuid = Buffer.from(uuid);
            } else
                this.uuid = computeUUID(this.options.playerName);
        }

        this.tcp.connect();

        this.once("ready", () => {
            this.player.pruneInitialVal();
            this.player.setInitialVal();
            this.tickLoop.start();
        });
        this.once("disconnect", () => {
            this.tickLoop.stop();
            this.player.pruneInitialVal();
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
    public hold(direction: MoveDirection) {
        this.player.input(direction);
    }
    /**
     * Release a key
     */
    public release(direction: MoveDirection) {
        this.player.releaseInput(direction);
    }
    /**
     * Release all key
     */
    public stopMoving() {
        this.player.releaseAllInputs();
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
}