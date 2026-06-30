import { Vec3 } from "../base/vector";
import { CONTINUATION_FLAG, CONTINUE_BIT, MAX_QUANTIZED_VALUE, SCALE_BITS, SEGMENT_BITS } from "./static";
import { StringSizeExceedLimit, UnexpectedValue } from "../base/error";
import { Tag } from "./static";
import { unzipSync } from "zlib";
import { minBigInt } from "../base/math";

export function getTextFromTextComponent(component: any): string | string[] {
    switch (typeof component) {
        case "string":
            return component;
        case "object": {
            if (Array.isArray(component))
                return component.map(val => getTextFromTextComponent(val)) as string[];
            else if ("text" in component) {
                if ("extra" in component && Array.isArray(component["extra"]))
                    return [component["text"], ...component["extra"]];
                else return component["text"];
            } else if ("translate" in component) {
                if ("fallback" in component) return component["fallback"];
                else return component["translate"];
            } else if ("keybind" in component)
                return component["keybind"];
            else
                throw new UnexpectedValue("type of component", "string or object", typeof component);
        }
        default:
            throw new UnexpectedValue("type of component", "string or object", typeof component);
    }
}

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
        if (type !== Tag.Compound && type !== Tag.List)
            throw new UnexpectedValue("compound tag", type.toString(16), "0x0A or 0x09");

        if (!isNetwork) this.readCompoundString();
        const value = this.readCompoundValue(type);

        return value;
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
            console.dir({ ch, type });

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