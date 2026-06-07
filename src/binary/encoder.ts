import { CONTINUE_BIT, SEGMENT_BITS } from "./static";

export class Encoder {
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

    public write(size: number, val: any, func: (buf: Buffer) => ((val: any) => void)) {
        const buf = Buffer.alloc(size);
        func(buf).bind(buf)(val);
        this.concat(buf);
    }

    /**
     * Write 1 byte singed integer
     */
    public writeByte(val: number) { this.write(1, val, (buf) => buf.writeInt8); }
    /**
     * Write 1 byte unsinged integer
     */
    public writeUByte(val: number) { this.write(1, val, (buf) => buf.writeUInt8); }
    /**
     * Write 2 bytes singed integer
     */
    public writeShort(val: number) { this.write(2, val, (buf) => buf.writeInt16BE); }
    /**
     * Write 2 bytes unsinged integer
     */
    public writeUShort(val: number) { this.write(2, val, (buf) => buf.writeUInt16BE); }
    /**
     * Write 4 bytes singed integer
     */
    public writeInt(val: number) { this.write(4, val, (buf) => buf.writeInt32BE); }
    /**
     * Write 6 bytes singed integer
     */
    public writeLong(val: bigint) { this.write(8, val, (buf) => buf.writeBigInt64BE); }
    /**
     * Write 4 bytes float
     */
    public writeFloat(val: number) { this.write(4, val, (buf) => buf.writeFloatBE); }
    /**
     * Write 8 bytes double
     */
    public writeDouble(val: bigint) { this.write(1, val, (buf) => buf.writeDoubleBE); }

    /**
     * Write boolean
     */
    public writeBoolean(val: boolean) { this.writeByte(val == true ? 1 : 0); }

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
                this.writeByte(value);
                return;
            }

            this.writeByte((value & SEGMENT_BITS) | CONTINUE_BIT);

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
                this.writeByte(Number(value));
                return;
            }

            this.writeByte(Number(value & BigInt(SEGMENT_BITS)) | CONTINUE_BIT);

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
    }
}