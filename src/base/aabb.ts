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
        d: number,
        e: number,
        f: number,
        g: number,
        h: number,
        i: number,
    ) {
        this.minX = Math.min(d, g);
        this.minY = Math.min(e, h);
        this.minZ = Math.min(f, i);
        this.maxX = Math.max(d, g);
        this.maxY = Math.max(e, h);
        this.maxZ = Math.max(f, i);
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