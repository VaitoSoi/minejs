import { UnexpectedValue } from "../error";
import { Tag } from "./static";
import { Decoder as BinDecoder } from "../binary/decoder";

export class Decoder extends BinDecoder {

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
     * To use this, `autoOffset` has to bet set to `true`
     * 
     * @returns
     */
    public decode() {
        if (!this.autoOffset)
            throw new UnexpectedValue("autoOffset", "false", "true");

        const type = this.readByte();
        if (type !== Tag.Compound && type !== Tag.List)
            throw new UnexpectedValue("compound tag", type.toString(16), "0x0A or 0x09");

        const _ = this.readCompoundString();
        const value = this.readCompoundValue(type);

        return value;
    }
}
