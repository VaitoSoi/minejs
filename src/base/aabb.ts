import { RegistryItemNotFound } from "./error";
import { EntityRegistry } from "./registry";

export interface BaseAABB {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

export class AABB implements BaseAABB {
    public static readonly EPSILON = 1.0E-7;
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
        if (!(type in EntityRegistry.data) || !(type in EntityRegistry.mapTypeToData))
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