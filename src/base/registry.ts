import { readFile } from "fs/promises";
import { BaseAABB } from "./aabb";

export class EntityRegistry {
    private static loaded: boolean = false;
    public static readonly data: Record<string, { height: number, width: number, type: number }> = {};
    public static readonly mapTypeToData: Record<number, string> = {};

    public static async load() {
        if (this.loaded) return;
        this.loaded = true;

        const file = await readFile(`${__dirname}/../../assets/minecraft/entity_dimension.json`, { encoding: "utf8" });
        const json = JSON.parse(file);
        for (const entity in json) {
            this.data[entity] = json[entity];
            this.mapTypeToData[json[entity]["type"]] = entity;
        }
    }

    public static get(entity: string | number) {
        if (typeof entity === "string") {
            return this.data[entity];
        } else {
            const key = this.mapTypeToData[entity];
            return this.data[key!];
        }
    }
};

export class BlockStateRegistry {
    private static loaded: boolean = false;
    public static readonly data: Record<string,
        Record<string, { boxes: BaseAABB[], state: string }>
    > = {};
    public static readonly mapIdToState: Record<string, { boxes: BaseAABB[], state: string }> = {};

    public static async load() {
        if (this.loaded) return;
        this.loaded = true;

        const file = await readFile(`${__dirname}/../../assets/minecraft/blocks.json`, { encoding: "utf8" });
    }
};