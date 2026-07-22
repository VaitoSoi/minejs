import { BitSet } from "./bitset";
import { Axis, AxisCycle, BaseAxis, BaseVec3, Direction, Vec3 } from "./direction";
import { RegistryItemNotFound } from "./error";
import { EntityRegistry } from "./registry";
import { Epsilon, lowerBoundBinarySearch } from "./math";
import { BlockHitResult } from "./block";

export interface BaseAABB {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

export class AABB implements BaseAABB {
    public minX: number;
    public minY: number;
    public minZ: number;
    public maxX: number;
    public maxY: number;
    public maxZ: number;

    public static readonly EntityBoundingBoxes: Record<string, AABB> = {};

    /**
     * Construct bounding box from entity namespace or type ID
     * @param type Entity namespace or type ID
     * @returns 
     */
    public static fromEntityType(type: string | number) {
        if (this.EntityBoundingBoxes[type])
            return this.EntityBoundingBoxes[type];
        if (!(type in EntityRegistry.data) && !(type in EntityRegistry.mapTypeToData))
            throw new RegistryItemNotFound(`entity type ${type}`);
        const { height, width } = EntityRegistry.get(type)!;
        return this.fromDimension(height, width);
    }

    /**
     * Construct bounding box from given rectangle
     * @param height 
     * @param width 
     * @returns 
     */
    public static fromDimension(height: number, width: number) {
        return new AABB(
            - width / 2,
            0,
            - width / 2,
            width / 2,
            height,
            width / 2
        );
    }

    /**
     * Construct bounding box from base interface
     * @param aabb 
     * @returns 
     */
    public static fromAABB(aabb: BaseAABB) {
        return new AABB(
            aabb.minX,
            aabb.minY,
            aabb.minZ,
            aabb.maxX,
            aabb.maxY,
            aabb.maxZ,
        );
    }

    constructor(
        x1: number,
        y1: number,
        z1: number,
        x2: number,
        y2: number,
        z2: number,
    ) {
        this.minX = Math.min(x1, x2);
        this.minY = Math.min(y1, y2);
        this.minZ = Math.min(z1, z2);
        this.maxX = Math.max(x1, x2);
        this.maxY = Math.max(y1, y2);
        this.maxZ = Math.max(z1, z2);
    }

    /**
     * Return a copy
     * @returns 
     */
    public copyBase(): BaseAABB {
        return {
            minX: this.minX,
            minY: this.minY,
            minZ: this.minZ,
            maxX: this.maxX,
            maxY: this.maxY,
            maxZ: this.maxZ,
        };
    }

    /**
     * Check if two AABB is equal
     * @param aabb 
     * @returns 
     */
    public equal(aabb: AABB) {
        return this.minX === aabb.minX &&
            this.minY === aabb.minY &&
            this.minZ === aabb.minZ &&
            this.maxX === aabb.maxX &&
            this.maxY === aabb.maxY &&
            this.maxZ === aabb.maxZ;
    }

    /**
     * Expand AABB toward a Vector
     */
    public expandTowards(x: number, y: number, z: number): AABB;
    public expandTowards(aabb: Vec3): AABB;
    public expandTowards(a: Vec3 | number, b?: number, c?: number): AABB {
        const { x, y, z } = Vec3.loadArgs(a, b, c);
        let { minX, minY, minZ, maxX, maxY, maxZ } = this;
        if (x < 0.0) {
            minX += x;
        } else if (x > 0.0) {
            maxX += x;
        }

        if (y < 0.0) {
            minY += y;
        } else if (y > 0.0) {
            maxY += y;
        }

        if (z < 0.0) {
            minZ += z;
        } else if (z > 0.0) {
            maxZ += z;
        }

        return new AABB(minX, minY, minZ, maxX, maxY, maxZ);
    }

    /**
     * Shift this AABB by a given vector, or on the other word, shift each axis by given value 
     */
    public move(x: number, y: number, z: number): AABB;
    public move(aabb: BaseVec3): AABB;
    public move(a: BaseVec3 | number, b?: number, c?: number): AABB {
        const { x, y, z } = Vec3.loadArgs(a, b, c);
        const { minX, minY, minZ, maxX, maxY, maxZ } = this;
        return new AABB(minX + x, minY + y, minZ + z, maxX + x, maxY + y, maxZ + z);
    }

