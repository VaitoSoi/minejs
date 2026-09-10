import { Vec3 } from "../physics/direction";
import { CONTINUATION_FLAG, CONTINUE_BIT, MAX_QUANTIZED_VALUE, SCALE_BITS, SEGMENT_BITS } from "./static";
import { StringSizeExceedLimit, UnexpectedValue } from "../base/error";
import { Tag } from "./static";
import { unzipSync } from "zlib";
import { minBigInt } from "../base/math";
import { inspect } from "util";
import { ComponentTypeRegistry } from "../version/registry";
import { Slot } from "../world/container";

/** @hidden */
export function getTextFromTextComponent(component: any): string {
    if (component === null || component === undefined) return "null";
    switch (typeof component) {
        case "string":
            return component;
        case "object": {
            if (Array.isArray(component))
                return component.map(val => getTextFromTextComponent(val)).join();
            else if ("text" in component) {
                if ("extra" in component && Array.isArray(component["extra"]))
                    return component["text"] + component["extra"].map(val => getTextFromTextComponent(val)).join("");
                else return component["text"];
            } if ("translate" in component) {
                if ("fallback" in component) return component["fallback"];
                else return component["translate"];
            } else if ("keybind" in component)
                return component["keybind"];
            else
                throw new UnexpectedValue("value of component", "text component object", inspect(component, undefined, null));
        }
        default:
            throw new UnexpectedValue("type of component", "string or object", typeof component);
    }
}

/**
 * Binary decoding helper class
 */
export class BinaryDecoder {
    public buffer: Buffer = Buffer.alloc(0);
    public offset: number = 0;

    constructor(
        buffer: Buffer,
        needDecompress: boolean = false
    ) {
        if (!needDecompress)
            this.buffer = buffer;
        else
            this.buffer = unzipSync(buffer);
    }

    /**
     * Read shortcut
     * 
     * Read `size` bytes, use readFunc, then add `size` to internal offset
     */
    public read<T>(size: number, readFunc: (buffer: Buffer) => ((offset?: number) => T)): T {
        const val = readFunc(this.buffer).bind(this.buffer)(this.offset);
        this.offset += size;
        return val;
    }

    /**
     * Read 1 byte
     * @returns signed 1-byte integer
     */
    public readByte() { return this.read(1, (buffer) => buffer.readInt8); }
    /**
     * Read 1 byte
     * @returns unsigned 1-byte integer
     */
    public readUByte() { return this.read(1, (buffer) => buffer.readUint8); }
    /**
     * Read 2 bytes
     * @returns signed 2-byte integer
     */
    public readShort() { return this.read(2, (buffer) => buffer.readInt16BE); }
    /**
     * Read 2 bytes
     * @returns unsigned 2-byte integer
     */
    public readUShort() { return this.read(2, (buffer) => buffer.readUint16BE); }
    /**
     * Read 4 bytes
     * @returns signed 4-byte integer
     */
    public readInt() { return this.read(4, (buffer) => buffer.readInt32BE); }
    /**
     * Read 8 bytes
     * @returns signed 8-byte integer
     */
    public readLong() { return this.read(8, (buffer) => buffer.readBigInt64BE); }
    /**
     * Read 4 bytes
     * @returns signed 4-bytes decimal
     */
    public readFloat() { return this.read(4, (buffer) => buffer.readFloatBE); }
    /**
     * Read 8 bytes
     * @returns signed 8-byte decimal
     */
    public readDouble() { return this.read(8, (buffer) => buffer.readDoubleBE); }

    /**
     * Read 1 byte
     * @returns a boolean
     */
    public readBoolean() {
        const value = this.readByte();
        switch (value) {
            case 0x01: return true;
            case 0x00: return false;
            default: throw new Error(`unexpect value of boolean type: ${value}`);
        }
    }

    // Source: https://minecraft.wiki/w/Java_Edition_protocol/Packets#VarInt_and_VarLong
    /**
     * Read n bytes of integer
     * 
     * A VarInt packet would look like this:
     * 
     * `[7 bits of data][1 bit indicate if the VarInt ended here]`
     * 
     * @returns signed n-bit integer
     */
    public readVarInt() {
        let value = 0;
        let position = 0;
        let currentByte;

        while (true) {
            currentByte = this.readUByte();
            value |= (currentByte & SEGMENT_BITS) << position;

            if ((currentByte & CONTINUE_BIT) == 0) break;

            position += 7;

            if (position >= 32) throw new Error("VarInt is too big");
        }

        return value;
    }
    /**
     * Read n bytes of integer
     * 
     * Similar to VarInt, A VarLong packet would look like this:
     * 
     * `[7 bits of data][1 bit indicate if the VarLong ended here]`
     * 
     * @returns signed n-bit integer
     */
    public readVarLong() {
        let value: bigint = BigInt(0);
        let position = 0;
        let currentByte;

        while (true) {
            currentByte = this.readUByte();
            value |= BigInt((currentByte & SEGMENT_BITS) << position);

            if ((currentByte & CONTINUE_BIT) == 0) break;

            position += 7;

            if (position >= 64) throw new Error("VarLong is too big");
        }

        return value;
    }

    /**
     * Read a string
     * 
     * A string packet would look like this:
     * 
     * `[VarInt as length, if not provided][N bits of data]`
     * 
     * @returns a string
     */
    public readString(length?: number) {
        length ||= this.readVarInt();
        if (length == 0) return "";
        if (this.offset + length > this.buffer.length)
            throw new StringSizeExceedLimit();

        const string = this.buffer.subarray(this.offset, this.offset + length);
        this.offset += length;
        return string.toString("utf-8");
    }

    /**
     * Read a 16-byte UUID
     */
    public readUUID() {
        const buffer = this.buffer.subarray(this.offset, this.offset + 16);
        this.offset += 16;
        return buffer.toString('hex');
    }

