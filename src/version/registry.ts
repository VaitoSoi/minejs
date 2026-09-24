import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RegistryItemNotFound, UnexpectedValue, VersionNotSupport } from "../base/error";
import { Block, BlockState } from "../world/block";
import z from "zod";

const BASE_REGISTRY_PATH = join(__dirname, "..", "..", "assets", "minecraft");
/** @hidden */
export const SupportVersions = [
    "26.2",
    "26.3"
];

/** @hidden */
export const ProtocolVersionMapping: Record<string, number> = {
    "26.2": 776,
    "26.3": 777
};

function getFile(version: string, module: string) {
    const map = JSON.parse(readFileSync(join(BASE_REGISTRY_PATH, "versionMapping.json"), "utf-8"));
    if (!(version in map))
        throw new VersionNotSupport(version);
    const versionMap = map[version];
    if (!(module in versionMap))
        throw new VersionNotSupport(version);
    const fileContent = JSON.parse(readFileSync(join(BASE_REGISTRY_PATH, versionMap[module], `${module}.json`), "utf-8"));
    return fileContent;
}

export class EntityRegistry {
    private static loaded: boolean = false;
    public static readonly data: Record<string, { height: number, width: number, type: number }> = {};
    public static readonly mapTypeToData: Record<number, string> = {};

    /**
     * Load entity registry from JSON file.
     * 
     * Should be called once time
     */
    public static load(version: string) {
        if (!SupportVersions.includes(version))
            throw new VersionNotSupport(version);
        if (this.loaded) return;
        this.loaded = true;

        const json = getFile(version, "entities");
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
    public static load(version: string) {
        if (!SupportVersions.includes(version))
            throw new VersionNotSupport(version);
        if (this.loaded) return;
        this.loaded = true;

        const json = getFile(version, "blocks") as Record<string, any>;
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

export class EffectRegistry {
    private static loaded: boolean = false;

    public static readonly effects: Record<string, number> = {};

    /**
     * Load effects registry from JSON file.
     * 
     * Should be called once time
     */
    public static load(version: string) {
        if (!SupportVersions.includes(version))
            throw new VersionNotSupport(version);
        if (this.loaded) return;
        this.loaded = true;

        const json = getFile(version, "effects") as Record<string, any>;
        for (const [name, id] of Object.entries(json)) {
            this.effects[name] = id;
        }
    }
}

export class ComponentTypeRegistry {
    private static loaded: boolean = false;

    public static readonly components: Record<string, number> = {};
    public static readonly idToName: Record<number, string> = {};

    /**
     * Load effects registry from JSON file.
     * 
     * Should be called once time
     */
    public static load(version: string) {
        if (!SupportVersions.includes(version))
            throw new VersionNotSupport(version);
        if (this.loaded) return;
        this.loaded = true;

        const json = getFile(version, "components") as Record<string, number>;
        for (const [name, id] of Object.entries(json)) {
            this.components[name] = id;
            this.idToName[id] = name;
        }
    }
}

/** @hidden */
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
    "fixed_bitset",
    "byte_array",
    "slot",
    "null", // a constant
    "special",

    /**
     * This is used for handle field that its type depends on previous field type, or value
     */
    "switch"
]);
/** @hidden */
export type FieldNode = ({
    type: Exclude<z.infer<typeof SupportTypes>,
        | "prefixed_array"
        | "prefixed_optional"
        | "string"
        | "id_or_x"
        | "array"
        | "switch"
        | "fixed_point"
        | "enum"
        | "object"
        | "not_implemented"
        | "fixed_bitset"
        | "byte_array"
        | "special"
    >,
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
} | {
    type: "fixed_bitset" | "byte_array",
    length: number,
} | {
    type: "special",
    comment: string,
}) & {
    skip_able?: boolean | undefined
}
/** @hidden */
export const Field: z.ZodType<FieldNode> = z.union([
    z.object({
        type: SupportTypes.exclude(["prefixed_array", "prefixed_optional", "string", "id_or_x", "array", "switch", "fixed_point", "enum", "not_implemented", "object", "fixed_bitset", "byte_array", "special"]),
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
    z.object({
        // These type require predefined-length
        type: z.union([z.literal("fixed_bitset"), z.literal("byte_array")]),
        length: z.int()
    }),
    z.object({
        type: z.literal(["special"]),
        comment: z.string()
    }),
])
    .and(
        z.object({
            skip_able: z.boolean().optional()
        })
    );
/** @hidden */
export const PacketObject = z.object({
    name: z.string(),
    id: z.number(),
    structure: z.record(z.string(), Field),
    skipForNow: z.boolean().default(false)
});
/** @hidden */
export const PacketsDefinition = z.record(z.string().or(z.number()), PacketObject);
/** @hidden */
export const StatesDefinition = z.object({
    clientbound: PacketsDefinition,
    serverbound: PacketsDefinition,
});
/** @hidden */
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
    public static load(version: string) {
        if (!SupportVersions.includes(version))
            throw new VersionNotSupport(version);
        if (this.loaded) return;
        this.loaded = true;

        const json = getFile(version, "packets") as Record<string, any>;

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