    /**
     * Is two AABB intersect each other
     */
    public isIntersect(other: AABB) {
        return this.minX < other.maxX && this.maxX > other.minX &&
            this.minY < other.maxY && this.maxY > other.minY &&
            this.minZ < other.maxZ && this.maxZ > other.minZ;
    }

    /**
     * Get min value of an Axis
     */
    public min(axis: BaseAxis) {
        return Axis.choose(axis,
            this.minX,
            this.minY,
            this.minZ
        );
    }
    /**
     * Get max value of an Axis
     */
    public max(axis: BaseAxis) {
        return Axis.choose(axis,
            this.maxX,
            this.maxY,
            this.maxZ
        );
    }

    /**
     * Cliping math. Find smallest distance to reach a face of this Shape, which contain multiple AABB.
     */
    public static clip(aabbs: AABB[], from: Vec3, to: BaseVec3, pos: BaseVec3) {
        const scaleReference: [number] = [1]; // Make a mutable var
        let direction: Direction | null = null;
        const dx = to.x - from.x,
            dy = to.y - from.y,
            dz = to.z - from.z;
        for (const aabb of aabbs)
            direction = this.getDirection(aabb.move(pos), from, { x: dx, y: dy, z: dz }, direction, scaleReference);
        if (direction === null) return null;
        const scale = scaleReference[0];
        return BlockHitResult.hit(from.add(scale * dx, scale * dy, scale * dz), direction, pos);
    }

    /**
     * Cliping math. Find smallest distance to reach a face of this AABB.
     */
    public static getDirection(aabb: BaseAABB, from: BaseVec3, delta: BaseVec3, direction_: Direction | null, scaleRef: [number]) {
        let direction = structuredClone(direction_);
        const { minX, maxX, minY, maxY, minZ, maxZ } = aabb;
        if (delta.x > Epsilon)
            direction = this.clipPoint(
                direction, Direction.WEST,
                scaleRef,
                { a: delta.x, b: delta.y, c: delta.z },
                minX,
                minY, maxX,
                minZ, maxZ,
                from.x, from.y, from.z
            );
        else if (delta.x < -Epsilon)
            direction = this.clipPoint(
                direction, Direction.EAST,
                scaleRef,
                { a: delta.x, b: delta.y, c: delta.z },
                maxX,
                minY, maxX,
                minZ, maxZ,
                from.x, from.y, from.z
            );

        if (delta.y > Epsilon)
            direction = this.clipPoint(
                direction, Direction.DOWN,
                scaleRef,
                { a: delta.y, b: delta.z, c: delta.x },
                minY,
                minZ, maxZ,
                minX, maxX,
                from.y, from.z, from.x
            );
        else if (delta.y < -Epsilon)
            direction = this.clipPoint(
                direction, Direction.UP,
                scaleRef,
                { a: delta.y, b: delta.z, c: delta.x },
                maxY,
                minZ, maxZ,
                minX, maxX,
                from.y, from.z, from.x
            );

        if (delta.z > Epsilon)
            direction = this.clipPoint(
                direction, Direction.NORTH,
                scaleRef,
                { a: delta.z, b: delta.x, c: delta.y },
                minZ,
                minX, maxX,
                minY, maxY,
                from.z, from.x, from.y
            );
        else if (delta.z < -Epsilon)
            direction = this.clipPoint(
                direction, Direction.SOUTH,
                scaleRef,
                { a: delta.z, b: delta.x, c: delta.y },
                maxZ,
                minX, maxX,
                minY, maxY,
                from.z, from.x, from.y
            );

        return direction;
    }

