import { readFile } from "fs/promises";
import { RegistryItemNotFound } from "./error";
import { Block, BlockState } from "./block";

export class EntityRegistry {
    private static loaded: boolean = false;
    public static readonly data: Record<string, { height: number, width: number, type: number }> = {};
    public static readonly mapTypeToData: Record<number, string> = {};

    /**
     * Load entity registry from JSON file.
     * 
     * Should be called once time
     */
    public static async load() {
        if (this.loaded) return;
        this.loaded = true;

        const file = await readFile(`${__dirname}/../../assets/minecraft/entities.json`, { encoding: "utf8" });
        const json = JSON.parse(file);
        for (const entity in json) {
            this.data[entity] = json[entity];
            this.mapTypeToData[json[entity]["id"]] = entity;
        }
    }

    /**
     * Get an entity registy item
     */
    public static get(entity: string | number) {
        if (typeof entity === "string") {
            return this.data[entity];
        } else {
            const key = this.mapTypeToData[entity];
            return this.data[key!];
        }
    }
};

export class BlockRegistry {
    private static loaded: boolean = false;
    /**
     * block id to block
     */
    public static readonly blocks: Record<string, Block> = {};
    /**
     * state id to block state
     */
    public static readonly states: Record<string, BlockState> = {};

    /**
     * Load block registry from JSON file.
     * 
     * Should be called once time
     */
    public static async load() {
        if (this.loaded) return;
        this.loaded = true;

        const file = await readFile(`${__dirname}/../../assets/minecraft/blocks.json`, { encoding: "utf8" });
        const json = JSON.parse(file) as Record<string, any>;
        for (const [type, blockRaw] of Object.entries(json)) {
            const block = new Block(type, blockRaw['definition'], blockRaw['properties'], blockRaw['states']);
            this.blocks[type] = block;
            for (const state of block.states)
                this.states[state.id] = state;
        }
    }

    /**
     * Get a block registy item
     */
    public static getBlock(type: string) {
        if (!(type in this.blocks))
            throw new RegistryItemNotFound(`block ${type}`);
        return this.blocks[type]!;
    }

    /**
     * Get a block state registy item
     */
    public static getState(id: string) {
        if (!(id in this.states))
            throw new RegistryItemNotFound(`block state ${id}`);
        return this.states[id]!;
    }
};