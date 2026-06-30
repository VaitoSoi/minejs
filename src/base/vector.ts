export enum Axis {
    X,
    Y,
    Z
}

export interface Position {
    x: number,
    y: number,
    z: number
}

export class Vec3 implements Position {
    public static readonly Zero = new Vec3(0, 0, 0);
    public static readonly XAxis = new Vec3(1, 0, 0);
    public static readonly YAxis = new Vec3(0, 1, 0);
    public static readonly ZAxis = new Vec3(0, 0, 1);

    static loadArgs(a: Position | number, b?: number, c?: number) {
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

    constructor(
        public x: number,
        public y: number,
        public z: number
    ) { }

    public normalize() {
        const d = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
        return d < 1.0e-5 ? Vec3.Zero : new Vec3(this.x / d, this.y / d, this.z / d);
    }

    public dot(vec: Vec3) {
        return this.x * vec.x +
            this.y * vec.y +
            this.z * vec.z;
    }

    public cross(vec: Vec3) {
        return new Vec3(this.y * vec.z - this.z * vec.y, this.z * vec.x - this.x * vec.z, this.x * vec.y - this.y * vec.x);
    }

    public add(x: number, y: number, z: number): void;
    public add(vec: Vec3): void;
    public add(a: Vec3 | number, b?: number, c?: number) {
        const vec = Vec3.loadArgs(a, b, c);
        this.x += vec.x;
        this.y += vec.y;
        this.z += vec.z;
    }

    public subtract(x: number, y: number, z: number): void;
    public subtract(vec: Vec3): void;
    public subtract(a: Vec3 | number, b?: number, c?: number) {
        const vec = Vec3.loadArgs(a, b, c);
        this.x -= vec.x;
        this.y -= vec.y;
        this.z -= vec.z;
    }

    public multiply(x: number, y: number, z: number): void;
    public multiply(vec: Vec3): void;
    public multiply(a: Vec3 | number, b?: number, c?: number): void {
        const vec = Vec3.loadArgs(a, b, c);
        this.x *= vec.x;
        this.y *= vec.y;
        this.z *= vec.z;
    }

    public distanceTo(vec: Vec3) {
        const d = vec.x - this.x;
        const e = vec.y - this.y;
        const f = vec.z - this.z;
        return Math.sqrt(d * d + e * e + f * f);
    }

    public distanceToSqr(x: number, y: number, z: number): number;
    public distanceToSqr(vec: Vec3): number;
    public distanceToSqr(a: Vec3 | number, b?: number, c?: number): number {
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

    public equal(vec: Vec3) {
        return this.x === vec.x &&
            this.y === vec.y &&
            this.z === vec.z;
    }

    /**
     * Update one axis of the vector, keep the res
     * @param axis 
     * @param value 
     */
    public with(axis: Axis, value: number) {
        const x = axis === Axis.X ? value : this.x;
        const y = axis === Axis.Y ? value : this.y;
        const z = axis === Axis.Z ? value : this.z;
        return new Vec3(x, y, z);
    }

    /**
     * Get value of an axis
     * @param axis 
     * @returns 
     */
    public get(axis: Axis) {
        switch (axis) {
            case Axis.X: return this.x;
            case Axis.Y: return this.y;
            case Axis.Z: return this.z;
        }
    }
}

export interface Angle {
    yaw: number,
    pitch: number
}