    /**
     * Calculate the clipping distance
     */
    public static clipPoint(
        direction: Direction | null, newDiretion: Direction,
        scaleRef: [number],
        delta: { a: number, b: number, c: number },
        point: number,
        minB: number, maxB: number,
        minC: number, maxC: number,
        fromA: number, fromB: number, fromC: number,
    ) {
        /**
         * `s` come from this equation:
         * ```
         * fromA + s * deltaA = minA (or point here)
         * ```
         * Which find "how far the ray travels to reach a face of this bounding box".
         * 
         * Solve it we got
         * ```
         * s = minA - fromA / deltaA
         * ```
         */
        const s = (point - fromA) / delta.a,
            pb = fromB + s * delta.b,
            pc = fromC + s * delta.c;
        if (
            0 < s && s < scaleRef[0] &&
            minB - Epsilon < pb && pb < maxB + Epsilon &&
            minC - Epsilon < pc && pc < maxC + Epsilon
        ) {
            scaleRef[0] = s;
            return newDiretion;
        }
        return direction;
    }
}

/**
 * Basically, a VoxelShape it a set of multiple AABB.
 * 
 * For example, a VoxelShape of a stair is constructed from 2 AABB, lower half and upper half.
 */
export class VoxelShape {
    public static Empty = new VoxelShape([], [], [], [[[false]]]);

    /**
     * Construct VoxelShape from an AABB
     */
    public static fromBox(bb: BaseAABB) {
        const xs = [bb.minX, bb.maxX],
            ys = [bb.minY, bb.maxY],
            zs = [bb.minZ, bb.maxZ];
        const cells = [[[true]]];
        return new VoxelShape(xs, ys, zs, cells);
    }

    /**
     * Merge two VoxelShape using `OR` operatior
     */
    public static or(a: VoxelShape, b: VoxelShape) {
        const mergeX = VoxelShape.createMerger(a.xs, b.xs),
            mergeY = VoxelShape.createMerger(a.ys, b.ys),
            mergeZ = VoxelShape.createMerger(a.zs, b.zs);

        const getCoords = (x: number, y: number, z: number) =>
            ((x * (mergeY.size - 1)) + y) * (mergeZ.size - 1) + z;
        const storage = new BitSet();

        mergeX.forMergedIndex((x1, x2, xr) => {
            mergeY.forMergedIndex((y1, y2, yr) => {
                mergeZ.forMergedIndex((z1, z2, zr) => {
                    if (a.isFullWide(x1, y1, z1) || b.isFullWide(x2, y2, z2))
                        storage.set(getCoords(xr, yr, zr), 1);
                });
            });
        });

        return new VoxelShape(mergeX.list, mergeY.list, mergeZ.list, storage);
    }
    public static createMerger(first: number[], second: number[]): IndexMerger {
        if (first.at(-1)! < second.at(0)!)
            return new NoneOverlappingMerger(first, second, false);
        else if (first.at(0)! > second.at(-1)!)
            return new NoneOverlappingMerger(second, first, true);
        if (first.length === second.length && first.every((val, ind) => val === second[ind]!))
            return new IdenticalMerger(first);
        else return new IndirectMerger(first, second);
    }

    private storage: BitSet;

    constructor(
        public xs: number[],
        public ys: number[],
        public zs: number[],
        cells: boolean[][][] | BitSet
    ) {
        if (cells instanceof BitSet)
            this.storage = cells;
        else {
            this.storage = new BitSet();
            this.storage.setRange(0, (((xs.length - 1) * ys.length) + (ys.length - 1)) * zs.length + (zs.length - 1), 0);
            for (let x = 0; x < cells.length; x++)
                for (let y = 0; y < cells[x]!.length; y++)
                    for (let z = 0; z < cells[x]![y]!.length; z++)
                        if (cells[x]![y]![z] === true)
                            this.storage.set(this.getIndex(x, y, z), 1);
        }
    }

    /**
     * Make a copy
     */
    public copy() {
        return new VoxelShape(
            this.xs,
            this.ys,
            this.zs,
            this.storage.clone()
        );
    }

    /**
     * Map an (X, Y, Z) index into storage or bitset index
     */
    private getIndex(x: number, y: number, z: number) {
        return ((x * (this.ys.length - 1)) + y) * (this.zs.length - 1) + z;
    }

    /**
     * Get coords acording to each axis
     */
    public getCoords(axis: BaseAxis) {
        return Axis.choose(axis, this.xs, this.ys, this.zs);
    }