    /**
     * Read a Position
     * 
     * A position packet is a 64-bit value, split into three signed integer parts:
     * ```
     * x: 26 MSBs
     * z: 26 middle bits
     * y: 12 LSBs
     * ```
     * 
     * @returns a Position
     */
    public readPosition(): { x: number, y: number, z: number } {
        const val = this.readLong(),
            x = val >> BigInt(38),
            y = val << BigInt(52) >> BigInt(52),
            z = val << BigInt(26) >> BigInt(38);
        return {
            x: Number(x),
            y: Number(y),
            z: Number(z),
        };
    }

    /**
     * Read an array with known length
     * 
     * @returns an array
     */
    public readArray<T>(length: number, readFunc: (decoder: BinaryDecoder, ind: number) => T): T[] {
        return Array.from({ length }).map((_, ind) => readFunc(this, ind));
    }

    /**
     * Read a length-prefixed array
     * 
     * An array packet would look like this:
     * `[VarInt as length][N bytes of data]`
     * 
     * @returns a length-prefixed array
     */
    public readPrefixedArray<T>(readFunc: (decoder: BinaryDecoder, ind: number) => T): T[] {
        const length = this.readVarInt();
        return this.readArray(length, readFunc);
    }

    /**
     * Read an array with known length and return Buffer
     * 
     * @param size size of the item, in byte
     * @returns an array
     */
    public readRawArray(length: number, size: number) {
        const buffer = this.buffer.subarray(this.offset, this.offset + size * length);
        this.offset += size * length;
        return buffer;
    }

    /**
     * Read a length-prefixed array and return the raw buffer
     * 
     * An array packet would look like this:
     * `[VarInt as length][N bytes of data]`
     * 
     * @param size size of the item, in byte
     * @returns a length-prefixed array
     */
    public readRawPrefixedArray(size: number) {
        const length = this.readVarInt();
        return this.readRawArray(length, size);
    }

    /**
     * Read a Teleport Flag packet
     * 
     * A Teleport Flag packet, which is bit mask represented as an int, would look like this:
     * | Hex Mask | Field                  |
     * |----------|------------------------|
     * | 0x0001   | Is X relative          |
     * | 0x0002   | Is Y relative          |
     * | 0x0004   | Is Z relative          |
     * | 0x0008   | Is Yaw relative        |
     * | 0x0010   | Is Pitch relative      |
     * | 0x0020   | Is Velocity X relative |
     * | 0x0040   | Is Velocity Y relative |
     * | 0x0080   | Is Velocity Z relative |
     * | 0x0100   | Rotate velocity        |
     */
    public readTeleportFlag() {
        const flags = this.readInt();
        const x = (flags & 0x0001) === 1,
            y = (flags & 0x0002) === 1,
            z = (flags & 0x0004) === 1,
            yaw = (flags & 0x0008) === 1,
            pitch = (flags & 0x0010) === 1,
            velX = (flags & 0x0020) === 1,
            velY = (flags & 0x0040) === 1,
            velZ = (flags & 0x0080) === 1,
            rotateVelocity = (flags & 0x0100) === 1;
        return {
            x,
            y,
            z,
            yaw,
            pitch,
            velX,
            velY,
            velZ,
            rotateVelocity,
        };
    }

    /**
     * Read a Prefixed Optional field
     * 
     * A Prefixed Optional would look like this:
     * `[Boolean to indicate whenether the following field is presented][N bytes of data if the boolean before is true, or else empty]`
     * 
     * @returns 
     */
    public readPrefixedOptional<T>(readFunc: (decoder: BinaryDecoder) => T): T | null {
        const isPresent = this.readBoolean();
        if (!isPresent) return null;
        return readFunc(this);
    }

    /**
     * Read a NBT
     */
    public readNBT() {
        const remainData = this.buffer.subarray(this.offset);
        const nbtDecoder = new NBTDecoder(remainData);
        const val = nbtDecoder.decode();
        this.offset += nbtDecoder.offset;
        return val;
    }

    // For reading LpVec3
    private unpack(value: number | bigint) {
        return minBigInt(
            BigInt(BigInt(value) & 32767n),
            BigInt(MAX_QUANTIZED_VALUE)
        ) * BigInt(2.0) / BigInt(MAX_QUANTIZED_VALUE) - 1n;
    }

    /**
     * Read LpVec3
     * 
     * Read this article for more information: https://minecraft.wiki/w/Java_Edition_protocol/Data_types#LpVec3
     */
    public readLpVec3(): Vec3 {
        const byte1 = this.readUByte();
        if (byte1 === 0) {
            return Vec3.Zero;
        }

        const byte2 = this.readUByte();
        const bytes3To6 = this.readInt(); // Should be UInt
        const packed = BigInt(bytes3To6 << 16) | BigInt(byte2 << 8) | BigInt(byte1);
        let scaleFactor = BigInt(byte1) & SCALE_BITS;
        if ((BigInt(byte1) & CONTINUATION_FLAG) != 0n)
            scaleFactor |= BigInt(this.readVarInt()) << 2n;

        const scaleFactorD = BigInt(scaleFactor);
        return new Vec3(
            Number(this.unpack(packed >> 3n) * scaleFactorD),
            Number(this.unpack(packed >> 18n) * scaleFactorD),
            Number(this.unpack(packed >> 33n) * scaleFactorD)
        );
    }

    /**
     * Resolve a fixed point to a double
     * 
     * A fixed point is a certain number of bits represent the signed integer part (number to the left of the decimal point) 
     * and the rest represent the fractional part (to the right).
     * 
     * @param x number to resole
     * @param n n fraction bits
     */
    public readFixedPoint(x: number, n: number) {
        return x / (1 << n);
    }

    /**
     * Read an angle.
     * 
     * An angle is a rotation angle in steps of 1/256 of a full turn
     */
    public readAngle() {
        return this.readByte();
    }

    /**
     * Represents a data record of type X, either inline, or by reference to a registry implied by context
     */
    public readIdOrX(readX: (decoder: BinaryDecoder) => any) {
        const id = this.readVarInt();
        if (id !== 0) return id;
        return readX(this);
    }

