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

    constructor(option: TCPClientOption) {
        super();
        this._client = new TCPClient(option);
        this.forwardEvents();
        this.handleEvents();

        this.entities = new EntitiesManager(this._client);
    }

    private forwardEvents() {
        this.forwardEvent("ready");
        this.forwardEvent("connect");
        this.forwardEvent("disconnect");
        this.forwardEvent("disconnectRaw");
        this.forwardEvent("loadChunk");
        this.forwardEvent("unloadChunk");
        this.forwardEvent("spawnEntity");
        this.forwardEvent("updateEntity");
        this.forwardEvent("removeEntity");
        this.forwardEvent("message");
        this.forwardEvent("systemMessage");
        this.forwardEvent("systemMessageRaw");
        this.forwardEvent("actionBar");
        this.forwardEvent("actionBarRaw");
    }

    private forwardEvent(event: keyof ClientEvents) {
        this._client.on(event, (...args) => this.emit(event, ...args));
    }

    private handleEvents() {
        this.on("disconnect", () => {
            this.entities.wipe();
        });
        this.on("connect", () => {
            this.entities.wipe();
        });
        this.on("spawnEntity", (entity) =>
            this.entities.add(entity.id, entity.position.x, entity.position.y, entity.position.z)
        );
        this.on("updateEntity", (entity) =>
            this.entities.update(entity.id, entity.position.x, entity.position.y, entity.position.z)
        );
        this.on("removeEntity", (id) => this.entities.remove(id));
    }

    /**
     * Start a connection to the server
     */
    public connect() {
        EntityRegistry.load();
        BlockStateRegistry.load();

        return this._client.connect();
    }

    /**
     * Disconnect from the server
     */
    public disconnect() {
        return this._client.disconnect();
    }

    public move(x: number, y: number, z: number) {

    }

    private collide(movement: Vec3) {
        if (!this._client.isReady())
            throw new ClientNotReady();
        const { x: playerX, y: playerY, z: playerZ } = this._client.player!.position;
        const playerBB =
            AABB.fromEntityType("minecraft:player")
                .move(playerX, playerY, playerZ);
        const expandedBB = playerBB.expandTowards(movement);
        
        const entities = this.entities.queryAABB(expandedBB);
    }
}