    /**
     * Is the cell at these index filled
     */
    public isFullWide(transform: AxisCycle, x: number, y: number, z: number): boolean
    public isFullWide(x: number, y: number, z: number): boolean
    public isFullWide(a: number | AxisCycle, b: number, c: number, d?: number): boolean {
        let x, y, z;
        if (typeof a === "object") {
            x = a.cycleCoords(b, c, d!, BaseAxis.X);
            y = a.cycleCoords(b, c, d!, BaseAxis.Y);
            z = a.cycleCoords(b, c, d!, BaseAxis.Z);
        } else {
            x = a as number;
            y = b;
            z = c;
        }

        if (x < 0 || x >= this.xs.length - 1) return false;
        if (y < 0 || y >= this.ys.length - 1) return false;
        if (z < 0 || z >= this.zs.length - 1) return false;
        return this.storage.get(this.getIndex(x, y, z)) === 1;
    }

    /**
     * Get the number of cells of an axis
     */
    public getSize(axis: BaseAxis) {
        return Axis.choose(
            axis,
            this.xs.length,
            this.ys.length,
            this.zs.length,
        ) - 1;
    }

    /** 
     * Real-world to cells index.
     * 
     * The binary search mean: `Find the smallest number that larger than the provided coords`
     */
    public findIndex(axis: BaseAxis, coords: number) {
        const arr = Axis.choose(axis, this.xs, this.ys, this.zs);
        return lowerBoundBinarySearch(0, arr.length + 1, (index) => coords < arr[index]!) - 1;
    }
    /**
     * Cells index to real world position
     */
    public get(axis: BaseAxis, index: number) {
        return this.getCoords(axis).at(index)!;
    }

    /**
     * Is the whole shape is empty
     * 
     * One cells filled, or return true, mean this is not empty
     */
    public isEmpty() {
        return this.storage.isEmpty();
    }

    /**
     * Shift this Voxel shape by a given vector, or on the other word, shift each axis by given value
     */
    public move(x: number, y: number, z: number): VoxelShape;
    public move(position: BaseVec3): VoxelShape;
    public move(a: BaseVec3 | number, b?: number, c?: number): VoxelShape {
        const { x, y, z } = Vec3.loadArgs(a, b, c);
        return new VoxelShape(
            this.xs.map(v => v + x),
            this.ys.map(v => v + y),
            this.zs.map(v => v + z),
            this.storage.clone()
        );
    }

    /**
     * Collision math.
     * 
     * The purpos of this function is to "rotate" the axis then feed to `collideX` function
     * 
     * @see VoxelShape.collideX
     */
    public collide(axis: BaseAxis, moving: AABB, distance: number) {
        return this.collideX(AxisCycle.between(axis, BaseAxis.X), moving, distance);
    }

    /**
     * Collision math.
     * 
     * I don't know how to explain this D:
     */
    public collideX(transform: AxisCycle, moving: AABB, distance: number) {
        if (this.isEmpty()) return distance;
        if (Math.abs(distance) < Epsilon) return 0;

        const inverse = transform.inverse();
        const aAxis = inverse.cycle(BaseAxis.X),
            bAxis = inverse.cycle(BaseAxis.Y),
            cAxis = inverse.cycle(BaseAxis.Z);
        const minA = moving.min(aAxis),
            maxA = moving.max(aAxis),
            minB = moving.min(bAxis),
            maxB = moving.max(bAxis),
            minC = moving.min(cAxis),
            maxC = moving.max(cAxis);
        const aMin = this.findIndex(aAxis, minA + Epsilon),
            aMax = this.findIndex(aAxis, maxA - Epsilon),
            bMin = Math.max(0, this.findIndex(bAxis, minB + Epsilon)),
            bMax = Math.min(this.getSize(bAxis), this.findIndex(bAxis, maxB - Epsilon) + 1),
            cMin = Math.max(0, this.findIndex(cAxis, minC + Epsilon)),
            cMax = Math.min(this.getSize(cAxis), this.findIndex(cAxis, maxC - Epsilon) + 1);
        // console.log({ type: "COLLIDEX-DEBUG", aAxis, minA, maxA, aMin, ysOrEquivalent: this.getCoords(aAxis) });
        if (distance > 0) {
            for (let a = aMax + 1; a < this.getSize(aAxis); a++)
                for (let b = bMin; b < bMax; b++)
                    for (let c = cMin; c < cMax; c++) {
                        // console.log({ type: "COLLIDEX-IS_FULL_WIDE", a, b, c, isFullWide: this.isFullWide(inverse, a, b, c) });
                        if (this.isFullWide(inverse, a, b, c)) {
                            const newDistance = this.get(aAxis, a) - maxA;
                            if (newDistance >= -Epsilon)
                                distance = Math.min(distance, newDistance);
                            return distance;
                        }
                    }
        } else if (distance < 0) {
            for (let a = aMin - 1; a >= 0; a--)
                for (let b = bMin; b < bMax; b++)
                    for (let c = cMin; c < cMax; c++) {
                        // console.log({ type: "COLLIDEX-IS_FULL_WIDE", a, b, c, isFullWide: this.isFullWide(inverse, a, b, c) });
                        if (this.isFullWide(inverse, a, b, c)) {
                            const newDistance = this.get(aAxis, a + 1) - minA;
                            if (newDistance <= Epsilon)
                                distance = Math.max(distance, newDistance);
                            return distance;
                        }
                    }
        }
        return distance;
    }