    /**
     * Represents a set of IDs in a certain registry (implied by context), either directly (enumerated IDs) or indirectly (tag name).
     * | Field Name | Field Type | Meaning |
     * |------------|------------|---------|
     * | Type       | VarInt     | Value used to determine the data that follows. It can be either: 0 - Represents a named set of IDs defined by a tag. Anything else - Represents an ad-hoc set of IDs enumerated inline. |
     * | Tag Name   | Optional Identifier | The registry tag defining the ID set. Only present if Type is 0. |
     * | IDs        | Optional Array of VarInt | An array of registry IDs. Only present if Type is not 0. The size of the array is equal to Type - 1. |
     */
    public readIdSet() {
        const type = this.readVarInt();
        let tagName: string | null = null,
            ids: number[] | null = null;
        if (type === 0) tagName = this.readString();
        else ids = this.readArray(type - 1, decoder => decoder.readVarInt());
        return {
            type,
            tagName,
            ids
        };
    }

    /**
     * Read Chat Type Decoration
     * 
     * The chat type decorations look like:
     * | Name            | Type                          | Description                      |
     * |-----------------|-------------------------------|----------------------------------|
     * | Translation Key | String                        |                                  |
     * | Parameters      | Prefixed Array of VarInt Enum | 0: sender, 1: target, 2: content |
     * | Style           | NBT                           |                                  |
     */
    public readChatTypeDecoration() {
        const translationKey = this.readString(),
            parameters = this.readPrefixedArray(decoder => decoder.readVarInt()),
            style = this.readNBT();
        return { translationKey, parameters, style };
    }

    /**
     * Read Chat Type
     */
    public readChatType() {
        return {
            chat: this.readChatTypeDecoration(),
            narration: this.readChatTypeDecoration()
        };
    }

    public readSoundEvent() {
        const name = this.readString(),
            fixedRange = this.readPrefixedOptional(decoder => decoder.readFloat());
        return { name, fixedRange };
    }

    private readBlockPredicate() {
        return {
            blocks: this.readPrefixedOptional(decoder => decoder.readIdSet()),
            properties: this.readPrefixedOptional(decoder => decoder.readPrefixedArray(decoder => {
                const name = decoder.readString(),
                    isExactMatch = decoder.readBoolean(),
                    exactValue = isExactMatch ? decoder.readString() : undefined,
                    minValue = !isExactMatch ? decoder.readString() : undefined,
                    maxValue = !isExactMatch ? decoder.readString() : undefined;
                return {
                    name,
                    isExactMatch,
                    exactValue,
                    minValue,
                    maxValue
                };
            })),
            nbt: this.readNBT(),
            components: this.readPrefixedArray(this.readComponent),
            partialComponent: this.readPrefixedArray(decoder => ({
                type: decoder.readVarInt(),
                predicate: decoder.readNBT()
            }))
        };
    }

    private readPotionEffect(): Record<string, any> {
        const type = this.readVarInt();
        const readDetail = (decoder: BinaryDecoder): Record<string, any> => ({
            amplifier: decoder.readVarInt(),
            duration: decoder.readVarInt(),
            ambient: decoder.readBoolean(),
            showParticles: decoder.readBoolean(),
            showIcon: decoder.readBoolean(),
            hiddenEffect: decoder.readPrefixedOptional(decoder => readDetail(decoder))
        });
        return {
            type,
            ...(readDetail(this))
        };
    }

    private readFireworkExplosion() {
        return {
            shape: this.readVarInt(),
            colors: this.readPrefixedArray(decoder => decoder.readInt()),
            fadeColors: this.readPrefixedArray(decoder => decoder.readInt()),
            hasTrail: this.readBoolean(),
            hasTwinkle: this.readBoolean()
        };
    }

    private readCosumeEffect() {
        const type = this.readVarInt();
        let data: Record<string, any> = {};
        switch (type) {
            case 0: data = {
                effects: this.readPrefixedArray(decoder => decoder.readPotionEffect()),
                probability: this.readFloat()
            }; break;
            case 1: data = {
                effects: this.readIdSet()
            }; break;
            case 2: break;
            case 3: data = { diameter: this.readFloat() }; break;
            case 4: data = { sound: this.readSoundEvent() }; break;
        }
        return data;
    }

    private readInstrument() {
        return {
            soundEvent: this.readIdOrX(decoder => decoder.readSoundEvent()),
            useDuration: this.readFloat(),
            range: this.readFloat(),
            description: this.readNBT()
        };
    }

    private readJukeboxSong() {
        return {
            soundEvent: this.readIdOrX(decoder => decoder.readSoundEvent()),
            description: this.readNBT(),
            duration: this.readFloat(),
            output: this.readVarInt()
        };
    }

    private readKineticWeaponCondition() {
        return {
            maxDurationTicks: this.readVarInt(),
            minSpeed: this.readFloat(),
            minRelativeSpeed: this.readFloat()
        };
    }

    /**
     * @returns Describes a Minecraft player profile
     */
    public readProfile() {
        return {
            uuid: this.readUUID(),
            username: this.readString(),
            properties: this.readPrefixedArray(decoder => ({
                name: decoder.readString(),
                value: this.readString(),
                signature: this.readPrefixedOptional(decoder => decoder.readString())
            }))
        };
    }

    private readPartialProfile() {
        return {
            username: this.readPrefixedOptional(decoder => decoder.readString()),
            uuid: this.readPrefixedOptional(decoder => decoder.readUUID()),
            properties: this.readPrefixedArray(decoder => ({
                name: decoder.readString(),
                value: this.readString(),
                signature: this.readPrefixedOptional(decoder => decoder.readString())
            }))
        };
    }

