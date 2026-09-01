import z from "zod";
import { MissingField, MissingPacketField, NotImplemented, SkippableNotImplemented, UnexpectedValue } from "../base/error";
import { BinaryDecoder } from "../packet/decoder";
import { ConnectionState, SharedState } from "../world/state";
import { FieldNode, PacketObject, PacketRegistry, VersionDefinitions } from "./registry";
import { BinaryEncoder } from "../packet/encoder";
import { BitSet } from "../base/bitset";

const TCPStateMapping: Record<ConnectionState, keyof z.infer<typeof VersionDefinitions> | null> = {
    [ConnectionState.Disconnected]: null,
    [ConnectionState.Handshake]: "handshaking",
    [ConnectionState.Login]: "login",
    [ConnectionState.Configure]: "configuration",
    [ConnectionState.Play]: "play",
};

export interface EncodeResult {
    buffer: Buffer,
    packet: z.infer<typeof PacketObject>,
}

export class VersionCodec {
    constructor(private readonly state: SharedState) { }

    public consumePacket: (packetId: string, data: object) => void = () => { throw new NotImplemented(); };

    public handlePacket(packetId: number, decoder: BinaryDecoder) {
        const mappedState = TCPStateMapping[this.state.state];
        if (!mappedState) return; // console.log("no state");
        const packet = PacketRegistry.getPacket(mappedState, "clientbound", packetId);
        if (!packet) return; // console.log("no packet");

        const { name, structure, skipForNow } = packet;

        if (skipForNow) return;

        const resolvedObject: Record<string, any> = {};
        if (Object.keys(structure).length > 0)
            for (const [name, field] of Object.entries(structure))
                try {
                    resolvedObject[name] = this.readField(packetId, resolvedObject, name, field, decoder);
                } catch (err) {
                    if (err instanceof SkippableNotImplemented) break;
                    if (err instanceof NotImplemented) return;
                    throw err;
                }
        if (this.state.clientOptions.debug?.packetLogger)
            console.dir({
                dir: "to client",
                state: mappedState,
                name,
                data: resolvedObject,
            });

        this.consumePacket(`${TCPStateMapping[this.state.state]}:${name}`, resolvedObject);
    }

    public encodePacket(packetId: number | string, data: Record<string, any>): EncodeResult {
        const mappedState = TCPStateMapping[this.state.state];
        if (!mappedState) throw new UnexpectedValue("map-able state", this.state.state.toString());
        const packet = PacketRegistry.getPacket(mappedState, "serverbound", packetId);
        if (!packet) throw new UnexpectedValue("valid serverbound packet id", packetId.toString());

        if (this.state.clientOptions.debug?.packetLogger)
            console.dir({
                dir: "to server",
                state: mappedState,
                id: packetId,
                data,
            });

        const { name: packetName, structure } = packet;
        let encoder = new BinaryEncoder();
        for (const [name, field] of Object.entries(structure)) {
            if (!(name in data))
                throw new MissingField(name, `packet ${packetName}`);
            if (typeof data[name] === "object")
                if ("value" in data[name])
                    if ("metadata" in data[name])
                        encoder = this.writeField(field, encoder, data[name]["value"], data[name]["metadata"]);
                    else if ("length" in data[name])
                        encoder = this.writeField(field, encoder, data[name]["value"], { length: data[name]["length"] });
                    else
                        encoder = this.writeField(field, encoder, data[name]["value"]);
                else
                    encoder = this.writeField(field, encoder, data[name]);
            else
                encoder = this.writeField(field, encoder, data[name]);
        }
        return { buffer: encoder.getBuffer(), packet };
    }

