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
    connect: [],
    destroy: [],

    ready: [],
    disconnect: [reason: string],
    disconnectRaw: [textComponent: TextComponent],

    playerPosition: [position: BaseVec3],

    loadChunk: [chunkX: number, sectionY: number, chunkZ: number],
    unloadChunk: [chunkX: number, chunkZ: number],

    spawnEntity: [entity: Entity],
    updateEntity: [entityId: number],
    removeEntity: [entityId: number],

    // Chat
    message: [message: Message],
    systemMessage: [message: string],
    systemMessageRaw: [textComponent: TextComponent],
    actionBar: [message: string],
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
        dispatcher.tcpDisconnect = this.tcp.disconnect.bind(this.tcp);
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
    public disconnect() {
        this.tcp.disconnect();
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