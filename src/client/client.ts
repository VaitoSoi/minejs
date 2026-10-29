import { EventEmitter } from "node:events";
import { BlockGetter, BlockManager, BlockState } from "../world/block";
import { EntitiesManager } from "../world/entity";
import { Input, Player } from "../physics/player";
import { TickLoop } from "../world/tick";
import { Message, TCPClient, TCPClientOption } from "../net/tcp";
import { TypedEmmiter as TypedEmitter } from "../base/event";
import { BlockRegistry, EffectRegistry, EntityRegistry, PacketRegistry, ProtocolVersionMapping } from "../version/registry";
import { BaseVec3, Vec3 } from "../physics/direction";
import { RegistryData, TextComponent } from "../base/typing";
import { ClientStatus, ConnectionState, EmittedEvent as EmittedEvent, Entity, SharedState } from "../world/state";
import { Listener } from "../packet/listener";
import { VersionCodec } from "../version/codec";
import { AuthClient } from "./auth";
import { computeUUID } from "../base/math";
import { HaveSignatureButNotIndex } from "../base/error";
import { Sender } from "../packet/sender";
import { CacheImplementation } from "../base/cache";
import { Container, Slot } from "../world/container";

export type ClientOption = Omit<TCPClientOption, "protocolVersion"> & {
    /**
     * The client version. Supports 26.2 and 26.3
     */
    version: string,

    /**
     * Whenever should the client verify the message against the signature, if any.
     * 
     * In order to set this option to true, you HAVE TO set `shouldVerifyMessageOrder` to true
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
     * Specifically, when the packet `Login (play)` is received.
     * 
     * Most of the client method require this event to be fired in order to work.
     */
    ready: [],
    /**
     * When the client got disconnected from server.
     * 
     * This event only provide the parsed string. To get the unparsed, or the raw one with decoration, use `disconnectRaw`.
     * But, the `disconnectRaw` is only fired when the disconnection come from the server, or the server disconnect the client.
     * Sometime, the disconnect will be fired within the client, meaning that there will be no `disconnectRaw` 
     */
    disconnect: [reason: string],
    /**
     * When the disconnection come with the raw Text Component.
     */
    disconnectRaw: [textComponent: TextComponent],

    /** The registry_data packet */
    registryData: [data: RegistryData],

    /**
     * When server send `Player Position Synchronization` packet.
     * 
     * **Note:** this event is not fired when the client is moved by holding the input.
     * 
     * To get the player current position, use `getPosition` method
     */
    playerPosition: [position: BaseVec3],

    /** 
     * When the chunk is loaded
     * 
     * Explaining the `chunkX`, `sectionY`, `chunkZ`: A chunk in Minecraft is a region which length and width is 16 and the height extends to the limit.
     * But when sending the packet, the chunk is divided into smaller section which volume is 16x16x16. 
     * So the `chunkX` and `chunkZ` is the chunk position and `sectionY` is the section within that chunk, 
     * counting from the bedrock up to the sky
     */
    loadChunk: [chunkX: number, sectionY: number, chunkZ: number],
    /** 
     * When the chunk got deleted by the server
     * 
     * See the `chunkX` and `chunkZ` explaination in `loadChunk` events 
     */
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
    /** 
     * The system message 
     * 
     * This event only provide the parsed string. To get the unparsed, or the raw one with decoration, use `systemMessageRaw`
     */
    systemMessage: [message: string],
    /** 
     * The system message with the Text Component for decorations
     */
    systemMessageRaw: [textComponent: TextComponent],
    /** 
     * The action bar 
     * 
     * This event only provide the parsed string. To get the unparsed, or the raw one with decoration, use `actionBarRaw`
     */
    actionBar: [message: string],
    /** The raw action bar */
    actionBarRaw: [textComponent: TextComponent],

    // Container
    /** 
     * When a container is opened
     * 
     * This event will be fired when client click on a block (with `openBlock` method) that is a container 
     * or when server believe that you just open a container (with open_screen packet).
     */
    openContainer: [container: Container],
    /** When the opening container is closed */
    closeContainer: [],
    /** When the packet contain the content of the container is received */
    containerContent: [container: Container, carryingItem: Slot],
    /** When the packet contain the property of the container is received */
    containerProperty: [container: Container],

    /** 
     * When tab list is updated
     * 
     * `{"text":""}` mean remove header or footer.
     */
    tablist: [newTablist: { header: { text: string, raw: TextComponent }, footer: { text: string, raw: TextComponent } }]
}

