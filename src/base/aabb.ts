import { Vec3 } from "./vector";

export class AABB {
    private static readonly EPSILON = 1.0E-7;
    public minX: number;
    public minY: number;
    public minZ: number;
    public maxX: number;
    public maxY: number;
    public maxZ: number;

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
        const { x: d, y: e, z: f } = Vec3.loadArgs(a, b, c);
        let g = this.minX;
        let h = this.minY;
        let i = this.minZ;
        let j = this.maxX;
        let k = this.maxY;
        let l = this.maxZ;
        if (d < 0.0) {
            g += d;
        } else if (d > 0.0) {
            j += d;
        }

        if (e < 0.0) {
            h += e;
        } else if (e > 0.0) {
            k += e;
        }

        if (f < 0.0) {
            i += f;
        } else if (f > 0.0) {
            l += f;
        }

        return new AABB(g, h, i, j, k, l);
    }

}