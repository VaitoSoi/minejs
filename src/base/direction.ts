export interface BaseVec3 {
    x: number,
    y: number,
    z: number
}

export class Vec3 implements BaseVec3 {
    public static readonly Zero = new Vec3(0, 0, 0);
    public static readonly XAxis = new Vec3(1, 0, 0);
    public static readonly YAxis = new Vec3(0, 1, 0);
    public static readonly ZAxis = new Vec3(0, 0, 1);

    static loadArgs(a: BaseVec3 | number, b?: number, c?: number): BaseVec3 {
        let x = 1, y = 1, z = 1;
        if (typeof a === "object" && "x" in a) {
            x = a.x;
            y = a.y;
            z = a.z;
        } else if (a !== undefined && b !== undefined && c !== undefined) {
            x = a;
            y = b;
            z = c;
        }
        return { x, y, z };
    }

    public x: number;
    public y: number;
    public z: number;

    constructor(vec3: BaseVec3)
    constructor(
        x: number,
        y: number,
        z: number
    )
    constructor(
        a: number | BaseVec3,
        b?: number,
        c?: number
    ) {
        const { x, y, z } = Vec3.loadArgs(a, b, c);
        this.x = x;
        this.y = y;
        this.z = z;
    }

    public copy() {
        return new Vec3(this.copyBase());
    }
    public copyBase(): BaseVec3 {
        return {
            x: this.x,
            y: this.y,
            z: this.z,
        };
    }

    public normalize() {
        const d = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
        return d < 1.0e-5 ? Vec3.Zero : new Vec3(this.x / d, this.y / d, this.z / d);
    }

    public dot(x: number, y: number, z: number): number;
    public dot(vec: BaseVec3): number;
    public dot(a: BaseVec3 | number, b?: number, c?: number): number {
        const vec = Vec3.loadArgs(a, b, c);
        return this.x * vec.x +
            this.y * vec.y +
            this.z * vec.z;
    }


    public cross(x: number, y: number, z: number): Vec3;
    public cross(vec: BaseVec3): Vec3;
    public cross(a: BaseVec3 | number, b?: number, c?: number): Vec3 {
        const vec = Vec3.loadArgs(a, b, c);
        return new Vec3(this.y * vec.z - this.z * vec.y, this.z * vec.x - this.x * vec.z, this.x * vec.y - this.y * vec.x);
    }

    public add(x: number, y: number, z: number): Vec3;
    public add(vec: BaseVec3): Vec3;
    public add(a: BaseVec3 | number, b?: number, c?: number) {
        const vec = Vec3.loadArgs(a, b, c);
        const x = this.x + vec.x,
            y = this.y + vec.y,
            z = this.z + vec.z;
        return new Vec3(x, y, z);
    }

    public subtract(x: number, y: number, z: number): Vec3;
    public subtract(vec: BaseVec3): Vec3;
    public subtract(a: BaseVec3 | number, b?: number, c?: number) {
        const vec = Vec3.loadArgs(a, b, c);
        const x = this.x - vec.x,
            y = this.y - vec.y,
            z = this.z - vec.z;
        return new Vec3(x, y, z);
    }

    public multiply(a: number | BaseVec3): Vec3;
    public multiply(x: number, y: number, z: number): Vec3;
    public multiply(a: BaseVec3 | number, b?: number, c?: number) {
        let vec: BaseVec3;
        if ((a && b && c) || (typeof a === "object" && "x" in a)) vec = Vec3.loadArgs(a, b, c);
        else vec = { x: a, y: a, z: a };
        const x = this.x * vec.x;
        const y = this.y * vec.y;
        const z = this.z * vec.z;
        return new Vec3(x, y, z);
    }

    public distanceTo(x: number, y: number, z: number): number;
    public distanceTo(vec: BaseVec3): number;
    public distanceTo(a: BaseVec3 | number, b?: number, c?: number): number {
        const vec = Vec3.loadArgs(a, b, c);
        const d = vec.x - this.x;
        const e = vec.y - this.y;
        const f = vec.z - this.z;
        return Math.sqrt(d * d + e * e + f * f);
    }

    public distanceToSqr(x: number, y: number, z: number): number;
    public distanceToSqr(vec: BaseVec3): number;
    public distanceToSqr(a: BaseVec3 | number, b?: number, c?: number): number {
        const vec = Vec3.loadArgs(a, b, c);
        const d = vec.x - this.x;
        const e = vec.y - this.y;
        const f = vec.z - this.z;
        return d * d + e * e + f * f;
    }

    public length() {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }
    public lengthSqr() {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }

    public equal(x: number, y: number, z: number): boolean;
    public equal(vec: BaseVec3): boolean;
    public equal(a: BaseVec3 | number, b?: number, c?: number): boolean {
        const vec = Vec3.loadArgs(a, b, c);
        return this.x === vec.x &&
            this.y === vec.y &&
            this.z === vec.z;
    }

    /**
     * Create new Vec3 with one updated value, keep the rest.
     * @param axis 
     * @param value 
     */
    public with(axis: BaseAxis, value: number) {
        const x = axis === BaseAxis.X ? value : this.x;
        const y = axis === BaseAxis.Y ? value : this.y;
        const z = axis === BaseAxis.Z ? value : this.z;
        return new Vec3(x, y, z);
    }