    private readResolvableProfile() {
        const kind = this.readVarInt(),
            profile = kind == 0 ? this.readPartialProfile() : this.readProfile(),
            body = this.readPrefixedOptional(decoder => decoder.readString()),
            cape = this.readPrefixedOptional(decoder => decoder.readString()),
            elytra = this.readPrefixedOptional(decoder => decoder.readString()),
            model = this.readPrefixedOptional(decoder => decoder.readVarInt());
        return {
            kind,
            profile,
            body,
            cape,
            elytra,
            model
        };
    }

    private readTrimMaterial() {
        return {
            suffix: this.readString(),
            overides: this.readPrefixedArray(decoder => ({
                armorMaterialType: this.readString(),
                overridenAssetName: this.readString(),
            })),
            description: this.readNBT()
        };
    }

    private readTrimPattern() {
        return {
            assetName: this.readString(),
            templateItem: this.readVarInt(),
            description: this.readNBT(),
            decal: this.readBoolean()
        };
    }

    private readComponent() {
        const data: Record<string, any> = {};
        const id = this.readVarInt();
        const name = ComponentTypeRegistry.idToName[id]!;
        switch (name) {
            case "minecraft:additional_trade_cost":
                data["minecraft:additional_trade_cost"] = this.readVarInt();
                break;
            case "minecraft:attack_range":
                data["minecraft:attack_range"] = {
                    minReach: this.readFloat(),
                    maxReach: this.readFloat(),
                    minCreativeReach: this.readFloat(),
                    maxCreativeReach: this.readFloat(),
                    hitboxMargin: this.readFloat(),
                    mobFactor: this.readFloat(),
                };
                break;
            case "minecraft:attribute_modifiers":
                data["minecraft:attribute_modifiers"] = this.readPrefixedArray((decoder) => ({
                    attributeId: decoder.readVarInt(),
                    modifierId: decoder.readString(),
                    value: decoder.readDouble(),
                    operation: decoder.readVarInt(),
                    slot: decoder.readVarInt(),
                }));
                break;
            case "minecraft:axolotl/variant":
                data["minecraft:axolotl/variant"] = this.readVarInt();
                break;
            case "minecraft:banner_patterns":
                data["minecraft:banner_patterns"] = this.readPrefixedArray((decoder) => ({
                    patternType: decoder.readIdOrX((decoder) => ({
                        assetId: decoder.readString(),
                        translationKey: decoder.readString()
                    }))
                }));
                break;
            case "minecraft:base_color":
                data["minecraft:base_color"] = this.readVarInt();
                break;
            case "minecraft:bees":
                data["minecraft:bees"] = this.readPrefixedArray((decoder) => ({
                    entityType: decoder.readVarInt(),
                    entityData: decoder.readNBT(),
                    ticksInHive: decoder.readVarInt(),
                    minTicksInHive: decoder.readVarInt(),
                }));
                break;
            case "minecraft:block_entity_data":
                data["minecraft:block_entity_data"] = {
                    type: this.readVarInt(),
                    data: this.readNBT()
                };
                break;
            case "minecraft:block_state":
                data["minecraft:block_state"] = this.readPrefixedArray((decoder) => ({
                    name: decoder.readString(),
                    value: decoder.readString()
                }));
                break;
            case "minecraft:blocks_attacks":
                data["minecraft:blocks_attacks"] = {
                    blockDelaySeconds: this.readFloat(),
                    disableCooldownScale: this.readFloat(),
                    damageReductions: this.readPrefixedArray((decoder) => ({
                        horizontalBlockingAngle: decoder.readFloat(),
                        type: decoder.readPrefixedOptional((decoder) => decoder.readIdSet()),
                        base: decoder.readFloat(),
                        factor: decoder.readFloat()
                    })),
                    itemDamageThresholod: this.readFloat(),
                    itemDamageBase: this.readFloat(),
                    itemDamageFactor: this.readFloat(),
                    bypassedBy: this.readPrefixedOptional(decoder => decoder.readIdSet()),
                    blockSound: this.readPrefixedOptional(decoder => decoder.readIdOrX(decoder => decoder.readSoundEvent())),
                    disableSound: this.readPrefixedOptional(decoder => decoder.readIdOrX(decoder => decoder.readSoundEvent())),
                };
                break;
            case "minecraft:break_sound":
                data["minecraft:break_sound"] = this.readIdOrX(decoder => decoder.readSoundEvent());
                break;
            case "minecraft:bucket_entity_data":
                data["minecraft:bucket_entity_data"] = this.readNBT();
                break;
            case "minecraft:bundle_contents":
                data["minecraft:bundle_contents"] = this.readPrefixedArray(decoder => decoder.readSlot());
                break;
            case "minecraft:can_break":
                data["minecraft:can_break"] = this.readPrefixedArray(this.readBlockPredicate);
                break;
            case "minecraft:can_place_on":
                data["minecraft:can_place_on"] = this.readPrefixedArray(this.readBlockPredicate);
                break;
            case "minecraft:cat/collar":
                data["minecraft:cat/collar"] = this.readVarInt();
                break;
            case "minecraft:cat/sound_variant":
                data["minecraft:cat/sound_variant"] = this.readVarInt();
                break;
            case "minecraft:cat/variant":
                data["minecraft:cat/variant"] = this.readVarInt();
                break;
            case "minecraft:charged_projectiles":
                data["minecraft:charged_projectiles"] = this.readPrefixedArray(decoder => decoder.readSlot());
                break;
            case "minecraft:chicken/sound_variant":
                data["minecraft:chicken/sound_variant"] = this.readVarInt();
                break;
            case "minecraft:chicken/variant":
                data["minecraft:chicken/variant"] = this.readVarInt();
                break;
            case "minecraft:consumable":
                data["minecraft:consumable"] = {
                    consumeSecond: this.readFloat(),
                    animation: this.readVarInt(),
                    sound: this.readIdOrX(decoder => decoder.readSoundEvent()),
                    hasConsumeParticles: this.readBoolean(),
                    effect: this.readPrefixedArray(decoder => decoder.readCosumeEffect())
                };
                break;
            case "minecraft:container":
                data["minecraft:container"] = this.readPrefixedArray(decoder => decoder.readSlot());
                break;
            case "minecraft:container_loot":
                data["minecraft:container_loot"] = this.readNBT();
                break;
            case "minecraft:cow/sound_variant":
                data["minecraft:cow/sound_variant"] = this.readVarInt();
                break;
            case "minecraft:cow/variant":
                data["minecraft:cow/variant"] = this.readVarInt();
                break;
            case "minecraft:creative_slot_lock":
                data["minecraft:creative_slot_lock"] = {};
                break;
            case "minecraft:custom_data":
                data["minecraft:custom_data"] = this.readNBT();
                break;
            case "minecraft:custom_model_data":
                data["minecraft:custom_model_data"] = {
                    floats: this.readPrefixedArray(decoder => decoder.readFloat()),
                    flags: this.readPrefixedArray(decoder => decoder.readBoolean()),
                    strings: this.readPrefixedArray(decoder => decoder.readString()),
                    colors: this.readPrefixedArray(decoder => decoder.readInt())
                };
                break;
            case "minecraft:custom_name":
                data["minecraft:custom_name"] = this.readNBT();
                break;
            case "minecraft:damage":
                data["minecraft:damage"] = this.readVarInt();
                break;
            case "minecraft:damage_resistant":
                data["minecraft:damage_resistant"] = this.readIdSet();
                break;
            case "minecraft:damage_type":
                data["minecraft:damage_type"] = this.readVarInt();
                break;
            case "minecraft:death_protection":
                data["minecraft:death_protection"] = {
                    effects: this.readPrefixedArray(decoder => decoder.readCosumeEffect())
                };
                break;
            case "minecraft:debug_stick_state":
                data["minecraft:debug_stick_state"] = this.readNBT();
                break;
            case "minecraft:dye":
                data["minecraft:dye"] = this.readVarInt();
                break;
            case "minecraft:dyed_color":
                data["minecraft:dyed_color"] = this.readInt();
                break;
            case "minecraft:enchantable":
                data["minecraft:enchantable"] = this.readVarInt();
                break;
            case "minecraft:enchantment_glint_override":
                data["minecraft:enchantment_glint_override"] = this.readBoolean();
                break;
            case "minecraft:enchantments":
                data["minecraft:enchantments"] = this.readPrefixedArray(decoder => ({
                    typeId: decoder.readVarInt(),
                    level: this.readVarInt()
                }));
                break;
            case "minecraft:entity_data":
                data["minecraft:entity_data"] = {
                    type: this.readVarInt(),
                    data: this.readNBT()
                };
                break;
            case "minecraft:equippable":
                data["minecraft:equippable"] = {
                    slot: this.readVarInt(),
                    equipSound: this.readIdOrX(decoder => decoder.readSoundEvent()),
                    model: this.readPrefixedOptional(decoder => decoder.readString()),
                    cameraOverlay: this.readPrefixedOptional(decoder => decoder.readString()),
                    allowedEntities: this.readPrefixedOptional(decoder => decoder.readIdSet()),
                    dispensable: this.readBoolean(),
                    swappable: this.readBoolean(),
                    damageOnHurt: this.readBoolean(),
                    canBeSheared: this.readBoolean(),
                    shearingSound: this.readIdOrX(decoder => decoder.readSoundEvent())
                };
                break;
            case "minecraft:firework_explosion":
                data["minecraft:firework_explosion"] = this.readFireworkExplosion();
                break;
            case "minecraft:fireworks":
                data["minecraft:fireworks"] = {
                    duration: this.readVarInt(),
                    explosions: this.readPrefixedArray(decoder => decoder.readFireworkExplosion())
                };
                break;
            case "minecraft:food":
                data["minecraft:food"] = {
                    nutrition: this.readVarInt(),
                    saturationModifier: this.readFloat(),
                    canAlwaysEat: this.readBoolean()
                };
                break;
            case "minecraft:fox/variant":
                data["minecraft:fox/variant"] = this.readVarInt();
                break;
            case "minecraft:frog/variant":
                data["minecraft:frog/variant"] = this.readVarInt();
                break;
            case "minecraft:glider":
                data["minecraft:glider"] = {};
                break;
            case "minecraft:horse/variant":
                data["minecraft:horse/variant"] = this.readVarInt();
                break;
            case "minecraft:instrument":
                data["minecraft:instrument"] = this.readIdOrX(decoder => decoder.readInstrument());
                break;
            case "minecraft:intangible_projectile":
                data["minecraft:intangible_projectile"] = this.readNBT();
                break;
            case "minecraft:item_model":
                data["minecraft:item_model"] = this.readString();
                break;
            case "minecraft:item_name":
                data["minecraft:item_name"] = this.readNBT();
                break;
            case "minecraft:jukebox_playable":
                data["minecraft:jukebox_playable"] = this.readIdOrX(decoder => decoder.readJukeboxSong());
                break;
            case "minecraft:kinetic_weapon":
                data["minecraft:kinetic_weapon"] = {
                    contactCooldownTicks: this.readVarInt(),
                    delayTicks: this.readVarInt(),
                    dismountConditions: this.readPrefixedOptional(decoder => decoder.readKineticWeaponCondition()),
                    knockbackConditions: this.readPrefixedOptional(decoder => decoder.readKineticWeaponCondition()),
                    damageConditions: this.readPrefixedOptional(decoder => decoder.readKineticWeaponCondition()),
                    forwardMovement: this.readFloat(),
                    damageMultiplier: this.readFloat(),
                    sound: this.readPrefixedOptional(decoder => decoder.readSoundEvent()),
                    hitSound: this.readPrefixedOptional(decoder => decoder.readSoundEvent())
                };
                break;
            case "minecraft:llama/variant":
                data["minecraft:llama/variant"] = this.readVarInt();
                break;
            case "minecraft:lock":
                data["minecraft:lock"] = this.readNBT();
                break;
            case "minecraft:lodestone_tracker": {
                const hasGlobalPosition = this.readBoolean(),
                    dimension = hasGlobalPosition ? this.readString() : undefined,
                    position = hasGlobalPosition ? this.readPosition() : undefined,
                    tracked = this.readBoolean();
                data["minecraft:lodestone_tracker"] = {
                    hasGlobalPosition,
                    dimension,
                    position,
                    tracked
                };
                break;
            }
            case "minecraft:lore":
                data["minecraft:lore"] = this.readPrefixedArray(decoder => decoder.readNBT());
                break;
            case "minecraft:map_color":
                data["minecraft:map_color"] = this.readInt();
                break;
            case "minecraft:map_decorations":
                data["minecraft:map_decorations"] = this.readNBT();
                break;
            case "minecraft:map_id":
                data["minecraft:map_id"] = this.readVarInt();
                break;
            case "minecraft:map_post_processing":
                data["minecraft:map_post_processing"] = this.readVarInt();
                break;
            case "minecraft:max_damage":
                data["minecraft:max_damage"] = this.readVarInt();
                break;
            case "minecraft:max_stack_size":
                data["minecraft:max_stack_size"] = this.readVarInt();
                break;
            case "minecraft:minimum_attack_charge":
                data["minecraft:minimum_attack_charge"] = this.readFloat();
                break;
            case "minecraft:mooshroom/variant":
                data["minecraft:mooshroom/variant"] = this.readVarInt();
                break;
            case "minecraft:note_block_sound":
                data["minecraft:note_block_sound"] = this.readString();
                break;
            case "minecraft:ominous_bottle_amplifier":
                data["minecraft:ominous_bottle_amplifier"] = this.readVarInt();
                break;
            case "minecraft:painting/variant":
                data["minecraft:painting/variant"] = {
                    width: this.readInt(),
                    height: this.readVarInt(),
                    assetId: this.readString(),
                    title: this.readPrefixedOptional(decoder => decoder.readNBT()),
                    author: this.readPrefixedOptional(decoder => decoder.readNBT()),
                };
                break;
            case "minecraft:parrot/variant":
                data["minecraft:parrot/variant"] = this.readVarInt();
                break;
            case "minecraft:piercing_weapon":
                data["minecraft:piercing_weapon"] = {
                    dealKnockback: this.readBoolean(),
                    dismounts: this.readBoolean(),
                    sound: this.readPrefixedOptional(decoder => decoder.readSoundEvent()),
                    hitSound: this.readPrefixedOptional(decoder => decoder.readSoundEvent())
                };
                break;
            case "minecraft:pig/sound_variant":
                data["minecraft:pig/sound_variant"] = this.readVarInt();
                break;
            case "minecraft:pig/variant":
                data["minecraft:pig/variant"] = this.readVarInt();
                break;
            case "minecraft:pot_decorations":
                data["minecraft:pot_decorations"] = this.readPrefixedArray(decoder => decoder.readVarInt());
                break;
            case "minecraft:potion_contents":
                data["minecraft:potion_contents"] = {
                    id: this.readPrefixedOptional(decoder => decoder.readVarInt()),
                    color: this.readPrefixedOptional(decoder => decoder.readInt()),
                    effects: this.readPrefixedArray(decoder => decoder.readPotionEffect()),
                    name: this.readPrefixedOptional(decoder => decoder.readString())
                };
                break;
            case "minecraft:potion_duration_scale":
                data["minecraft:potion_duration_scale"] = this.readFloat();
                break;
            case "minecraft:profile":
                data["minecraft:profile"] = this.readResolvableProfile();
                break;
            case "minecraft:provides_banner_patterns":
                data["minecraft:provides_banner_patterns"] = this.readIdSet();
                break;
            case "minecraft:provides_trim_material":
                data["minecraft:provides_trim_material"] = this.readIdOrX(decoder => decoder.readTrimMaterial());
                break;
            case "minecraft:rabbit/variant":
                data["minecraft:rabbit/variant"] = this.readVarInt();
                break;
            case "minecraft:rarity":
                data["minecraft:rarity"] = this.readVarInt();
                break;
            case "minecraft:recipes":
                data["minecraft:recipes"] = this.readNBT();
                break;
            case "minecraft:repair_cost":
                data["minecraft:repair_cost"] = this.readVarInt();
                break;
            case "minecraft:repairable":
                data["minecraft:repairable"] = this.readIdSet();
                break;
            case "minecraft:salmon/size":
                data["minecraft:salmon/size"] = this.readVarInt();
                break;
            case "minecraft:sheep/color":
                data["minecraft:sheep/color"] = this.readVarInt();
                break;
            case "minecraft:shulker/color":
                data["minecraft:shulker/color"] = this.readVarInt();
                break;
            case "minecraft:stored_enchantments":
                data["minecraft:stored_enchantments"] = this.readPrefixedArray(decoder => ({
                    typeId: decoder.readVarInt(),
                    level: decoder.readVarInt()
                }));
                break;
            case "minecraft:sulfur_cube_content":
                data["minecraft:sulfur_cube_content"] = this.readSlot();
                break;
            case "minecraft:suspicious_stew_effects":
                data["minecraft:suspicious_stew_effects"] = this.readPrefixedArray(decoder => ({
                    typeId: this.readVarInt(),
                    duration: this.readVarInt()
                }));
                break;
            case "minecraft:swing_animation":
                data["minecraft:swing_animation"] = {
                    type: this.readVarInt(),
                    duration: this.readVarInt()
                };
                break;
            case "minecraft:tool":
                data["minecraft:tool"] = {
                    rules: this.readPrefixedArray(decoder => ({
                        blocks: this.readIdSet(),
                        speed: this.readPrefixedOptional(decoder => decoder.readFloat()),
                        correctDropForBlock: this.readPrefixedOptional(decoder => decoder.readBoolean())
                    }))
                };
                break;
            case "minecraft:tooltip_display":
                data["minecraft:tooltip_display"] = {
                    hideTooltip: this.readBoolean(),
                    hiddenComponents: this.readPrefixedArray(decoder => decoder.readVarInt())
                };
                break;
            case "minecraft:tooltip_style":
                data["minecraft:tooltip_style"] = this.readString();
                break;
            case "minecraft:trim":
                data["minecraft:trim"] = {
                    material: this.readIdOrX(decoder => decoder.readTrimMaterial()),
                    pattern: this.readIdOrX(decoder => decoder.readTrimPattern())
                };
                break;
            case "minecraft:tropical_fish/base_color":
                data["minecraft:tropical_fish/base_color"] = this.readVarInt();
                break;
            case "minecraft:tropical_fish/pattern":
                data["minecraft:tropical_fish/pattern"] = this.readVarInt();
                break;
            case "minecraft:tropical_fish/pattern_color":
                data["minecraft:tropical_fish/pattern_color"] = this.readVarInt();
                break;
            case "minecraft:unbreakable":
                data["minecraft:unbreakable"] = {};
                break;
            case "minecraft:use_cooldown":
                data["minecraft:use_cooldown"] = {
                    seconds: this.readFloat(),
                    cooldownGroup: this.readPrefixedOptional(decoder => decoder.readString())
                };
                break;
            case "minecraft:use_effects":
                data["minecraft:use_effects"] = {
                    canSprint: this.readBoolean(),
                    interactVibrations: this.readBoolean(),
                    speedMultiplier: this.readFloat()
                };
                break;
            case "minecraft:use_remainder":
                data["minecraft:use_remainder"] = this.readSlot();
                break;
            case "minecraft:villager/variant":
                data["minecraft:villager/variant"] = this.readVarInt();
                break;
            case "minecraft:weapon":
                data["minecraft:weapon"] = {
                    damagePerAttack: this.readVarInt(),
                    disableBlockFor: this.readFloat()
                };
                break;
            case "minecraft:wolf/collar":
                data["minecraft:wolf/collar"] = this.readVarInt();
                break;
            case "minecraft:wolf/sound_variant":
                data["minecraft:wolf/sound_variant"] = this.readVarInt();
                break;
            case "minecraft:wolf/variant":
                data["minecraft:wolf/variant"] = this.readVarInt();
                break;
            case "minecraft:writable_book_content":
                data["minecraft:writable_book_content"] = this.readPrefixedArray(decoder => ({
                    rawContent: decoder.readString(),
                    filteredContent: decoder.readPrefixedOptional(decoder => decoder.readString())
                }));
                break;
            case "minecraft:written_book_content":
                data["minecraft:written_book_content"] = {
                    rawTitle: this.readString(),
                    filteredTitle: this.readPrefixedOptional(decoder => decoder.readString()),
                    author: this.readString(),
                    generation: this.readVarInt(),
                    pages: this.readPrefixedArray(decoder => ({
                        rawContent: decoder.readString(),
                        filteredContent: decoder.readPrefixedOptional(decoder => decoder.readString())
                    })),
                    resolved: this.readBoolean()
                };
                break;
            case "minecraft:zombie_nautilus/variant":
                data["minecraft:zombie_nautilus/variant"] = this.readVarInt();
                break;
        }
        return data;
    }

