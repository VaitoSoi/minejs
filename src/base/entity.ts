import { AABB } from "./aabb";

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


    public getSectionKey(x: number, y: number, z: number) {
        // Divide 2^4 = 16
        const sx = x >> 4, sy = y >> 4, sz = z >> 4;
        return `${sx}:${sy}:${sz}`;
    }

    public add(entityId: number, x: number, y: number, z: number) {
        const key = this.getSectionKey(x, y, z);
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
        const newKey = this.getSectionKey(x, y, z);
        if (this.entityToSection.get(entityId) !== newKey) {
            this.remove(entityId);
            this.add(entityId, x, y, z);
        }
    }

    public queryAABB(aabb: AABB) {
        const { minX, minY, minZ, maxX, maxY, maxZ } = aabb;
        const results = [];
        const sx0 = minX >> 4, sx1 = maxX >> 4;
        const sy0 = minY >> 4, sy1 = maxY >> 4;
        const sz0 = minZ >> 4, sz1 = maxZ >> 4;

        for (let sx = sx0; sx <= sx1; sx++) {
            for (let sy = sy0; sy <= sy1; sy++) {
                for (let sz = sz0; sz <= sz1; sz++) {
                    const bucket = this.sections.get(`${sx},${sy},${sz}`);
                    if (bucket) for (const id of bucket) results.push(id);
                }
            }
        }
        return results; // candidate set — still needs AABB-exact filtering below
    }
}