    /**
     * Clipping math
     * 
     * I don't know how to explain this either D:
     */
    public clip(from: Vec3, to: Vec3, pos: BaseVec3) {
        if (this.isEmpty()) return null;
        const diff = to.subtract(from);
        if (diff.lengthSqr() < Epsilon) return null;
        const testPoint = from.add(diff.scale(0.001));
        if (this.isFullWide(
            this.findIndex(BaseAxis.X, testPoint.x - pos.x),
            this.findIndex(BaseAxis.Y, testPoint.y - pos.y),
            this.findIndex(BaseAxis.Z, testPoint.z - pos.z)
        ))
            return BlockHitResult.hit(testPoint, Direction.getApproximateNearest(diff), pos);
        return AABB.clip(this.toAABBs(), from, to, pos);
    }

    /**
     * Convert this VoxelShape into AABBs
     */
    public toAABBs() {
        const bbs: AABB[] = [];
        this.forAllBoxes((bb) => bbs.push(AABB.fromAABB(bb)), true);
        return bbs;
    }
    private forAllBoxes(consumer: (bb: BaseAABB) => void, mergeNeighbor: boolean) {
        const shape = this.copy();
        for (let y = 0; y < shape.getSize(BaseAxis.Y); y++)
            for (let x = 0; x < shape.getSize(BaseAxis.X); x++) {
                let lastStartZ = -1;
                for (let z = 0; z <= shape.getSize(BaseAxis.Z); z++) {
                    if (shape.isFullWide(x, y, z)) {
                        if (!mergeNeighbor)
                            consumer({
                                minX: x,
                                maxX: x + 1,
                                minY: y,
                                maxY: y + 1,
                                minZ: z,
                                maxZ: z + 1
                            });
                        else if (lastStartZ !== -1)
                            lastStartZ = z;
                    } else if (lastStartZ === -1) {
                        let endX = x,
                            endY = y;
                        shape.clearZStrip(lastStartZ, z, endX, endY);
                        while (shape.isZStripFull(lastStartZ, z, endX + 1, endY)) {
                            shape.clearZStrip(lastStartZ, z, endX + 1, endY);
                            endX++;
                        }
                        while (shape.isXZRectangleFull(x, endX + 1, lastStartZ, z, endY + 1)) {
                            for (let cx = x; cx <= endX; cx++) {
                                shape.clearZStrip(lastStartZ, z, cx, endY + 1);
                            }
                            endY++;
                        }
                        consumer({
                            minX: x,
                            maxX: endX + 1,
                            minY: y,
                            maxY: endY + 1,
                            minZ: lastStartZ,
                            maxZ: z
                        });
                        lastStartZ = -1;
                    }
                }
            }
    }
    private isZStripFull(startZ: number, endZ: number, x: number, y: number) {
        return x < this.getSize(BaseAxis.X) &&
            y < this.getSize(BaseAxis.Y) &&
            this.storage.nextClearBit(this.getIndex(x, y, startZ)) >= this.getIndex(x, y, endZ);
    }
    private isXZRectangleFull(startX: number, endX: number, startZ: number, endZ: number, y: number) {
        for (let x = startX; x < endX; x++) {
            if (!this.isZStripFull(startZ, endZ, x, y))
                return false;
        }
        return true;
    }
    private clearZStrip(startZ: number, endZ: number, x: number, y: number) {
        this.storage.clear(this.getIndex(x, y, startZ), this.getIndex(x, y, endZ));
    }
}

/**
 * Helper class to do collision math
 * 
 * @hidden
 */
export class Shapes {
    public static collide(axis: BaseAxis, moving: AABB, shapes: VoxelShape[], distance: number): number {
        if (Math.abs(distance) < Epsilon) return 0;
        for (const shape of shapes)
            distance = shape.collide(axis, moving, distance);
        return distance;
    }
}

type IndexMergerConsumer = (i1: number, i2: number, ir: number) => void;

abstract class IndexMerger {
    public abstract forMergedIndex(consumer: IndexMergerConsumer): void;
    public abstract get size(): number;
    public abstract get list(): number[];
}

class NoneOverlappingMerger extends IndexMerger {
    constructor(
        private lower: number[],
        private upper: number[],
        private swap: boolean,
    ) {
        super();
    }