    /**
     * Represent the data of a slot
     * 
     * @see https://minecraft.wiki/w/Java_Edition_protocol/Slot_data#Format
     */
    public readSlot(): Slot {
        const counts = this.readVarInt(),
            itemId = counts ? this.readVarInt() : undefined,
            addCount = counts ? this.readVarInt() : undefined,
            removeCount = counts ? this.readVarInt() : undefined,
            addComponents = addCount ? this.readArray(addCount, decoder => decoder.readComponent())
                .reduce((prev, curr) => {
                    Object.keys(curr).forEach(key => prev[key] = curr[key]);
                    return prev;
                }, {}) : undefined,
            removeComponents = removeCount ? this.readArray(removeCount, decoder => decoder.readVarInt()) : undefined;
        return { counts, itemId, addComponents, removeComponents };
    }
}

export class NBTDecoder extends BinaryDecoder {
    /**
     * Read a Compound string
     * 
     * A string packet would look like this:
     * 
     * `[2 bytes as length][N bits of data]`
     * 
     * @returns a string
     */
    public readCompoundString() {
        const length = this.readUShort();
        if (length == 0) return "";

        return this.readString(length);
    }

    /**
     * Read a list / array of tag
     * 
     * A list / array packet should look like this:
     * [1 byte of type, if not provided][4 bytes of length][N bits of data]
     * 
     * @returns 
     */
    public readCompoundList(type?: number): any[] {
        type ||= this.readByte();
        const length = this.readInt();
        const array = Array.from({ length })
            .map(() => this.readCompoundValue(type));
        return array;
    }