/**
 * High-level client.
 * 
 * @example
 * ```ts
 * const client = new Client({
 *     playerName: "bot", // Put your name here
 *     host: "localhost", // Put the server address
 *     port: 25565, // 25565 is the default port, change to your server's port if needed
 *     version: "26.2", // The client version 
 *     loadRegistry: false, // 
 *     // auth: { // This things is not working yet
 *     //     client_id: "d86254d8-edf7-4640-90eb-643c99af188e",
 *     //     method: "loopback",
 *     //     openBrowser: true,
 *     //     port: 12345
 *     // },
 *     // shouldVerifyMessageOrder: true,
 *     // shouldVerifyMessageSignature: true
 * });
 * 
 * // MineJs is a event driven library, the same way DiscordJS work (if you know them).
 * // One thing to note is most of method in this client require client to be ready, 
 * // meaning that unless the "ready" event is fired, you can't do, mostly, anything :D
 * client.on("ready", () => console.log("Client is ready :yay:"));
 * 
 * // The init step before is just init the data and does not create the connection yet.
 * // This method will create that connection.
 * client.connect();
 * ```
 */
export class Client extends (EventEmitter as new () => TypedEmitter<ClientEvents>) {
    private static loadRegistry: boolean = false;

    private tickLoop: TickLoop;

    private blocks: BlockManager;
    private entities: EntitiesManager;
    private player: Player;

    private tcp: TCPClient;
    private state: SharedState;
    private packetListener: Listener;
    private packetSender: Sender;