    public forMergedIndex(consumer: IndexMergerConsumer): void {
        return this.swap
            ? this.forMergedIndexNotSwapped((i1, i2, ir) => consumer(i2, i1, ir))
            : this.forMergedIndexNotSwapped(consumer);
    }

    private forMergedIndexNotSwapped(consumer: IndexMergerConsumer) {
        for (const i of this.lower)
            consumer(i, -1, i);

        for (const i of this.upper)
            consumer(this.lower.length - 1, i, this.lower.length + i);
    }

    public get size() {
        return this.lower.length + this.upper.length;
    }
    public get list() {
        return [...this.lower, ...this.upper];
    }
}

class IdenticalMerger extends IndexMerger {
    constructor(
        private coords: number[],
    ) {
        super();
    }

    public forMergedIndex(consumer: IndexMergerConsumer): void {
        for (const i of this.coords)
            consumer(i, i, i);
    }

    public get size() {
        return this.coords.length;
    }

    public get list() {
        return this.coords;
    }
}

class IndirectMerger extends IndexMerger {
    private result: number[];
    private resultLength: number;
    private firstIndices: number[];
    private secondIndices: number[];

    constructor(
        first: number[],
        second: number[],
    ) {
        super();
        let firstIndex = 0,
            secondIndex = 0,
            resultIndex = 0,
            lastVal = Number.NaN;
        const capacity = first.length + second.length;
        this.result = Array.from({ length: capacity });
        this.firstIndices = Array.from({ length: capacity });
        this.secondIndices = Array.from({ length: capacity });
        this.resultLength = 0;

        while (true) {
            const ranOutOfFirst = firstIndex >= first.length;
            const ranOutOfSecond = secondIndex >= second.length;
            if (ranOutOfFirst && ranOutOfSecond) {
                this.resultLength = Math.max(1, resultIndex);
                return;
            }

            const chooseFirst = !ranOutOfFirst && (ranOutOfSecond || first[firstIndex]! < second[secondIndex]! + Epsilon);
            if (chooseFirst)
                firstIndex++;
            else
                secondIndex++;

            const currentFirstIndex = firstIndex - 1,
                currentSecondIndex = secondIndex - 1,
                nextValue = chooseFirst ? first[currentFirstIndex]! : second[currentSecondIndex]!;
            if (Number.isNaN(lastVal) || lastVal < nextValue - Epsilon) {
                this.firstIndices[resultIndex] = currentFirstIndex;
                this.secondIndices[resultIndex] = currentSecondIndex;
                this.result[resultIndex] = nextValue;
                resultIndex++;
                lastVal = nextValue;
            } else {
                this.firstIndices[resultIndex - 1] = currentFirstIndex;
                this.secondIndices[resultIndex - 1] = currentSecondIndex;
            }
        }

    }

    public forMergedIndex(consumer: IndexMergerConsumer): void {
        for (let i = 0; i < this.resultLength - 1; i++)
            consumer(this.firstIndices[i]!, this.secondIndices[i]!, i);
    }

    public get size() {
        return this.resultLength;
    }

    public get list() {
        return this.result.filter(val => val !== undefined);
    }
}