    /**
     * Read compound value base on provided tag
     */
    public readCompoundValue(tag: number): any {
        switch (tag) {
            case Tag.Byte: return this.readByte();
            case Tag.Short: return this.readShort();
            case Tag.Int: return this.readInt();
            case Tag.Long: return this.readLong();
            case Tag.Float: return this.readFloat();
            case Tag.Double: return this.readDouble();
            case Tag.ByteArray: return this.readCompoundList(Tag.Byte);
            case Tag.String: return this.readCompoundString();
            case Tag.List: return this.readCompoundList();
            case Tag.Compound: return this.readCompound();
            case Tag.IntArray: return this.readCompoundList(Tag.Int);
            case Tag.LongArray: return this.readCompoundList(Tag.Long);
            default: throw new UnexpectedValue("compound tag", tag.toString());
        }
    }


    /**
     * Read n bits
     * 
     * A Compound entry would look like this:
     * 
     * [1 byte of Type][2 byte of field name length][N bits of field length][N bits of data]
     * 
     * @returns signed n-bit integer
     */
    public readCompound() {
        const obj: Record<string, any> = {};

        while (true) {
            const type = this.readByte();
            if (type === Tag.End) return obj;

            const name = this.readCompoundString();
            const value = this.readCompoundValue(type);
            obj[name] = value;
        }
    }

