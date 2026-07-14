import { TCPClient } from "../client/tcp";
import { AABB } from "./aabb";
import { ClientNotReady } from "./error";

export class EntitiesManager {
    /**
     * Split chunks into 16x16x16 sections, so each chunk sections will contain a set of entities
     * 
     * A key is `{chunkSectionX}:{chunkSectionY}:{chunkSectionZ}`
     */
    public sections: Map<string, Set<number>> = new Map();
    /**
     * A map mapping entity ID to section key.
     */
    public entityToSection: Map<number, string> = new Map();

    constructor(private tcp: TCPClient) { }

    public wipe() {
        this.sections = new Map();
        this.entityToSection = new Map();
    }

    public static getSectionKey(x: number, y: number, z: number) {
        // Divide 2^4 = 16
        const sx = x >> 4, sy = y >> 4, sz = z >> 4;
        return `${sx}:${sy}:${sz}`;
    }

    public add(entityId: number, x: number, y: number, z: number) {
        const key = EntitiesManager.getSectionKey(x, y, z);
        if (!this.sections.has(key)) this.sections.set(key, new Set());
        this.sections.get(key)!.add(entityId);
        this.entityToSection.set(entityId, key);
    }

    public remove(entityId: number) {
        const key = this.entityToSection.get(entityId);
        if (key) {
            this.sections.get(key)?.delete(entityId);
            this.entityToSection.delete(entityId);
        }
    }

    public update(entityId: number, x: number, y: number, z: number) {
        const newKey = EntitiesManager.getSectionKey(x, y, z);
        if (this.entityToSection.get(entityId) !== newKey) {
            this.remove(entityId);
            this.add(entityId, x, y, z);
        }
    }

    /**
     * Query the entity in the section that intersec with BB
     * @param queryBB The querying bounding box
     * @returns
     */
    public queryAABB(queryBB: AABB, exclude: number[] = []) {
        this.tcp.checkReady();

        const { minX, minY, minZ, maxX, maxY, maxZ } = queryBB;
        const results: AABB[] = [];
        const sx0 = minX >> 4, sx1 = maxX >> 4;
        const sy0 = minY >> 4, sy1 = maxY >> 4;
        const sz0 = minZ >> 4, sz1 = maxZ >> 4;

        for (let sx = sx0; sx <= sx1; sx++) {
            for (let sy = sy0; sy <= sy1; sy++) {
                for (let sz = sz0; sz <= sz1; sz++) {
                    const bucket = this.sections.get(`${sx},${sy},${sz}`);
                    if (bucket) for (const id of bucket) {
                        if (exclude.includes(id)) continue;
                        const entity = this.tcp.world!.entities[id];
                        const entityBB = AABB.fromEntityType(entity!.type);
                        if (queryBB.isIntersect(entityBB))
                            results.push(entityBB);
                    }
                }
            }
        }

        return results;
    }
}

export enum MoverType {
    SELF,
    PLAYER,
    PISTON,
    SHULKER_BOX,
    SHULKER
}