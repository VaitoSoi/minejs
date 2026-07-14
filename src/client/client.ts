import EventEmitter from "node:events";
import { TCPClient, TCPClientEvents, TCPClientOption } from "./tcp";
import { TypedEmmiter } from "../base/event";
import { EntitiesManager } from "../base/entity";
export interface ClientEvents {
    ready: [readyClient: Client<true>],

    playerPosition: [position: BaseVec3],

    loadChunk: [chunkX: number, sectionY: number, chunkZ: number],
    unloadChunk: [chunkX: number, chunkZ: number],

    spawnEntity: [entity: Entity],
    updateEntity: [entity: Entity],
    removeEntity: [entityId: number],

    // Chat
    message: [message: Message],
    systemMessage: [message: string],
    systemMessageRaw: [textComponent: TextComponent],
    actionBar: [message: string],
    actionBarRaw: [textComponent: TextComponent],
}

export class Client<IsTCPReady extends boolean = boolean> extends (EventEmitter as new () => TypedEmmiter<ClientEvents>) {
    private tickLoop: TickLoop;

    private tcp: TCPClient<IsTCPReady>;
    private blocks: BlockManager;
    private entities: EntitiesManager;
    private player: Player;

    constructor(options: TCPClientOption) {
        super();
        BlockRegistry.load();
        EntityRegistry.load();

        this.tcp = new TCPClient(options);
        this.blocks = new BlockManager(this.tcp);
        this.entities = new EntitiesManager(this.tcp);
        this.player = new Player(this.entities, this.blocks, this.tcp);
        this.tickLoop = new TickLoop(() => this.player.tick());
        this.forwardEvents();
    }

    private forwardEvent(eventName: keyof ClientEvents & keyof TCPClientEvents) {
        this.tcp.on(eventName, (...args) => this.emit(eventName, ...args));
    }
    private forwardEvents() {
        this.forwardEvent("loadChunk");
        this.forwardEvent("unloadChunk");
        this.forwardEvent("playerPosition");
        this.forwardEvent("spawnEntity");
        this.forwardEvent("updateEntity");
        this.forwardEvent("removeEntity");
        this.forwardEvent("message");
        this.forwardEvent("systemMessage");
        this.forwardEvent("systemMessageRaw");
        this.forwardEvent("actionBar");
        this.forwardEvent("actionBarRaw");
    }

    // Start / stop
    public connect() {
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
    public disconnect() {
        this.tcp.disconnect();
    }

    public held(direction: MoveDirection) {
        this.player.input(direction);
    }
    public release(direction: MoveDirection) {
        this.player.releaseInput(direction);
    }
    public stopMoving() {
        this.player.releaseAllInputs();
    }
    }
}