import { AABB, BaseAABB, VoxelShape } from "../physics/aabb";
import { Epsilon, getFrac, getSign, lerp } from "../base/math";
import { BlockRegistry } from "../version/registry";
import { BaseVec3, Direction, Vec3 } from "../physics/direction";
import { SharedState } from "./state";
import { NotImplemented } from "../base/error";

export enum BlockFace {
    Bottom = 0,
    Top = 1,
    North = 2,
    South = 3,
    West = 4,
    East = 5,
}

/**
 * Represent a state of a block
 */
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

    /**
     * Get the block facing
     */
    public getFacing(): "north" | "south" | "west" | "east" | null { return this.get("facing"); }
}

/**
 * Represent a block
 */
export class Block {
    /**
     * A block will have multiple states (example: a stair will have difference facing).
     */
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

    /**
     * Get the block type.
     * 
     * A block type will contain multiple blocks, like type `wall_sign` will have 
     * `oak_wall_sign`, `spruce_wall_sign`, `acacia_wall_sign`, etc...
     */
    public getType() { return this.get<string>("type")!; }
    /**
     * Get the block friction.
     * 
     * By default, block friction is 0.6, except for ice block family.
     */
    public getFriction() { return this.get("friction", 0.6); }
    /**
     * Get the block bounciness.
     * 
     * By default, block friction is 0, except for slime block.
     */
    public getBounciness() { return this.get("bounciness", 0); }
    /**
     * Get the block speed factor.
     * 
     * By default, block friction is 1, except for soul sand block.
     */
    public getSpeedFactor() { return this.get("speed_factor", 1); }
    /**
     * Check if the block is climable.
     * 
     * By default, block friction is false, except for ladder and vine.
     */
    public getClimbable() { return this.get("climbable", false); }
    /**
     * Get the block jump factor.
     */
    public getJumpFactor() { return this.get("jump_factor", 1); }
}

/**
 * This class is for fetching blocks and chunks data.
 */
export class BlockManager {
    constructor(private state: SharedState) { }

    public static getLocalPosKey(x: number, y: number, z: number): number;
    public static getLocalPosKey(position: BaseVec3): number;
    public static getLocalPosKey(a: BaseVec3 | number, b?: number, c?: number): number {
        const pos = Vec3.loadArgs(a, b, c);
        return pos.x + 16 * (pos.z + 16 * pos.y);
    }
    public static getChunk(state:SharedState, sx: number, sy: number, sz: number) {
        state.checkReady();
        const chunk = state.world!.chunks[`${state.player!.dimension}:${sx}:${sz}`]?.sections[sy];
        return chunk;
    }
    private getChunk(sx: number, sy: number, sz: number) {
        return BlockManager.getChunk(this.state, sx, sy, sz);
    }

    /**
     * Check if the chunk section is loaded
     */
    public hasChunkAt(x: number, y: number, z: number): boolean;
    public hasChunkAt(position: BaseVec3): boolean;
    public hasChunkAt(a: BaseVec3 | number, b?: number, c?: number): boolean {
        this.state.checkReady();
        const { x, y, z } = Vec3.loadArgs(a, b, c);
        const sx = Math.floor(x / 16), sy = Math.floor((y + 64) / 16), sz = Math.floor(z / 16);
        // console.log({
        //     key: `${this.tcp.player!.dimension}:${sx}:${sz}`,
        //     hasKey: `${this.tcp.player!.dimension}:${sx}:${sz}` in this.tcp.world!.chunks
        // });
        const section = this.getChunk(sx, sy, sz);
        if (!section) return false;
        return true;
    }

