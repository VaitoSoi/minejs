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
    constructor(private client: TCPClient) { }

    /**
     * Get block at position
     */
    public at(x: number, y: number, z: number): BlockState | null;
    public at(position: BaseVec3): BlockState | null;
    public at(a: BaseVec3 | number, b?: number, c?: number): BlockState | null {
        const dataArray = section.data!;
        const bitsPerEntry = section.bpe;
        const entryIndex = px + (py * 16) + (pz * 16 * 16);
        const entriesPerLong = Math.floor(64 / bitsPerEntry);
        const entryMask = (1n << BigInt(bitsPerEntry)) - 1n;
        const longIndex = entryIndex / entriesPerLong;
        const bit_index = entryIndex % entriesPerLong * bitsPerEntry;
        return String((dataArray[longIndex]! >> BigInt(bit_index)) & entryMask);
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
        const sx0 = Math.floor(minX / 4), sx1 = Math.floor(maxX / 4);
        const sy0 = Math.floor(minY / 4), sy1 = Math.floor(maxY / 4);
        const sz0 = Math.floor(minZ / 4), sz1 = Math.floor(maxZ / 4);

        const ids: string[] = [];
        // Interating through each chunk section
        for (let sx = sx0; sx <= sx1; sx++)
            for (let sy = sy0; sy <= sy1; sy++)
                for (let sz = sz0; sz <= sz1; sz++)
                    // Interating through each block in each
                    for (let px = minX - sx * 16; px < Math.min(maxX - sx * 16, (sx + 1) * 16); px++)
                        for (let py = minY - sy * 16; py < Math.min(maxY - sy * 16, (sy + 1) * 16); py++)
                            for (let pz = minZ - sz * 16; pz < Math.min(maxZ - sz * 16, (sz + 1) * 16); pz++)
                                ids.push(this.at(px, py, pz));

        return ids.map((id) => {
            if (!(id in BlockStateRegistry.mapIdToState))
                throw new RegistryItemNotFound(`block state ${id}`);
            const state = BlockStateRegistry.mapIdToState[id]!;

            const bbs = state.boxes.map(val => new AABB(
                val.minX, val.minY, val.minZ,
                val.maxX, val.maxY, val.maxZ
            ));
            
        });
    }
}