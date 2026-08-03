import { EventEmitter } from "node:stream";
import { BlockManager, BlockState } from "../world/block";
import { EntitiesManager } from "../world/entity";
import { MoveDirection, Player } from "../physics/player";
import { TickLoop } from "../base/tick";
import { Entity, Message, TCPClient, TCPClientEvents, TCPClientOption, TextComponent } from "./tcp";
import { TypedEmmiter } from "../base/event";
import { BlockRegistry, EntityRegistry } from "../world/registry";
import { BaseVec3, Vec3 } from "../physics/direction";

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
        super();

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

        this.tcp.once("ready", () => {
            this.emit("ready", this as Client<true>);
            this.player.pruneInitialVal();
            this.player.setInitialVal();
            this.tickLoop.start();
        });
        this.tcp.once("disconnect", () => {
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