import { createPublicKey, publicEncrypt, constants as crypto_constants, randomBytes } from "node:crypto";
import { TypedEmmiter } from "../base/event";
import { ClientEvents } from "../client/client";
import { ProtocolVersionMapping } from "../version/registry";
import { ClientStatus, ConnectionState, ServerKnownPack, SharedState } from "../world/state";
import { sliceBuffer } from "../base/buffer";
import { randomUUIDBytes } from "../base/math";
import { Angle, BaseVec3 } from "../physics/direction";
import { MessageTooLong, NotImplemented } from "../base/error";
import BitSet from "../base/bitset";
import { makeMovementFlag } from "../binary/encoder";

/**
 * Packet sender
 */
export class Sender {
    constructor(
        private state: SharedState,
        private emit: TypedEmmiter<ClientEvents>["emit"]
    ) { }

    public sendPacket: (packetId: string, data: object) => void = () => { throw new NotImplemented(); };

    public sendHandshake() {
        this.state.state = ConnectionState.Handshake;
        this.sendPacket("intention",
            {
                protocol_version: ProtocolVersionMapping[this.state.clientOptions.version]!,
                server_address: this.state.clientOptions.host,
                server_port: this.state.clientOptions.port,
                intent: 2
            }
        );
    }

    public sendLoginStart() {
        this.state.state = ConnectionState.Login;
        this.state.status = ClientStatus.Logining;
        this.sendPacket("hello", {
            name: this.state.clientOptions.playerName,
            player_uuid: Buffer.from(this.state.playerUUID!, "hex")
        });
    }

    public sendEncryptionResponse(publicKey: Buffer, verifyToken: Buffer) {
        const encryptedSecret = publicEncrypt({
            key: createPublicKey({ key: publicKey, format: 'der', type: 'spki' }),
            padding: crypto_constants.RSA_PKCS1_PADDING
        }, this.state.sharedSecret!);
        const encryptedVerifyToken = publicEncrypt({
            key: createPublicKey({ key: publicKey, format: 'der', type: 'spki' }),
            padding: crypto_constants.RSA_PKCS1_PADDING
        }, verifyToken);
        const secretBuf = sliceBuffer(encryptedSecret, 1, (buf) => buf.readInt8());
        const token = sliceBuffer(encryptedVerifyToken, 1, (buf) => buf.readInt8());
        this.sendPacket("key", {
            shared_secret: { value: secretBuf, length: secretBuf.length },
            verify_token: { value: token, length: token.length }
        });
    }

    public sendLoginAck() {
        this.sendPacket("login_acknowledged", {});
        this.state.state = ConnectionState.Configure;
        this.state.server = {};
    }

    // Configuring

    public sendKnownPack(knownPacks: ServerKnownPack[]) {
        this.sendPacket("select_known_packs", {
            known_packs: {
                value: knownPacks,
                length: knownPacks.length
            }
        });
    }

    public sendConfigureAck() {
        this.sendPacket("finish_configuration", {});
        this.state.state = ConnectionState.Play;
    }

    // Play

    public sendPlayerSession() {
        const sessionUUID = randomUUIDBytes();
        const expireTime = 15 * 60 * 1000; // 15min in ms
        const expiredAt = Date.now() + expireTime;
        const { publicKey, signature } = this.state.getSignature();
        this.state.sessionID = sessionUUID;
        this.sendPacket("chat_session_update", {
            session_id: sessionUUID,
            expire_at: expiredAt,
            public_key: publicKey,
            signature
        });
    }

    public sendConfirmTeleportation(teleportId: number) {
        this.sendPacket("accept_teleportation", {
            teleport_id: teleportId
        });
    }

    public sendKeepAlive(id: bigint) {
        this.sendPacket("keep_alive", {
            keep_alive_id: id
        });
    }

    public sendPlayerPos(
        position: BaseVec3,
        onGround: boolean,
        horizontalCollision: boolean
    ) {
        const { x, y, z } = position;
        this.state.enqueuePacket("move_player_pos", {
            x, feet_y: y, z,
            flags: makeMovementFlag(onGround, horizontalCollision)
        });
    }

    public sendPlayerPosRot(
        position: BaseVec3,
        angle: Angle,
        onGround: boolean,
        horizontalCollision: boolean
    ) {
        const { x, y, z } = position,
            { yaw, pitch } = angle;
        this.state.enqueuePacket("move_player_pos_rot", {
            x, feet_y: y, z,
            yaw, pitch,
            flags: makeMovementFlag(onGround, horizontalCollision)
        });
    }

    public sendPlayerRot(
        angle: Angle,
        onGround: boolean,
        horizontalCollision: boolean
    ) {
        const { yaw, pitch } = angle;
        this.state.enqueuePacket("move_player_rot", {
            yaw, pitch,
            flags: makeMovementFlag(onGround, horizontalCollision)
        });
    }

    public sendPlayerStatus(
        onGround: boolean,
        horizontalCollision: boolean
    ) {
        this.state.enqueuePacket("move_player_status_only", {
            flags: makeMovementFlag(onGround, horizontalCollision)
        });
    }

    public sendMessage(
        content: string
    ) {
        if (content.length > 256)
            throw new MessageTooLong(content);
        const bitset = new BitSet(20);
        const timestamp = Date.now();
        const salt = randomBytes(8).readBigInt64BE();
        this.sendPacket("chat", {
            message: content,
            timestamp,
            salt,
            signature: null, // skip for now
            message_count: this.state.messageCount,
            acknowledged: bitset,
            checksum: 0
        });
        this.state.messageCount = 0;
    }
}