    /**
     * Get block state at position
     */
    public at(x: number, y: number, z: number): BlockState | null;
    public at(position: BaseVec3): BlockState | null;
    public at(a: BaseVec3 | number, b?: number, c?: number): BlockState | null {
        this.state.checkReady();
        let { x, y, z } = Vec3.loadArgs(a, b, c);
        x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
        // Chunk position
        const sx = Math.floor(x / 16), sy = Math.floor((y + 64) / 16), sz = Math.floor(z / 16);
        // Block position within the chunk
        const px = ((x % 16) + 16) % 16, py = ((y % 16) + 16) % 16, pz = ((z % 16) + 16) % 16;

        const chunk = this.getChunk(sx, sy, sz)?.block;
        if (!chunk) return null;
        const localKey = BlockManager.getLocalPosKey(px, py, pz);
        if (chunk.overlay.has(localKey))
            return this.getBlock(chunk.overlay.get(localKey)!);
        
        if (this.state.cache)
            return this.getWithCache(sx, sy, sz, px, py, pz);
        else
            return this.getWithoutCache(sx, sy, sz, px, py, pz);
    }

    private getBlock(stateId: number | string) {
        return BlockRegistry.getState(String(stateId));
    }

    private getWithCache(
        sx: number, sy: number, sz: number,
        px: number, py: number, pz: number,
    ) {
        if (!this.state.cache)
            throw new NotImplemented();
        const localPos = { x: px, y: py, z: pz };
        const sectionKey = `${this.state.player!.dimension}:${sx}:${sy}:${sz}`;
        const sectionCache = this.state.cache.get(sectionKey);
        if (sectionCache) {
            const cachedState = sectionCache.at(BlockManager.getLocalPosKey(localPos));
            if (cachedState)
                return this.getBlock(cachedState);
        }

        const section = this.getChunk(sx, sy, sz)?.block;
        if (!section) return null;
        if (section.data === null) return BlockRegistry.getState(section.palette[0]!.toString())!;

        const arr = new Uint16Array(16 * 16 * 16);
        const dataArray = section.data!;
        const bitsPerEntry = section.bpe;
        const entriesPerLong = Math.floor(64 / bitsPerEntry);
        const entryMask = (1 << bitsPerEntry) - 1;
        for (let localX = 0; localX < 16; localX++)
            for (let localY = 0; localY < 16; localY++)
                for (let localZ = 0; localZ < 16; localZ++) {
                    const entryIndex = BlockManager.getLocalPosKey(localX, localY, localZ);
                    const longIndex = Math.floor(entryIndex / entriesPerLong);
                    const bit_index = entryIndex % entriesPerLong * bitsPerEntry;
                    const localId = Number((dataArray[longIndex]! >> BigInt(bit_index)) & BigInt(entryMask));
                    const stateId = bitsPerEntry <= 8 ? section.palette[localId]! : localId;
                    arr[entryIndex]! = stateId;
                }

        this.state.cache.put(sectionKey, arr);
        const state = arr.at(BlockManager.getLocalPosKey(localPos))!;
        return this.getBlock(state);
    }
    /**
     * Delete the chunk cache
     * 
     * @param sx chunk x
     * @param sy section y
     * @param sz chunk z
     */
    public deleteChunkCache(
        sx: number, sy: number, sz: number,
    ) {
        const sectionKey = `${this.state.player!.dimension}:${sx}:${sy}:${sz}`;
        if (this.state.cache)
            this.state.cache.del(sectionKey);
    }

    private getWithoutCache(
        sx: number, sy: number, sz: number,
        px: number, py: number, pz: number,
    ) {
        const section = this.getChunk(sx, sy, sz)?.block;
        // console.log(section);
        if (!section) return null;
        if (section.data === null) return BlockRegistry.getState(section.palette[0]!.toString())!;

        const dataArray = section.data!;
        const bitsPerEntry = section.bpe;
        const entryIndex = BlockManager.getLocalPosKey(px, py, pz);
        const entriesPerLong = Math.floor(64 / bitsPerEntry);
        const entryMask = (1 << bitsPerEntry) - 1;
        const longIndex = Math.floor(entryIndex / entriesPerLong);
        const bitIndex = entryIndex % entriesPerLong * bitsPerEntry;
        const localId = Number((dataArray[longIndex]! >> BigInt(bitIndex)) & BigInt(entryMask));
        const stateId = bitsPerEntry <= 8 ? section.palette[localId]! : localId;

        return BlockRegistry.getState(String(stateId));
    }