    constructor(private options: ClientOption) {
        if (options.shouldVerifyMessageSignature === true && options.shouldVerifyMessageOrder !== true)
            throw new HaveSignatureButNotIndex();

        super();
        this.loadRegistries();

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
            this.packetSender.sendClientTickEnd();
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

    private loadRegistries() {
        if (Client.loadRegistry) return;
        Client.loadRegistry = true;
        const { version } = this.options;
        BlockRegistry.load(version);
        EntityRegistry.load(version);
        PacketRegistry.load(version);
        EffectRegistry.load(version);
    }

    // Start / stop

    /**
     * Create a connection to the server
     */
    public async connect() {
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
     * Destroy the connection.
     * 
     * Calling this method will also fire the "disconnect" event.
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
     * Press and hold a key.
     * 
     * This is pretty the same idea as when you play Minecraft.
     * When you need to go forward, you have to hold the key `W`, `S` for backward, etc...
     * 
     * @throws {ClientNotReady} When the client is not ready
     */
    public hold(input: Input) {
        this.state.checkReady();
        this.player.input(input);
    }
    /**
     * Release a key.
     * 
     * This is also pretty the same idea as when you play Minecraft.
     * Need to stop, stop holding `W`, `S` key, etc...
     * 
     * @throws {ClientNotReady} When the client is not ready
     */
    public release(input: Input) {
        this.state.checkReady();
        this.player.releaseInput(input);
    }
    /**
     * Release all key. 
     * 
     * This is the shortcut for release all keys. 
     * Instead of calling `release` method for each keys, just call this
     * 
     * @throws {ClientNotReady} When the client is not ready
     */
    public stopMoving() {
        this.state.checkReady();
        this.player.releaseAllInputs();
    }

    /**
     * Send a message
     * 
     * @throws {ClientNotReady} When the client is not ready
     */
    public chat(message: string) {
        this.state.checkReady();
        this.packetSender.sendMessage(message);
    }

    // World
    /**
     * Get the block state at position
     * 
     * @throws {ClientNotReady} When the client is not ready
     */
    public getBlock(x: number, y: number, z: number): BlockState | null;
    public getBlock(position: BaseVec3): BlockState | null;
    public getBlock(a: BaseVec3 | number, b?: number, c?: number): BlockState | null {
        const vec3 = Vec3.loadArgs(a, b, c);
        return this.blocks.at(vec3);
    }

    /**
     * Get player position
     * 
     * @throws {ClientNotReady} When the client is not ready
     */
    public getPosition() {
        this.state.checkReady();
        return structuredClone(this.state.player!.position);
    }

    /**
     * Rotate your face
     * 
     * "Yaw is measured in degrees and does not follow classical trigonometry rules.
     * The unit circle of yaw on the XZ-plane starts at (0, 1) and turns counterclockwise, with 90 at (-1, 0), 180 at (0, -1) and 270 at (1, 0).
     *
     * Pitch is measured in degrees, where 0 is looking straight ahead, -90 is looking straight up, and 90 is looking straight down."
     *
     * @see https://minecraft.wiki/w/Java_Edition_protocol/Packets#Synchronize_Player_Position
     *
     * @param yaw In degree
     * @param pitch In degree
     * 
     * @throws {ClientNotReady} When the client is not ready
     */
    public lookAt(yaw: number, pitch: number) {
        this.state.checkReady();
        this.player.setAngle(yaw, pitch);
    }

    /**
     * Get opening container.
     * 
     * Return `undefined` if nothing is opening
     * 
     * @throws {ClientNotReady} When the client is not ready
     */
    public getOpeningContainer() {
        this.state.checkReady();
        return this.state.openingContainer;
    }
    /**
     * Get carrying item.
     * 
     * Return `undefined` if nothing is carried
     * 
     * @throws {ClientNotReady} When the client is not ready
     */
    public getCarryingItem() {
        this.state.checkReady();
        return this.state.player?.carryingItem;
    }
    /**
     * Get player's inventory
     * 
     * @throws {ClientNotReady} When the client is not ready
     */
    public getInventory() {
        this.state.checkReady();
        return this.state.player?.inventory;
    }

    /**
     * Open a block.
     * 
     * @throws {ClientNotReady} When the client is not ready
     * @returns `true` if the target block is a solid block, or else, return `false`
     */
    public openBlock(x: number, y: number, z: number): boolean;
    public openBlock(position: BaseVec3): boolean;
    public openBlock(a: BaseVec3 | number, b?: number, c?: number): boolean {
        this.state.checkReady();
        const vec3 = Vec3.loadArgs(a, b, c);
        const eyePos = new Vec3(this.state.player!.position).add(0, 1.62, 0);
        const target = new Vec3(vec3).add(0.5, 0.5, 0.5); // aim at block center, or use look direction
        const reach = 4.5; // survival reach, adjust as needed
        const dir = target.subtract(eyePos).normalize();
        const to = eyePos.add(dir.scale(reach));
        const clipResult = BlockGetter.clip(
            eyePos,
            to,
            (pos) => this.blocks.at(pos)!.shape
        )!;
        if (clipResult.miss) return false;
        const cursorX = Math.abs(clipResult.location.x - clipResult.pos.x),
            cursorY = Math.abs(clipResult.location.y - clipResult.pos.y),
            cursorZ = Math.abs(clipResult.location.z - clipResult.pos.z);
        if (cursorX > 1 || cursorY > 1 || cursorZ > 1)
            return false;
        this.packetSender.sendUseItemOn(
            "main",
            vec3,
            clipResult.direction,
            { x: cursorX, y: cursorY, z: cursorZ },
            false,
            false
        );
        return true;
    }
}