import { Socket, SocketConstructorOpts } from "node:net";
import { EventEmitter } from "node:events";
import { deflateSync, inflateSync } from "node:zlib";

import { TypedEmmiter } from "../base/event";
import { BinaryDecoder } from "../packet/decoder";
import { BinaryEncoder } from "../packet/encoder";
import { AuthOption } from "./auth";
import { ClientStatus, ConnectionState, SharedState } from "../world/state";
import { EncodeResult } from "../version/codec";
import { TextComponent } from "../base/typing";
import { MissingAuthOption, SockerIsNotWritable } from "../base/error";

// Minecraft related typing



// TCP related typing
export interface TCPClientOption {
    /** Server host */
    host: string,
    /** Server port */
    port: number,
    /**
     * Server protocol version.
     * 
     * Currentlt support `776` or version `26.2`
     * 
     * @see https://minecraft.wiki/w/Minecraft_Wiki:Projects/wiki.vg_merge/Protocol_version_numbers
     */
    protocolVersion: number,
    /** Player name */
    playerName: string,
    /**
     * Send empty `Known Packet` to let server send all Registry data, which may consume a lot of bandwith
     */
    loadRegistry?: boolean,

    debug?: {
        /** Log the incoming packet */
        packetLogger: boolean
    },

    // For premium account
    auth?: AuthOption
}

export interface TCPClientEvents {
    connect: [],
    raw: [buffer: Buffer]
    destroy: [],
}

export interface Message {
    sender: string,
    target: string | undefined,
    content: string,
    raw: {
        sender: TextComponent,
        target: TextComponent | undefined,
        content: TextComponent | undefined
    }
}


// export enum TCPServerIntent {
//     Status = 1,
//     Login = 2,
//     Transfer = 3,
// }

/**
 * Low-level client. You SHOULD NOT use this client unless you know what are you doing
 * 
 * @see https://minecraft.wiki/w/Java_Edition_protocol/Packets?oldid=3445844
 */
export class TCPClient extends (EventEmitter as new () => TypedEmmiter<TCPClientEvents>) {
    public readonly socket: Socket;

    // Internal var
    /**
     * | Value | Meaning |
     * |-------|---------|
     * | 0     |  not set yet |
     * | -1    | dont compress |
     * | > 0   | compression threshold |
     */
    private bufferPool: Buffer = Buffer.alloc(0);

    constructor(
        private state: SharedState,
        public readonly option: TCPClientOption,
        socketOption?: SocketConstructorOpts,
    ) {
        super();
        this.socket = new Socket(socketOption);
    }

    public sendInitPacket: () => void = () => { throw new NotImplemented(); };
    public forwardPacket: (packetId: number, decoder: BinaryDecoder) => void = () => { throw new NotImplemented(); };
    public parsePacket: (packetId: string | number, data: object) => EncodeResult = () => { throw new NotImplemented(); };

    /**
     * Connect to server
     */
    public connect() {
        this.state.status = ClientStatus.Connecting;
        const connection = this.socket.connect({
            host: this.option.host,
            port: this.option.port
        });

        connection.on("connect", () => {
            this.emit("connect");
            this.sendInitPacket();
        });
        connection.on("data", (data) => {
            let buf = Buffer.from(data);
            if (this.state.decipher) {
                buf = this.state.decipher.update(buf);
            }
            this.emit("raw", Buffer.from(buf));
            this.bufferPool = Buffer.concat([this.bufferPool, buf]);
            this.handlePacket();
        });
        connection.once("end", () => {
            this.emit("destroy");
        });
        connection.once("close", () => {
            this.emit("destroy");
        });
    }

    public disconnect() {
        if (!this.socket.closed)
            this.socket.destroy();
    }

    /*
    * Read packet
    */

    private handlePacket() {
        while (this.bufferPool.length > 0) {
            let decoder = new BinaryDecoder(this.bufferPool);
            let packetLength: number;
            try {
                packetLength = decoder.readVarInt();
            } catch (e) {
                break; // Not enough data to read VarInt
            }
            if (this.bufferPool.length - decoder.offset < packetLength) break;

            const expectedPacketEnd = decoder.offset + packetLength;

            let packetID: number;
            if (this.state.compressionThreshold === 0)
                packetID = decoder.readVarInt();
            else if (this.state.compressionThreshold === -1) {
                decoder.readVarInt();
                packetID = decoder.readVarInt();
            } else {
                const dataLength = decoder.readVarInt();
                if (dataLength === 0) {
                    packetID = decoder.readVarInt();
                } else {
                    const dataBuffer = this.bufferPool.subarray(decoder.offset, expectedPacketEnd);
                    const decompressed = inflateSync(dataBuffer);
                    if (decompressed.length !== dataLength)
                        throw new UnexpectedValue("decompressed packet data", decompressed.length.toString(), dataLength.toString());
                    decoder = new BinaryDecoder(decompressed);
                    packetID = decoder.readVarInt();
                }
            }
            this.forwardPacket(packetID, decoder);

            this.bufferPool = this.bufferPool.subarray(expectedPacketEnd);
        }
    }

    /*
     * Send packet
     */
    public write(buf: Buffer) {
        if (!this.socket.writable)
            throw new SockerIsNotWritable();

        let sendBuffer = buf;
        if (this.state.cipher)
            sendBuffer = this.state.cipher.update(sendBuffer);

        this.socket.write(sendBuffer);
    }

    public sendPacket(packetId: number | string, data: Record<string, any>) {
        const { buffer: content, packet } = this.parsePacket(packetId, data);
        const encodePacketId = new BinaryEncoder();
        encodePacketId.writeVarInt(packet.id);
        const sendData = Buffer.concat([encodePacketId.getBuffer(), content]);

        let sendingPacket: Buffer;
        if (this.state.compressionThreshold !== 0) {
            let data: Buffer;
            let uncompressedLength: number;

            if (this.state.compressionThreshold > 0 && sendData.length > this.state.compressionThreshold) {
                uncompressedLength = sendData.length;
                data = deflateSync(sendData);
            } else {
                uncompressedLength = 0;
                data = sendData;
            }

            const dataLengthEncoder = new BinaryEncoder();
            dataLengthEncoder.writeVarInt(uncompressedLength);
            const dataLengthBuf = dataLengthEncoder.getBuffer();

            const packetLengthEncoder = new BinaryEncoder();
            packetLengthEncoder.writeVarInt(dataLengthBuf.length + data.length);
            sendingPacket = Buffer.concat([packetLengthEncoder.getBuffer(), dataLengthBuf, data]);
        } else {
            const packetLengthEncoder = new BinaryEncoder();
            packetLengthEncoder.writeVarInt(sendData.length);
            sendingPacket = Buffer.concat([packetLengthEncoder.getBuffer(), sendData]);
        }

        this.write(sendingPacket);
    }

}