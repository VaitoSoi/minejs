import { CONTINUE_BIT, SEGMENT_BITS } from "./static";

export class Decoder {
    constructor(
        public readonly buffer: Buffer,
        public autoOffset: boolean = true,
        public offset: number = 0
    ) { }

    /**
     * Read 1 byte
     * @returns signed 1-byte integer
     */
    public readByte() {
        const value = this.buffer.readInt8(this.offset);
        if (this.autoOffset) this.offset += 1;
        return value;
    }
    /**
     * Read 1 byte
     * @returns unsigned 1-byte integer
     */
    public readUByte() {
        const value = this.buffer.readUint8(this.offset);
        if (this.autoOffset) this.offset += 1;
        return value;
    }
    /**
     * Read 2 bytes
     * @returns signed 2-byte integer
     */
    public readShort() {
        const value = this.buffer.readInt16BE(this.offset);
        if (this.autoOffset) this.offset += 2;
        return value;
    }
    /**
     * Read 2 bytes
     * @returns unsigned 2-byte integer
     */
    public readUShort() {
        const value = this.buffer.readUint16BE(this.offset);
        if (this.autoOffset) this.offset += 2;
        return value;
    }
    /**
     * Read 4 bytes
     * @returns signed 4-byte integer
     */
    public readInt() {
        const value = this.buffer.readInt32BE(this.offset);
        if (this.autoOffset) this.offset += 4;
        return value;
    }
    /**
     * Read 8 bytes
     * @returns signed 8-byte integer
     */
    public readLong() {
        const value = this.buffer.readBigInt64BE(this.offset);
        if (this.autoOffset) this.offset += 8;
        return value;
    }
    /**
     * Read 4 bytes
     * @returns signed 4-bytes decimal
     */
    public readFloat() {
        const value = this.buffer.readFloatBE(this.offset);
        if (this.autoOffset) this.offset += 4;
        return value;
    }
    /**
     * Read 8 bytes
     * @returns signed 8-byte decimal
     */
    public readDouble() {
        const value = this.buffer.readDoubleBE(this.offset);
        if (this.autoOffset) this.offset += 8;
        return value;
    }

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
            currentByte = this.readByte();
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
            currentByte = this.readByte();
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

        const string = this.buffer.subarray(this.offset, this.offset + length);
        if (this.autoOffset) this.offset += length;
        return string.toString("utf-8");
    }
}