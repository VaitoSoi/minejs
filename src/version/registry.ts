import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RegistryItemNotFound, UnexpectedValue, VersionNotSupport } from "../base/error";
import { Block, BlockState } from "../world/block";
import z from "zod";

export const BASE_REGISTRY_PATH = join(__dirname, "..", "..", "assets", "minecraft");
export const SupportVersions = [
    "26.2"
];

export const ProtocolVersionMapping: Record<string, number> = {
    "26.2": 776
};

export class EntityRegistry {
    private static loaded: boolean = false;
    public static readonly data: Record<string, { height: number, width: number, type: number }> = {};
    public static readonly mapTypeToData: Record<number, string> = {};

    /**
     * Load entity registry from JSON file.
     * 
     * Should be called once time
     */
    public static async load(version: string) {
        if (!SupportVersions.includes(version))
            throw new VersionNotSupport(version);
        if (this.loaded) return;
        this.loaded = true;

        const file = await readFile(join(BASE_REGISTRY_PATH, version, "entities.json"), { encoding: "utf8" });
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
    public static async load(version: string) {
        if (!SupportVersions.includes(version))
            throw new VersionNotSupport(version);
        if (this.loaded) return;
        this.loaded = true;

        const file = await readFile(join(BASE_REGISTRY_PATH, version, "blocks.json"), { encoding: "utf8" });
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

export const SupportTypes = z.enum([
    "byte",
    "unsigned_byte",
    "short",
    "unsigned_short",
    "int",
    "long",
    "float",
    "double",
    "boolean",
    "var_int",
    "var_long",
    "string",
    "uuid",
    "position",
    "array",
    "prefixed_array",
    "teleport_flag",
    "prefixed_optional",
    "nbt",
    "lpvec3",
    "fixed_point",
    "angle",
    "id_or_x",
    "id_set",
    "chat_type_decoration",
    "chat_type",
    "enum",
    "json_text",
    "not_implemented",
    "varies",
    "object",
    "game_profile",
    "heightmap",
    "teleport_flags",
    "bitset",
    "null", // a constant

    /**
     * This is used for handle field that its type depends on previous field type, or value
     */
    "switch"
]);
export type FieldNode = ({
    type: Exclude<z.infer<typeof SupportTypes>, "prefixed_array" | "prefixed_optional" | "string" | "id_or_x" | "array" | "switch" | "fixed_point" | "enum" | "object" | "not_implemented">,
} | {
    type: "not_implemented",
    comment?: string | undefined
} | {
    type: "object",
    fields: Record<string, FieldNode>
} | {
    type: "prefixed_array",
    subType: FieldNode,
    length?: number | undefined,
} | {
    type: "id_or_x" | "enum" | "prefixed_optional",
    subType: FieldNode
} | {
    type: "string",
    length?: number | undefined
} | {
    type: "array",
    subType: FieldNode,
    length: string | number,
} | {
    type: "switch",
    dependsOn: string,
    cases: [string, FieldNode][],
    default?: FieldNode | undefined
} | {
    type: "fixed_point",
    subType: FieldNode,
    fractionBits: number
}) & {
    skip_able?: boolean | undefined
}
export const Field: z.ZodType<FieldNode> = z.union([
    z.object({
        type: SupportTypes.exclude(["prefixed_array", "prefixed_optional", "string", "id_or_x", "array", "switch", "fixed_point", "enum", "not_implemented", "object"]),
    }),
    z.object({
        type: z.literal(["not_implemented"]),
        comment: z.string().optional()
    }),
    z.object({
        type: z.literal(["object"]),
        fields: z.record(z.string(), z.lazy(() => Field))
    }),
    z.object({
        type: z.literal(["prefixed_array"]),
        /**
         * For case like `Array<subType>` or `PrefixedOptional<subType>`
         */
        subType: z.lazy(() => Field),
        /**
         * The length of the array type, not used.
         */
        length: z.number().optional()
    }),
    z.object({
        type: z.literal(["id_or_x", "enum", "prefixed_optional"]),
        /**
         * For case like `Array<subType>` or `PrefixedOptional<subType>`
         */
        subType: z.lazy(() => Field),
    }),
    z.object({
        type: z.literal("string"),
        /**
         * The length of the string, not used.
         */
        length: z.number().optional(),
    }),
    z.object({
        type: z.literal("array"),
        /**
         * For case like `Array<subType>` or `PrefixedOptional<subType>`
         */
        subType: z.lazy(() => Field),
        /**
         * Specially for `array` type, which is not prefixed with length.
         * 
         * Point to another field, should be numberic field
         */
        length: z.string().or(z.number()),
    }),
    z.object({
        type: z.literal("switch"),
        /**
         * Specially for case that this field type depends on other field value.
         * 
         * Point to the field that this field is depended on.
         */
        dependsOn: z.string(),
        /**
         * Mapping depend value to type
         */
        cases: z.array(z.tuple([z.any(), z.lazy(() => Field)])),
        default: z.lazy(() => Field).optional(),
    }),
    z.object({
        type: z.literal(["fixed_point"]),
        /**
         * For case like `Array<subType>` or `PrefixedOptional<subType>`
         */
        subType: z.lazy(() => Field),
        fractionBits: z.number()
    }),
])
    .and(
        z.object({
            skip_able: z.boolean().optional()
        })
    );
export const PacketObject = z.object({
    name: z.string(),
    id: z.number(),
    structure: z.record(z.string(), Field),
    skipForNow: z.boolean().default(false)
});
export const PacketsDefinition = z.record(z.string().or(z.number()), PacketObject);
export const StatesDefinition = z.object({
    clientbound: PacketsDefinition,
    serverbound: PacketsDefinition,
});
export const VersionDefinitions = z.object({
    handshaking: StatesDefinition,
    status: StatesDefinition,
    login: StatesDefinition,
    configuration: StatesDefinition,
    play: StatesDefinition,
});

export class PacketRegistry {
    private static loaded: boolean = false;
    private static definition: z.infer<typeof VersionDefinitions>;
    private static nameToId: Record<
        string, // State
        Record<
            string, // Type
            Record<string, number> // Packet
        >
    > = {};

    /**
     * Load block registry from JSON file.
     * 
     * Should be called once time
     */
    public static async load(version: string) {
        if (!SupportVersions.includes(version))
            throw new VersionNotSupport(version);
        if (this.loaded) return;
        this.loaded = true;

        const file = await readFile(join(BASE_REGISTRY_PATH, version, "packets.json"), { encoding: "utf8" });
        const json = JSON.parse(file) as Record<string, any>;

        const definition = VersionDefinitions.parse(json);
        for (const [stateKey, state] of Object.entries(definition)) {
            this.nameToId[stateKey] = {};
            for (const [typeKey, type] of Object.entries(state)) {
                this.nameToId[stateKey]![typeKey] = {};
                // eslint-disable-next-line prefer-const
                for (let [key, value] of Object.entries(type) as [string | number, any]) {
                    this.nameToId[stateKey]![typeKey]![value.name] = key;
                }
            }
        }
        this.definition = definition;
    }

    public static getPacket(
        state: keyof z.infer<typeof VersionDefinitions>,
        type: keyof z.infer<typeof StatesDefinition>,
        id: string | number
    ): z.infer<typeof PacketObject> | undefined {
        const nameToId = this.nameToId[state]?.[type]?.[id]?.toString();
        if (nameToId)
            return this.definition[state][type][nameToId]!;
        let numbericId;
        if (typeof id === "string")
            numbericId = parseInt(id, 16);
        else numbericId = id;
        if (isNaN(numbericId))
            throw new UnexpectedValue("valid packet id", id.toString(), "name or number or hex");
        else
            return this.definition[state][type]["0x" + numbericId.toString(16).toUpperCase()];
    }
}