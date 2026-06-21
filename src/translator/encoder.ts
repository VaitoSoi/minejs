import { Vector } from "../base/vector";
import { CONTINUE_BIT, isFixedSizeTag, isTag, SEGMENT_BITS } from "../translator/static";
import { InvalidValue, NumberTooBig, UnexpectedValue } from "../base/error";
import { FixedSizeTag, Tag } from "./static";
import { deflate } from "zlib";
import { promisify } from "util";

export class BinaryEncoder {
    private buffer = Buffer.alloc(0);

    public getBuffer() {
        return Buffer.from(this.buffer);
    }

    public wipeBuffer() {
        this.buffer = Buffer.alloc(0);
    }

    public concat(buf: Buffer) {
        this.buffer = Buffer.concat([this.buffer, buf]);
    }


    /**
     * Write shortcut
     * 
     * Allocate `size`-byte buffer, use writeFunc to write the data, then concatenate to internal buffer;
     */
    public write(size: number, val: any, writeFunc: (buf: Buffer) => ((val: any) => void)) {
        const buf = Buffer.alloc(size);
        writeFunc(buf).bind(buf)(val);
        this.concat(buf);
        return this;
    }

    /**
     * Write 1 byte singed integer
     */
    public writeByte(val: number) { return this.write(1, val, (buf) => buf.writeInt8); }
    /**
     * Write 1 byte unsinged integer
     */
    public writeUByte(val: number) { return this.write(1, val, (buf) => buf.writeUInt8); }
    /**
     * Write 2 bytes singed integer
     */
    public writeShort(val: number) { return this.write(2, val, (buf) => buf.writeInt16BE); }
    /**
     * Write 2 bytes unsinged integer
     */
    public writeUShort(val: number) { return this.write(2, val, (buf) => buf.writeUInt16BE); }
    /**
     * Write 4 bytes singed integer
     */
    public writeInt(val: number) { return this.write(4, val, (buf) => buf.writeInt32BE); }
    /**
     * Write 6 bytes singed integer
     */
    public writeLong(val: bigint) { return this.write(8, val, (buf) => buf.writeBigInt64BE); }
    /**
     * Write 4 bytes float
     */
    public writeFloat(val: number) { return this.write(4, val, (buf) => buf.writeFloatBE); }
    /**
     * Write 8 bytes double
     */
    public writeDouble(val: bigint) { return this.write(1, val, (buf) => buf.writeDoubleBE); }

    /**
     * Write boolean
     */
    public writeBoolean(val: boolean) { return this.writeByte(val == true ? 1 : 0); }

    // Source: https://minecraft.wiki/w/Java_Edition_protocol/Packets#VarInt_and_VarLong
    /**
     * Write a VarInt
     * 
     * A VarInt packet would look like this:
     * 
     * `[7 bits of data][1 bit indicate if the VarInt ended here]`
     */
    public writeVarInt(value: number) {
        while (true) {
            if ((value & ~SEGMENT_BITS) == 0) {
                this.writeUByte(value);
                return this;
            }

            this.writeUByte((value & SEGMENT_BITS) | CONTINUE_BIT);

            // Note: >>> means that the leftmost bits are filled with zeroes regardless of the sign,
            // rather than being filled with copies of the sign bit to preserve the sign.
            // In languages that don't have a ">>>" operator, This behavior can often be selected by
            // performing the shift on an unsigned type.
            value >>>= 7;
        }
    }
    /**
     * Write a VarLong 
     * 
     * Similar to VarInt, A VarLong packet would look like this:
     * 
     * `[7 bits of data][1 bit indicate if the VarLong ended here]`
     */
    public writeVarLong(value: bigint) {
        // Force the value to behave as an unsigned 64-bit integer for two's complement arithmetic
        value = BigInt.asUintN(64, value);

        while (true) {
            if ((value & ~BigInt(SEGMENT_BITS)) == BigInt(0)) {
                this.writeUByte(Number(value));
                return this;
            }

            this.writeUByte(Number(value & BigInt(SEGMENT_BITS)) | CONTINUE_BIT);

            // Use '>>=' instead of '>>>=' because 'bigint' does not support unsigned right shifts.
            // Since we applied BigInt.asUintN earlier, the value is guaranteed to be positive,
            // so '>>' will correctly fill the leftmost bits with zeroes.
            // Edited by Copilot since I have no idea what this is :D
            value >>= BigInt(7);
        }
    }

    /**
     * Write a string
     * 
     * A string packet would look like this:
     * 
     * `[VarInt as length, if not provided][N bits of data]`
     */
    public writeString(str: string) {
        this.writeVarInt(str.length);
        this.concat(Buffer.from(str));
        return this;
    }