    /**
     * Query the entity in the section that intersec with BB
     * @param queryBB The querying bounding box
     * @returns 
     */
    public queryAABB(queryBB: AABB) {
        this.state.checkReady();

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


/**
 * For clipping math
 * 
 * @hidden
 */
export class BlockGetter {
    public static clip(from: Vec3, to: Vec3, getBlockState: (position: BaseVec3) => VoxelShape) {
        return this.traverseBlocks(
            from, to, { getBlockState, from, to },
            (context, pos) => {
                const blockState = context.getBlockState(pos);
                const { from, to } = context;
                return blockState.clip(from, to, pos);
            },
            (context) => {
                const { from, to } = context;
                const delta = from.subtract(to);
                return BlockHitResult.miss(to, Direction.getApproximateNearest(delta), to);
            }
        );
    }

    public static traverseBlocks<T, C>(
        from: Vec3,
        to: Vec3,
        context: C,
        consumer: (context: C, position: BaseVec3) => T,
        missFactory: (context: C) => T
    ): T {
        if (from.equal(to)) return missFactory(context);
        const toX = lerp(-Epsilon, to.x, from.x);
        const toY = lerp(-Epsilon, to.y, from.y);
        const toZ = lerp(-Epsilon, to.z, from.z);
        const fromX = lerp(-Epsilon, from.x, to.x);
        const fromY = lerp(-Epsilon, from.y, to.y);
        const fromZ = lerp(-Epsilon, from.z, to.z);
        let currentBlockX = Math.floor(fromX);
        let currentBlockY = Math.floor(fromY);
        let currentBlockZ = Math.floor(fromZ);
        const firstBlock = consumer(context, { x: currentBlockX, y: currentBlockY, z: currentBlockZ });
        if (firstBlock !== null) return firstBlock;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const dz = toZ - fromZ;
        const signX = getSign(dx);
        const signY = getSign(dy);
        const signZ = getSign(dz);
        const tDeltaX = signX == 0 ? Infinity : signX / dx;
        const tDeltaY = signY == 0 ? Infinity : signY / dy;
        const tDeltaZ = signZ == 0 ? Infinity : signZ / dz;
        let tX = signX === 0 ? Infinity : tDeltaX * (signX > 0 ? 1 - getFrac(fromX) : getFrac(fromX));
        let tY = signY === 0 ? Infinity : tDeltaY * (signY > 0 ? 1 - getFrac(fromY) : getFrac(fromY));
        let tZ = signZ === 0 ? Infinity : tDeltaZ * (signZ > 0 ? 1 - getFrac(fromZ) : getFrac(fromZ));
        while (tX <= 1.0 || tY <= 1.0 || tZ <= 1.0) {
            if (tX < tY) {
                if (tX < tZ) {
                    currentBlockX += signX;
                    tX += tDeltaX;
                } else {
                    currentBlockZ += signZ;
                    tZ += tDeltaZ;
                }
            } else if (tY < tZ) {
                currentBlockY += signY;
                tY += tDeltaY;
            } else {
                currentBlockZ += signZ;
                tZ += tDeltaZ;
            }
            const result = consumer(context, { x: currentBlockX, y: currentBlockY, z: currentBlockZ });

            if (result !== null)
                return result;
        }
        return missFactory(context);
    }
}

/**
 * For clipping math
 * 
 * @hidden
 */
export class BlockHitResult {
    constructor(
        public miss: boolean,
        public location: Vec3,
        public direction: Direction,
        public pos: BaseVec3,
    ) { }

    public static hit(location: Vec3, direction: Direction, pos: BaseVec3) {
        return new BlockHitResult(false, location, direction, pos);
    }

    public static miss(location: Vec3, direction: Direction, pos: BaseVec3) {
        return new BlockHitResult(true, location, direction, pos);
    }
}