    /**
     * Get value of an axis
     * @param axis 
     * @returns 
     */
    public get(axis: BaseAxis) {
        return Axis.choose(axis,
            this.x,
            this.y,
            this.z,
        );
    }

    public horizontalDistance() {
        return Math.sqrt((this.x * this.x) + (this.z * this.z));
    }
    public horizontalDistanceSqr() {
        return (this.x * this.x) + (this.z * this.z);
    }

    public scale(val: number) {
        return this.multiply(val);
    }

    public isFinite() {
        return isFinite(this.x) && isFinite(this.y) && isFinite(this.z);
    }
}

export enum BaseAxis {
    X,
    Y,
    Z
}

export class Axis {
    public static choose<T>(axis: BaseAxis, x: T, y: T, z: T): T {
        switch (axis) {
            case BaseAxis.X: return x;
            case BaseAxis.Y: return y;
            case BaseAxis.Z: return z;
        }
    }

    public static stepOrder(x: number, z: number) {
        if (Math.abs(x) < Math.abs(z)) return [BaseAxis.Y, BaseAxis.Z, BaseAxis.X];
        return [BaseAxis.Y, BaseAxis.X, BaseAxis.Z];
    }
}

export abstract class AxisCycle {
    public static NONE: AxisCycle = new class extends AxisCycle {
        public cycle(axis: BaseAxis): BaseAxis {
            return axis;
        }
        public cycleCoords<T>(x: T, y: T, z: T, axis: BaseAxis): T {
            return Axis.choose(axis, x, y, z);
        }
        public inverse(): AxisCycle {
            return this;
        }
    };
    public static FORWARD: AxisCycle = new class extends AxisCycle {
        public cycle(axis: BaseAxis): BaseAxis {
            return AxisCycle.Axises[(axis + 1) % 3]!;
        }
        public cycleCoords<T>(x: T, y: T, z: T, axis: BaseAxis): T {
            return Axis.choose(axis, z, x, y);
        }
        public inverse(): AxisCycle {
            return AxisCycle.BACKWARD;
        }
    };
    /**
     * For the name explaination, in a cyclic three-value array, move forward 2 steps equals step backward 1 step.
     * 
     * Example:
     * ```
     * You are here
     *  v
     * [0, 1, 2]
     * ```
     * Now move two:
     * ```
     * Now you are here
     *        v
     * [0, 1, 2]
     * ```
     * Thats equal to, step one backward:
     * ```
     * you still here
     *        v
     * [0, 1, 2]
     * ```
     */
    public static BACKWARD: AxisCycle = new class extends AxisCycle {
        public cycle(axis: BaseAxis): BaseAxis {
            return AxisCycle.Axises[(axis - 1 + 3) % 3]!;
        }
        public cycleCoords<T>(x: T, y: T, z: T, axis: BaseAxis): T {
            return Axis.choose(axis, y, z, x);
        }
        public inverse(): AxisCycle {
            return AxisCycle.FORWARD;
        }
    };

    public static Values: AxisCycle[] = [this.NONE, this.FORWARD, this.BACKWARD];
    public static Axises: BaseAxis[] = [BaseAxis.X, BaseAxis.Y, BaseAxis.Z];

    public abstract cycle(axis: BaseAxis): BaseAxis;
    public abstract cycleCoords<T>(x: T, y: T, z: T, axis: BaseAxis): T;
    public abstract inverse(): AxisCycle;

    public static between(from: BaseAxis, to: BaseAxis): AxisCycle {
        return this.Values[(to - from + 3) % 3]!;
    }

    public static readonly isAxis = true;
}

export class Direction {
    public static readonly DOWN = new Direction(0, BaseAxis.Y, new Vec3(0, -1, 0));
    public static readonly UP = new Direction(1, BaseAxis.Y, new Vec3(0, 1, 0));
    public static readonly NORTH = new Direction(2, BaseAxis.Z, new Vec3(0, 0, -1));
    public static readonly SOUTH = new Direction(3, BaseAxis.Z, new Vec3(0, 0, 1));
    public static readonly WEST = new Direction(4, BaseAxis.X, new Vec3(-1, 0, 0));
    public static readonly EAST = new Direction(5, BaseAxis.X, new Vec3(1, 0, 0));
    public static readonly Values = [this.DOWN, this.UP, this.NORTH, this.SOUTH, this.WEST, this.EAST];

    constructor(
        public index3D: number,
        public axis: BaseAxis,
        public normal: Vec3
    ) { }

    public static getApproximateNearest(x: number, y: number, z: number): Direction;
    public static getApproximateNearest(vec: BaseVec3): Direction;
    public static getApproximateNearest(a: BaseVec3 | number, b?: number, c?: number): Direction {
        const { x: dx, y: dy, z: dz } = Vec3.loadArgs(a, b, c);
        let result = this.NORTH;
        let highestDot = Number.MIN_VALUE;
        for (const direction of this.Values) {
            const dot = (dx * direction.normal.x) + (dy * direction.normal.y) + (dz * direction.normal.z);
            if (dot > highestDot) {
                highestDot = dot;
                result = direction;
            }
        }
        return result;
    }
}

export interface Angle {
    yaw: number,
    pitch: number
}