    /**
     * Write a Position
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
    public writePosition(position: Vector) {
        const val = BigInt(
            ((position.x & 0x3FFFFFF) << 38) |
            ((position.z & 0x3FFFFFF) << 12) |
            (position.y & 0xFFF)
        );
        this.writeLong(val);
        return this;
    }

    /**
     * Write a length-prefixed array with raw buffer
     * 
     * An array packet would look like this:
     * `[VarInt as length][N bytes of data]`
     * 
     * @param size size of the item, in byte
     * @returns a length-prefixed array
     */
    public writePrefixedArray(length: number, writeFunc: (encoder: BinaryEncoder, index: number) => BinaryEncoder | Buffer) {
        const array: Buffer[] = Array.from({ length }, (_, index) => {
            const val = writeFunc(new BinaryEncoder(), index);
            if (val instanceof BinaryEncoder) return val.getBuffer();
            else return val;
        });
        this.writeVarInt(length);
        this.concat(Buffer.concat(array));
        return this;
    }

    /**
     * Write a length-prefixed array with raw buffer
     * 
     * An array packet would look like this:
     * `[VarInt as length][N bytes of data]`
     * 
     * @param size size of the item, in byte
     * @returns a length-prefixed array
     */
    public writeRawPrefixedArray(data: Buffer, size: number) {
        const length = Math.ceil(data.length / size);
        this.writeVarInt(length);
        this.concat(data);
        return this;
    }

    // For writing LpVec3
    private pack(value: number): number {
        return Math.round((value * 0.5 + 0.5) * MAX_QUANTIZED_VALUE);
    }

    /**
     * Write LpVec3
     * 
     * Read this article for more information: https://minecraft.wiki/w/Java_Edition_protocol/Data_types#LpVec3
     */
    public writeLpVec3(vec3: Vec3) {
        const maxCoordinate = Math.max(Math.abs(vec3.x), Math.max(Math.abs(vec3.y), Math.abs(vec3.z)));

        // Checking for NaN values in our maxCoordinate
        if (isNaN(maxCoordinate) || maxCoordinate < 1 / MAX_QUANTIZED_VALUE) {
            this.writeByte(0);
        } else {
            const scaleFactor = BigInt(Math.ceil(maxCoordinate));
            const needContinuation = (scaleFactor & SCALE_BITS) != scaleFactor;

            const packedScale = needContinuation ? scaleFactor & SCALE_BITS | CONTINUATION_FLAG : scaleFactor;
            const packedX = BigInt(this.pack(vec3.x)) / scaleFactor << 3n;
            const packedY = BigInt(this.pack(vec3.y)) / scaleFactor << 18n;
            const packedZ = BigInt(this.pack(vec3.z)) / scaleFactor << 33n;
            const packed = packedZ | packedY | packedX | packedScale;

            this.writeByte(Number(packed));
            this.writeByte(Number(packed >> 8n));
            this.writeInt(Number(packed >> 16n));
            if (needContinuation) {
                this.writeVarInt(Number(scaleFactor >> 2n));
            }
        }
    }

}

export type CompoundField = any | {
    tag: Tag,
    value: any,
}

// Check if N is floating point
// Got from https://stackoverflow.com/a/3886106/17106809
const isFloat = (n: number | bigint) =>
    (typeof (n) == "number" && n % 1 !== 0) ||
    (typeof (n) == "bigint" && n % BigInt(1) !== BigInt(0));

export function getTagOfNumber(n: number | bigint): FixedSizeTag {
    if (isFloat(n)) {
        if (-Math.pow(2, 4 * 8 - 1) <= n && n <= Math.pow(2, 4 * 8 - 1) - 1) return Tag.Float;
        else if (BigInt(-Math.pow(2, 8 * 8 - 1)) <= n && n <= BigInt(Math.pow(2, 8 * 8 - 1) - 1)) return Tag.Double;
        else throw new NumberTooBig(n);
    } else {
        if (-Math.pow(2, 1 * 8 - 1) <= n && n <= Math.pow(2, 1 * 8 - 1) - 1) return Tag.Byte;
        else if (-Math.pow(2, 2 * 8 - 1) <= n && n <= Math.pow(2, 2 * 8 - 1) - 1) return Tag.Short;
        else if (-Math.pow(2, 4 * 8 - 1) <= n && n <= Math.pow(2, 4 * 8 - 1) - 1) return Tag.Int;
        else if (BigInt(-Math.pow(2, 8 * 8 - 1)) <= n && n <= BigInt(Math.pow(2, 8 * 8 - 1) - 1)) return Tag.Long;
        else throw new NumberTooBig(n);
    }
}

export interface StaticTypedField {
    __isStatic: true,
    type: Tag,
    value: any
}

export class NBTEncoder extends BinaryEncoder {
    constructor(private object: Record<string, CompoundField>) {
        super();
    }

    /**
     * Write buffer to buffer
     */
    public writeTag(tag: Tag) {
        this.writeFixedSize(Tag.Byte, tag);
        return this;
    }