    /**
     * Read an NBT
     * 
     * Note that Network NBT slice some root data so I have to specified it through `isNetwork` param
     * 
     * @param isNetwork
     * @returns
     */
    public decode(isNetwork: boolean = true) {
        const type = this.readByte();
        if (type === Tag.Compound || type === Tag.List) {
            if (!isNetwork) this.readCompoundString();
            const value = this.readCompoundValue(type);

            return value;
        } else if (type === Tag.End) return {};
        else {
            if (!isNetwork) this.readCompoundString();
            const value = this.readCompoundValue(type);
            return value;
        }
    }
}

export class SNBTDecoder {
    private offset = 0;

    constructor(private readonly source: string) { }

    private skipWhiteSpace() {
        while (this.offset < this.source.length) {
            // console.log({
            //     off: this.offset,
            //     ch: this.source[this.offset],
            //     a: this.source[this.offset] !== " ",
            //     b: this.source[this.offset] !== "\n"
            // });
            if (
                this.source[this.offset] !== " " &&
                this.source[this.offset] !== "," &&
                this.source[this.offset] !== "\n"
            ) return;
            this.offset += 1;
        }
        throw new UnexpectedValue("end of SNBT", "white space");
    }

    private convertValue(val: string): number | bigint | boolean | string {
        if (
            (!isNaN(Number(val))) ||
            val.endsWith("b") || val.endsWith("B") ||
            val.endsWith("s") || val.endsWith("S") ||
            val.endsWith("i") || val.endsWith("I") ||
            val.endsWith("F") || val.endsWith("F")
        ) return Number(val);
        if (
            val.endsWith("l") || val.endsWith("L") ||
            val.endsWith("d") || val.endsWith("D") ||
            BigInt(val) % BigInt(1) !== BigInt(0)
        ) return BigInt(val);
        if (val === "true") return true;
        if (val === "false") return false;
        if (
            (val.startsWith("'") && val.endsWith("'")) ||
            (val.startsWith('"') && val.endsWith("'"))
        ) return String(val.slice(1, -1));
        return val;
    }