    private readField(
        // Current reading state
        packetId: number,
        readObject: Record<string, any>,

        // Current field
        fieldName: string,
        field: FieldNode,
        decoder: BinaryDecoder
    ): any {
        switch (field.type) {
            case "string": return decoder.readString();
            case "boolean": return decoder.readBoolean();
            case "byte": return decoder.readByte();
            case "unsigned_byte": return decoder.readUByte();
            case "short": return decoder.readShort();
            case "unsigned_short": return decoder.readUShort();
            case "int": return decoder.readInt();
            case "long": return decoder.readLong();
            case "float": return decoder.readFloat();
            case "double": return decoder.readDouble();
            case "var_int": return decoder.readVarInt();
            case "var_long": return decoder.readVarLong();
            case "uuid": return decoder.readUUID();
            case "position": return decoder.readPosition();
            case "array": {
                let length;
                if (!isNaN(Number(field.length)))
                    length = Number(field.length);
                else
                    length = readObject[field.length];
                if (length === undefined) throw new MissingPacketField(packetId, fieldName, field.length.toString());
                return decoder.readArray(length, (decoder) => this.readField(packetId, readObject, fieldName, field.subType, decoder));
            }
            case "prefixed_array": return decoder.readPrefixedArray((decoder) => this.readField(packetId, readObject, fieldName, field.subType, decoder));
            case "teleport_flag": return decoder.readTeleportFlag();
            case "prefixed_optional": return decoder.readPrefixedOptional((decoder) => this.readField(packetId, readObject, fieldName, field.subType, decoder));
            case "nbt": return decoder.readNBT();
            case "lpvec3": return decoder.readLpVec3();
            case "fixed_point": {
                const value = this.readField(packetId, readObject, fieldName, field.subType, decoder);
                return decoder.readFixedPoint(value, field.fractionBits);
            }
            case "angle": return decoder.readAngle();
            case "id_or_x": return decoder.readIdOrX((decoder) => this.readField(packetId, readObject, fieldName, field.subType, decoder));
            case "id_set": return decoder.readIdSet();
            case "chat_type_decoration": return decoder.readChatTypeDecoration();
            case "chat_type": return decoder.readChatType();
            case "enum": return this.readField(packetId, readObject, fieldName, field.subType, decoder);
            case "json_text": return JSON.parse(decoder.readString());
            case "object": {
                const obj: Record<string, any> = {};
                for (const [key, type] of Object.entries(field.fields))
                    obj[key] = this.readField(packetId, readObject, key, type, decoder);
                return obj;
            }
            case "game_profile": {
                return {
                    uuid: decoder.readUUID(),
                    username: decoder.readString(),
                    pproperties: decoder.readPrefixedArray((decoder) => ({
                        name: decoder.readString(),
                        value: decoder.readString(),
                        signature: decoder.readPrefixedOptional((decoder) => decoder.readString())
                    }))
                };
            }
            case "heightmap": {
                return {
                    type: decoder.readVarInt(),
                    data: decoder.readPrefixedArray((decoder) => decoder.readLong())
                };
            }
            case "bitset": return decoder.readPrefixedArray((decoder) => decoder.readLong());
            case "teleport_flags": return decoder.readTeleportFlag();
            case "null": return null;
            case "not_implemented": {
                if (field.skip_able === true)
                    throw new SkippableNotImplemented();
                throw new NotImplemented();
            }
            case "switch": {
                if (!(field.dependsOn in readObject)) throw new MissingPacketField(packetId, fieldName, field.dependsOn);
                const dependencyValue = readObject[field.dependsOn];
                for (const [value, type] of field.cases)
                    if (dependencyValue === value)
                        return this.readField(packetId, readObject, fieldName, type, decoder);
                if (field.default)
                    return this.readField(packetId, readObject, fieldName, field.default, decoder);
                return null;
            }
        }
    }


    private writeField(
        field: FieldNode,
        encoder: BinaryEncoder,
        value: any,
        metadata: Record<string, any> = {}
    ): BinaryEncoder {
        switch (field.type) {
            case "string": return encoder.writeString(value);
            case "boolean": return encoder.writeBoolean(value);
            case "byte": return encoder.writeByte(value);
            case "unsigned_byte": return encoder.writeUByte(value);
            case "short": return encoder.writeShort(value);
            case "unsigned_short": return encoder.writeUShort(value);
            case "int": return encoder.writeInt(value);
            case "long": return encoder.writeLong(value);
            case "float": return encoder.writeFloat(value);
            case "double": return encoder.writeDouble(value);
            case "var_int": return encoder.writeVarInt(value);
            case "var_long": return encoder.writeVarLong(value);
            case "uuid": return encoder.writeRaw(value);
            case "position": return encoder.writePosition(value);
            // case "array": {
            //     const length = metadata["length"];
            //     // if (!length) throw new MissingField(packetId, fieldName, field.length);
            //     return encoder.writeArray(length, (decoder) => this.readField(packetId, readObject, fieldName, field.subType, decoder));
            // }
            case "prefixed_array": {
                const length = metadata["length"] || field.length;
                if (!length) throw new MissingField("length", "prefixed array metadata object");
                if (!Array.isArray(value))
                    throw new UnexpectedValue("an array for prefixed array", typeof value);
                return encoder.writePrefixedArray(length, (encoder, index) => this.writeField(field.subType, encoder, value[index], metadata));
            }
            // case "teleport_flag": return encoder.writeTeleportFlag();
            // case "prefixed_optional": return encoder.writePrefixedOptional((decoder) => this.readField(packetId, readObject, fieldName, field.subType, decoder));
            // case "nbt": return encoder.writeNBT(value);
            case "lpvec3": return encoder.writeLpVec3(value);
            // case "fixed_point": {
            //     const value = this.readField(packetId, readObject, fieldName, field.subType, encoder);
            //     return encoder.writeFixedPoint(value, field.fractionBits);
            // }
            // case "angle": return encoder.writeAngle();
            // case "id_or_x": return encoder.writeIdOrX((decoder) => this.readField(packetId, readObject, fieldName, field.subType, decoder));
            // case "chat_type_decoration": return encoder.writeChatTypeDecoration();
            // case "chat_type": return encoder.writeChatType();
            case "enum": return this.writeField(field.subType, encoder, value, metadata);
            case "json_text": return encoder.writeString(JSON.parse(value));
            case "object": {
                for (const [name, subField] of Object.entries(field.fields))
                    encoder = this.writeField(subField, encoder, value[name], metadata);
                return encoder;
            }
            case "fixed_bitset": {
                if (!(value instanceof BitSet))
                    throw new UnexpectedValue("bitset instance", typeof value);
                const arr = value.toByteArray();
                return encoder.writeRaw(Buffer.from(arr));
            }
            // case "switch": {
            //     const dependencyValue = readObject[field.dependsOn];
            //     if (!dependencyValue) throw new MissingField(packetId, fieldName, field.dependsOn);
            //     for (const [value, type] of field.cases)
            //         if (dependencyValue === value)
            //             return this.readField(packetId, readObject, fieldName, type, encoder);
            //     if (field.default)
            //         return this.readField(packetId, readObject, fieldName, field.default, encoder);
            //     break;
            // }
            default:
                throw new UnexpectedValue("encoding type", field.type);
        }
    }
}