    /**
     * Write a fixed-size tag to buffer 
     */
    public writeFixedSize(
        type: FixedSizeTag,
        value: any
    ) {
        switch (type) {
            case Tag.Byte: this.writeByte(value); break;
            case Tag.Short: this.writeShort(value); break;
            case Tag.Int: this.writeInt(value); break;
            case Tag.Long: this.writeLong(BigInt(value)); break;
            case Tag.Float: this.writeFloat(value); break;
            case Tag.Double: this.writeDouble(BigInt(value)); break;
            default: throw new UnexpectedValue("fixed-size tag", (type as any).toString(16));
        }
        return this;
    }

    /**
     * Auto find the suitable tag and write it to the buffer
     */
    public writeNumber(val: number | bigint) {
        const tag = getTagOfNumber(val);
        this.writeFixedSize(tag, val);
        return this;
    }

    /**
     * Write a string
     */
    public writeString(str: string) {
        this.writeUShort(str.length);
        if (str.length === 0) return this;
        this.concat(Buffer.from(str));
        return this;
    }

    /**
     * Write a list
     * Unsafe
     */
    public writeList(type: Tag, arr: any[]) {
        this.writeFixedSize(Tag.Byte, type);
        this.writeInt(arr.length);
        if (arr.length === 0) return this;
        if (type == Tag.String)
            for (const item of arr)
                this.writeString(item);
        else
            this.concat(Buffer.from(arr));
        return this;
    }

    /**
     * Write a byte / int / long array
     */
    public writeArray(type: Extract<Tag, Tag.ByteArray | Tag.IntArray | Tag.LongArray>, arr: any[]) {
        this.writeInt(arr.length);
        for (const item of arr)
            switch (type) {
                case Tag.ByteArray: this.writeByte(item); break;
                case Tag.IntArray: this.writeInt(item); break;
                case Tag.LongArray: this.writeLong(BigInt(item)); break;
            }
        return this;
    }

    /**
     * Write a compound
     */
    public writeObject(obj: Record<string, any>) {
        for (const [name, val] of Object.entries(obj)) {
            switch (typeof val) {
                case "string": {
                    this.writeTag(Tag.String)
                        .writeString(name)
                        .writeString(val);
                    break;
                }
                case "number":
                case "bigint": {
                    const tag = getTagOfNumber(val);
                    this.writeTag(tag)
                        .writeString(name)
                        .writeFixedSize(tag, val);
                    break;
                }
                case "object": {
                    if (
                        typeof val === "object" &&
                        "__isStatic" in val &&
                        val["__isStatic"] === true &&
                        "type" in val && isTag(val["type"]) &&
                        "value" in val
                    ) {
                        const tag: Tag = val["type"];
                        const value = val["value"];

                        // TODO: Handle other type
                        this.writeTag(tag);
                        if (isFixedSizeTag(tag))
                            this.writeFixedSize(tag, value);
                        else if (tag === Tag.String)
                            this.writeString(value);
                    }
                    else if (Array.isArray(val)) {
                        let suitableTagForArray: Exclude<FixedSizeTag, Tag.Float | Tag.Double> | Tag.List = Tag.Byte,
                            listItemTag: Tag = Tag.Float;
                        for (const item of val) {
                            if (isNaN(Number(item))) {
                                suitableTagForArray = Tag.List;

                                // Just support list of string and float for now
                                if (typeof item !== "string")
                                    throw new InvalidValue("list item", typeof item);

                                listItemTag = Tag.String;

                                break;
                            }
                            const itemTag = getTagOfNumber(item);
                            if (itemTag == Tag.Float || itemTag == Tag.Double) {
                                suitableTagForArray = Tag.List;
                                listItemTag = itemTag;
                                break;
                            }
                            if (suitableTagForArray < itemTag)
                                suitableTagForArray = itemTag;
                        }

                        if (suitableTagForArray === Tag.List)
                            this.writeTag(Tag.List)
                                .writeString(name)
                                .writeList(listItemTag, val);
                        else {
                            let arrTag: Tag;
                            switch (suitableTagForArray) {
                                case Tag.Byte: arrTag = Tag.ByteArray; break;
                                case Tag.Short:
                                case Tag.Int: arrTag = Tag.IntArray; break;
                                case Tag.Long: arrTag = Tag.LongArray; break;
                            }
                            this.writeTag(arrTag)
                                .writeString(name)
                                .writeArray(arrTag as any, val);
                        }
                    } else {
                        this.writeTag(Tag.Compound)
                            .writeString(name)
                            .writeObject(val);
                    }
                    break;
                }
            }
        }
        this.writeTag(Tag.End);
        return this;
    }

    /**
     * Start encode
     */
    public encode() {
        this.writeTag(Tag.Compound)
            .writeString("") // Root name is empty
            .writeObject(this.object);
        return this.getBuffer();
    }
}