import { Axis, Position, Vec3 } from "./vector";
import { RegistryItemNotFound } from "./error";
import { EntityRegistry } from "./registry";
import { lowerBoundBinarySearch, mergeUnique } from "./math";

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

    public static fromEntityType(type: string | number) {
        if (this.EntityBoundingBoxes[type])
            return this.EntityBoundingBoxes[type];
        if (!(type in EntityRegistry.data) && !(type in EntityRegistry.mapTypeToData))
            throw new RegistryItemNotFound(`entity type ${type}`);
        const { height, width } = EntityRegistry.get(type)!;
        return this.fromDimension(height, width);
    }

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

    public equal(aabb: AABB) {
        return this.minX === aabb.minX &&
            this.minY === aabb.minY &&
            this.minZ === aabb.minZ &&
            this.maxX === aabb.maxX &&
            this.maxY === aabb.maxY &&
            this.maxZ === aabb.maxZ;
    }

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

    public move(x: number, y: number, z: number): AABB;
    public move(aabb: BaseVec3): AABB;
    public move(a: BaseVec3 | number, b?: number, c?: number): AABB {
        const { x, y, z } = Vec3.loadArgs(a, b, c);
        const { minX, minY, minZ, maxX, maxY, maxZ } = this;
        return new AABB(minX + x, minY + y, minZ + z, maxX + x, maxY + y, maxZ + z);
    }

    public isIntersect(other: AABB) {
        return this.minX < other.maxX && this.maxX > other.minX &&
            this.minY < other.maxY && this.maxY > other.minY &&
            this.minZ < other.maxZ && this.maxZ > other.minZ;
    }

    public min(axis: BaseAxis) {
        return Axis.choose(axis,
            this.minX,
            this.minY,
            this.minZ
        );
    }
    public max(axis: BaseAxis) {
        return Axis.choose(axis,
            this.maxX,
            this.maxY,
            this.maxZ
        );
    }

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

export class VoxelShape {
    public fromBox(bb: AABB) {
        const xs = [bb.minX, bb.maxX],
            ys = [bb.minY, bb.maxY],
            zs = [bb.minZ, bb.maxZ];
        const cells = [[[true]]];
        return new VoxelShape(xs, ys, zs, cells);
    }
    public static or(a: VoxelShape, b: VoxelShape) {
        const mergeX: number[] = mergeUnique(a.xs, b.xs),
            mergeY: number[] = mergeUnique(a.ys, b.ys),
            mergeZ: number[] = mergeUnique(a.zs, b.zs);

        const cells: boolean[][][] =
            Array.from({ length: mergeX.length - 1 }).map(() =>
                Array.from({ length: mergeY.length - 1 }).map(() =>
                    Array.from({ length: mergeZ.length - 1 }).map(() => false)
                )
            );

        for (let ix = 0; ix < mergeX.length - 2; ix++)
            for (let iy = 0; iy < mergeY.length - 2; iy++)
                for (let iz = 0; iz < mergeZ.length - 2; iz++) {
                    const x = mergeX[ix]! + AABB.EPSILON,
                        y = mergeY[iy]! + AABB.EPSILON,
                        z = mergeZ[iz]! + AABB.EPSILON;

                    if (a.isFullWide(
                        a.findIndex(Axis.X, x),
                        a.findIndex(Axis.Y, y),
                        a.findIndex(Axis.Z, z)
                    ) || b.isFullWide(
                        b.findIndex(Axis.X, x), 
                        b.findIndex(Axis.Y, y), 
                        b.findIndex(Axis.Z, z)
                    ))
                        cells[ix]![iy]![iz] = true;
                }

        return new VoxelShape(mergeX, mergeY, mergeZ, cells);
    }

    constructor(
        public xs: number[],
        public ys: number[],
        public zs: number[],
        public cells: boolean[][][]
    ) { }

    public isFullWide(x: number, y: number, z: number) {
        if (x < 0 || x >= this.xs.length) return false;
        if (y < 0 || y >= this.ys.length) return false;
        if (z < 0 || z >= this.zs.length) return false;
        return this.cells[x]![y]![z];
    }

    public findIndex(axis: Axis, val: number) {
        let arr;
        switch (axis) {
            case Axis.X: arr = this.xs; break;
            case Axis.Y: arr = this.ys; break;
            case Axis.Z: arr = this.zs; break;
        }

        return lowerBoundBinarySearch(0, arr.length + 1, (index) => index < val) - 1;
    }
}