import { TCPClient } from "../client/tcp";
export class BlockState {
    public shape: VoxelShape;

    constructor(
        public owner: Block,
        public id: string,
        public properties: Record<string, any>,
        public boxes: BaseAABB[]
    ) {
        const bbs = boxes.map(val => new AABB(
            val.minX, val.minY, val.minZ,
            val.maxX, val.maxY, val.maxZ
        ));

        this.shape = bbs.reduce(
            (prevVoxel, currentBox) => VoxelShape.or(prevVoxel, VoxelShape.fromBox(currentBox)),
            VoxelShape.Empty
        );
    }

    private get<T>(field: string): T | null;
    private get<T>(field: string, defaultVal: T): T;
    private get<T>(field: string, defaultVal?: T): T | null {
        if (field in this.properties) return this.properties[field];
        if (defaultVal) return defaultVal;
        return null;
    }
    public getFacing(): "north" | "south" | "west" | "east" | null { return this.get("facing"); }
}

export class Block {
    public states: BlockState[];

    constructor(
        public type: string,
        public definitions: Record<"type" | "block_set_type" | string, any>,
        public properties: Record<string, string[]>,
        states: Record<string, any> | BlockState[]
    ) {
        this.states = [];
        states.forEach((obj: any) =>
            this.states.push(
                obj instanceof BlockState ? obj : new BlockState(this, obj['id'], obj['properties'], obj['boxes'])
            )
        );
    }

    private get<T>(field: string): T | null;
    private get<T>(field: string, defaultVal: T): T;
    private get<T>(field: string, defaultVal?: T): T | null {
        if (field in this.definitions) return this.definitions[field];
        if (defaultVal) return defaultVal;
        return null;
    }
    public getType() { return this.get("type")!; }
    public getFriction() { return this.get("friction", 0.6); }
    public getBounciness() { return this.get("bounciness", 0); }
    public getSpeedFactor() { return this.get("speed_factor", 1); }
    public getClimbable() { return this.get("climbable", false); }
    public getJumpFactor() { return this.get("jump_factor", 1); }
}

export class BlockManager {

    public hasChunkAt(x: number, y: number, z: number): boolean;
    public hasChunkAt(position: BaseVec3): boolean;
    public hasChunkAt(a: BaseVec3 | number, b?: number, c?: number): boolean {
        this.tcp.checkReady();
        const { x, y, z } = Vec3.loadArgs(a, b, c);
        const sx = Math.floor(x / 16), sy = Math.floor((y + 64) / 16), sz = Math.floor(z / 16);
        // // console.log({
        //     key: `${this.tcp.player!.dimension}:${sx}:${sz}`,
        //     hasKey: `${this.tcp.player!.dimension}:${sx}:${sz}` in this.tcp.world!.chunks
        // });
        const section = this.tcp.world!.chunks[`${this.tcp.player!.dimension}:${sx}:${sz}`]?.sections[sy];
        if (!section) return false;
        return true;
    }

    /**
     * Get block at position
     */
    public at(x: number, y: number, z: number): BlockState | null;
    public at(position: BaseVec3): BlockState | null;
    public at(a: BaseVec3 | number, b?: number, c?: number): BlockState | null {
        this.tcp.checkReady();
        let { x, y, z } = Vec3.loadArgs(a, b, c);
        x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
        const sx = Math.floor(x / 16), sy = Math.floor((y + 64) / 16), sz = Math.floor(z / 16);
        const px = ((x % 16) + 16) % 16, py = ((y % 16) + 16) % 16, pz = ((z % 16) + 16) % 16;
        const section = this.tcp.world!.chunks[`${this.tcp.player!.dimension}:${sx}:${sz}`]?.sections[sy]?.block;
        if (!section) return null;
        if (section.data === null) return BlockRegistry.getState(section.palette[0]!.toString())!;
        const dataArray = section.data!;
        const bitsPerEntry = section.bpe;
        const entryIndex = px + (pz * 16) + (py * 16 * 16);
        const entriesPerLong = Math.floor(64 / bitsPerEntry);
        const entryMask = (1 << bitsPerEntry) - 1;
        const longIndex = Math.floor(entryIndex / entriesPerLong);
        const bit_index = entryIndex % entriesPerLong * bitsPerEntry;
        const localId = Number((dataArray[longIndex]! >> BigInt(bit_index)) & BigInt(entryMask));
        const stateId = bitsPerEntry <= 8 ? section.palette[localId]! : localId;
        return BlockRegistry.getState(String(stateId))!;
    }

    /**
     * Query the entity in the section that intersec with BB
     * @param queryBB The querying bounding box
     * @returns 
     */
    public queryAABB(queryBB: AABB) {
        if (!this.client.isReady())
            throw new ClientNotReady();

        const { minX, minY, minZ, maxX, maxY, maxZ } = queryBB;
        const sx0 = Math.floor(minX), sx1 = Math.floor(maxX);
        const sy0 = Math.floor(minY), sy1 = Math.floor(maxY);
        const sz0 = Math.floor(minZ), sz1 = Math.floor(maxZ);

        const blockShapes: VoxelShape[] = [];
        for (let x = sx0; x <= sx1; x++)
            for (let y = sy0; y <= sy1; y++)
                for (let z = sz0; z <= sz1; z++) {
                    const blockState = this.at(x, y, z);
                    if (blockState)
                        blockShapes.push(blockState.shape.move(x, y, z));
                }

        return blockShapes;
    }
}
    }
}