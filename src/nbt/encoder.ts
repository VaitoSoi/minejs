import { InvalidValue, NumberTooBig, UnexpectedValue } from "../error";
import { FixedSizeTag, Size, Tag } from "./static";
import { Encoder as BinEncoder } from "../binary/encoder";

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

export class Encoder extends BinEncoder {
    constructor(private object: Record<string, CompoundField>) {
        super();
    }

    /**
     * Write buffer to buffer
     */
    public writeTag(tag: Tag) {
        this.writeFixedSize(Tag.Byte, tag);
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
            default: throw new UnexpectedValue("fixed tag", (type as any).toString(16));
        }
    }

    /**
     * Auto find the suitable tag and write it to the buffer
     */
    public writeNumber(val: number | bigint) {
        const tag = getTagOfNumber(val);
        this.writeFixedSize(tag, val);
    }

    /**
     * Write a string
     */
    public writeString(str: string) {
        this.writeUShort(str.length);
        if (str.length === 0) return;
        this.concat(Buffer.from(str));
    }

    /**
     * Write a list
     * Unsafe
     */
    public writeList(type: Tag, arr: any[]) {
        this.writeFixedSize(Tag.Byte, type);
        this.writeInt(arr.length);
        if (arr.length === 0) return;
        if (type == Tag.String)
            for (const item of arr)
                this.writeString(item);
        else
            this.concat(Buffer.from(arr));
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
    }

    /**
     * Write a compound
     */
    public writeObject(obj: Record<string, any>) {
        for (const [name, val] of Object.entries(obj)) {
            switch (typeof val) {
                case "string": {
                    this.writeTag(Tag.String);
                    this.writeString(name);
                    this.writeString(val);
                    break;
                }
                case "number":
                case "bigint": {
                    const tag = getTagOfNumber(val);
                    this.writeTag(tag);
                    this.writeString(name);
                    this.writeFixedSize(tag, val);
                    break;
                }
                case "object": {
                    if (Array.isArray(val)) {
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

                        if (suitableTagForArray === Tag.List) {
                            this.writeTag(Tag.List);
                            this.writeString(name);
                            this.writeList(listItemTag, val);
                        } else {
                            let arrTag: Tag;
                            switch (suitableTagForArray) {
                                case Tag.Byte: arrTag = Tag.ByteArray; break;
                                case Tag.Short:
                                case Tag.Int: arrTag = Tag.IntArray; break;
                                case Tag.Long: arrTag = Tag.LongArray; break;
                            }
                            this.writeTag(arrTag);
                            this.writeString(name);
                            this.writeArray(arrTag as any, val);
                        }
                    } else {
                        this.writeTag(Tag.Compound);
                        this.writeString(name);
                        this.writeObject(val);
                    }
                    break;
                }
            }
        }
        this.writeTag(Tag.End);
    }

    /**
     * Start encode
     */
    public encode() {
        this.writeTag(Tag.Compound);
        this.writeString(""); // Root name is empty
        this.writeObject(this.object);
        return this.getBuffer();
    }
}