    // eoc = End Of Compound
    private seek(): [fieldName: string, value: any] | undefined {
        this.skipWhiteSpace();

        if (this.source[this.offset] == "}")
            return undefined;

        let fieldName = "";
        let sliceQuote: "'" | '"' | undefined = undefined;
        let ch: string;
        if (this.source[this.offset] === "'" || this.source[this.offset] === '"') {
            sliceQuote = this.source[this.offset] as "'" | '"';
            this.offset++;
        }
        while (true) {
            ch = this.source[this.offset]!;
            if (
                ((sliceQuote == undefined && ch === ":") ||
                    (sliceQuote && ch === sliceQuote)) ||
                this.offset >= this.source.length
            ) {
                this.offset++;
                break;
            }
            fieldName += ch;
            this.offset++;
        }
        if (sliceQuote)
            this.offset++;

        this.skipWhiteSpace();

        let stringtifiedVal = "",
            convertedVal: any = undefined,
            type: "number" | "string_1" | "string_2" | "list" | "array" = "number";

        outer:
        while (true) {
            ch = this.source[this.offset]!;

            switch (ch) {
                case "[":
                    type = "list";
                    break;

                // End of Array or Line
                case "]":
                    if (type === "array" || type === "list") {
                        this.offset++;
                        break outer;
                    }
                    stringtifiedVal += ch;
                    break;

                case ",":
                    if (type !== "array" && type !== "list") {
                        this.offset++;
                        break outer;
                    }
                    stringtifiedVal += ch;
                    break;

                // String indicator, if found repeated mean it is the end of the string
                case "'":
                    if (stringtifiedVal.endsWith("\\") || type == "list") {
                        stringtifiedVal += ch;
                        break;
                    }
                    if (type == "string_1") {
                        this.offset++;
                        break outer;
                    }
                    type = "string_1";
                    break;
                case '"':
                    if (stringtifiedVal.endsWith("\\") || type == "list") {
                        stringtifiedVal += ch;
                        break;
                    }
                    if (type == "string_2") {
                        this.offset++;
                        break outer;
                    }
                    type = "string_2";
                    break;

                // Array type indicator
                case "B":
                case "I":
                case "L":
                    type = "array";
                    this.offset++;
                    break;

                case "{":
                    if (type != "list") {
                        convertedVal = this.obj();
                        break outer;
                    } else {
                        stringtifiedVal += ch;
                        break;
                    }

                default:
                    if (ch === " " && type == "number") break outer;
                    stringtifiedVal += ch;
                    break;
            }

            this.offset++;
        }

        if (stringtifiedVal !== "" && !convertedVal) {
            if (type == "array")
                convertedVal = stringtifiedVal.split(",")
                    .map(val =>
                        this.convertValue(val.trim())
                    );
            else if (type == "list") {
                convertedVal = stringtifiedVal.split(",")
                    .map(val => {
                        val = val.trim();
                        if (val.startsWith("{") && val.endsWith("}")) {
                            const decoder = new SNBTDecoder(val);
                            const obj = decoder.decode();
                            if (
                                Object.keys(obj).length != 1 ||
                                !("" in obj)
                            ) return obj;
                            return obj[""];
                        } else return this.convertValue(val);
                    });
            } else {
                if (type == "string_1" || type == "string_2")
                    convertedVal = stringtifiedVal;
                else
                    convertedVal = this.convertValue(stringtifiedVal);
            }
        }

        return [fieldName, convertedVal];
    }

    private obj() {
        if (this.source[this.offset] !== "{")
            throw new UnexpectedValue("start of compound", "{", this.source[this.offset]);
        this.offset++;
        const obj: Record<string, any> = {};
        while (this.offset < this.source.length) {
            const val = this.seek();
            if (!val) break;

            const [fieldName, fieldVal] = val;
            obj[fieldName] = fieldVal;
        }
        return obj;
    }


    public decode() {
        return this.obj();
    }
}