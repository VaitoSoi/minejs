import zod from "zod";
import { createCipheriv, createDecipheriv, createPublicKey, publicEncrypt, randomBytes, constants as crypto_constants, createVerify } from "node:crypto";
import { BlockEntity, ChunkSection, ClientPlayer, ClientStatus, ConnectionState, Entity, GameMode, PaletteContainer, ServerKnownPack, ServerWorld, SharedState } from "../world/state";
import { BinaryDecoder, getTextFromTextComponent } from "./decoder";
import { packBlockPos, SectionsPerChunk } from "../client/static";
import { Angle, BaseVec3, Vec3 } from "../physics/direction";
import { ProtocolVersionMapping } from "../version/registry";
import { TypedEmmiter } from "../base/event";
import { ClientEvents } from "../client/client";
import { makeMovementFlag } from "./encoder";
import { TextComponent } from "../base/typing";
import { AuthRelatedNotFound, HaveSignatureButNotIndex, MessageLinkNotFound, MessageTooLong, MissingAuthOption, NotImplemented, UnexpectedValue } from "../base/error";
import { randomUUIDBytes, uuidToBuffer } from "../base/math";
import { MessageLink } from "../message/link";
import { sliceBuffer } from "../base/buffer";
import BitSet from "../base/bitset";

function zodParse<Type extends zod.ZodType>(data: object, zod: Type): zod.infer<Type> {
    return zod.parse(data);
}

export class Dispatcher {
    private readonly mapping: Record<string, (data: object) => void>;

    constructor(
        private state: SharedState,
        private emit: TypedEmmiter<ClientEvents>["emit"]
    ) {
        this.mapping = {
            "login:login_disconnect": this.handleLoginDisconnect,
            "login:hello": this.handleEncryption,
            "login:login_finished": this.handleLoginSucess,
            "login:login_compression": this.handleSetCompression,
            "configuration:disconnect": this.handleConfiguarionPlayDisconnect,
            "configuration:keep_alive": this.handleKeepAlive,
            "configuration:registry_data": this.handleRegistryData,
            "configuration:select_known_packs": this.handleKnownPack,
            "configuration:finish_configuration": this.handleFinishConfiguration,
            "play:add_entity": this.handleSpawnEntity,
            "play:disconnect": this.handleConfiguarionPlayDisconnect,
            "play:disguised_chat": this.handleDisguisedChatMessage,
            "play:entity_position_sync": this.handleTeleportEntity,
            "play:forget_level_chunk": this.handleUnloadChunk,
            "play:keep_alive": this.handleKeepAlive,
            "play:level_chunk_with_light": this.handleChunkData,
            "play:login": this.handlePlayLogin,
            "play:move_entity_pos": this.handleUpdateEntityPosition,
            "play:move_entity_pos_rot": this.handleUpdateEntityPositionRotation,
            "play:player_chat": this.handlePlayerChat,
            "play:player_position": this.handleSynchronizePlayerPosition,
            "play:remove_entities": this.handleRemoveEntity,
            // "play:rotate_head": 
            "play:set_action_bar_text": this.handleSetActionBar,
            "play:set_entity_motion": this.handleSetEntityVelocity,
            "play:system_chat": this.handleSystemMessage,
        };
    }

    public sendPacket: (packetId: string, data: object) => void = () => { throw new NotImplemented(); };
    public disconnect: (reason: string, reasonRaw?: TextComponent) => void = () => { throw new NotImplemented(); };


    public handlePacket(packetId: string, data: object) {
        if (packetId in this.mapping)
            this.mapping[packetId]!.bind(this)(data);
    }

    // Login

    private handleLoginDisconnect(data: object) {
        const { reason } = zodParse(data, zod.object({ reason: zod.record(zod.string(), zod.any()) }));
        const text = getTextFromTextComponent(reason);

        this.disconnect(text, reason);
    }

    private handleEncryption(data: object) {
        const {
            server_id,
            public_key,
            verify_token,
            should_authenticate
        } = zodParse(data, zod.object({
            server_id: zod.string(),
            public_key: zod.array(zod.number()),
            verify_token: zod.array(zod.number()),
            should_authenticate: zod.boolean()
        }));

        const sharedSecret = randomBytes(16);
        this.state.sharedSecret = sharedSecret;
        this.state.cipher = createCipheriv("aes-128-cfb8", sharedSecret, sharedSecret);
        this.state.decipher = createDecipheriv("aes-128-cfb8", sharedSecret, sharedSecret);
        this.state.useEncryption = true;

        const publicKey = Buffer.from(public_key),
            verifyToken = Buffer.from(verify_token);
        if (should_authenticate)
            if (!this.state.authClient)
                throw new AuthRelatedNotFound("auth client");
            else
                this.state.authClient.sendAuth(server_id, sharedSecret, publicKey)
                    .then(() => this.sendEncryptionResponse(publicKey, verifyToken));
        else
            this.sendEncryptionResponse(publicKey, verifyToken);
    }

    private handleSetCompression(data: object) {
        const { threshold } = zodParse(data, zod.object({ threshold: zod.number() }));
        if (threshold < 0) this.state.compressionThreshold = -1;
        else this.state.compressionThreshold = threshold;
    }

    private handleLoginSucess(data: object) {
        const { profile: { uuid, username } } = zodParse(data,
            zod.object({
                profile: zod.object({ uuid: zod.string(), username: zod.string() }),
                session_id: zod.string()
            }));
        this.state.player = {
            uuid,
            username,
            entityId: 0,
            dimension: "",
            gameMode: GameMode.Survival,

            position: {
                x: 0,
                y: 0,
                z: 0,
            },
            velocity: {
                x: 0,
                y: 0,
                z: 0,
            },
            angle: {
                yaw: 0,
                pitch: 0,
            }
        } satisfies ClientPlayer as any;
        this.sendLoginAck();
    }

    // Configure

    private handleKnownPack(data: object) {
        const { known_packs } = zodParse(data, zod.object({
            known_packs: zod.array(zod.object({
                namespace: zod.string(),
                id: zod.string(),
                version: zod.string(),
            }))
        }));
        this.state.server!.knownPacks = known_packs satisfies ServerKnownPack[] as any;
        this.sendKnownPack(this.state.clientOptions.loadRegistry === true ? [] : known_packs);
        // this.sendKnownPack([]);
    }

    private handleRegistryData(data: object) {
        const { registry_id, entries } = zodParse(data,
            zod.object({
                registry_id: zod.string(),
                entries: zod.array(zod.object({
                    entry_id: zod.string(),
                    data: zod.record(zod.string(), zod.any()).nullable()
                }))
            })
        );

        if (!this.state.registry) this.state.registry = {} as any;
        const registry = this.state.registry as Record<string, any[]>;
        if (!(registry_id in registry)) registry[registry_id] = [];
        registry[registry_id]!.push(...entries);
    }

    private handleFinishConfiguration(data: object) {
        this.sendConfigureAck();
    }

    private handleConfiguarionPlayDisconnect(data: object) {
        const { reason } = zodParse(data, zod.object({ reason: zod.record(zod.string(), zod.any()) }));
        const text = getTextFromTextComponent(reason);

        this.disconnect(text, reason);
    }

    // Play

    private handlePlayLogin(data: object) {
        const {
            entity_id,
            is_hardcore,
            dimension_names,
            max_players,
            view_distance,
            simulation_distance,
            dimension_name,
            game_mode
        } = zodParse(data,
            zod.object({
                entity_id: zod.int(),
                is_hardcore: zod.boolean(),
                dimension_names: zod.array(zod.string()),
                max_players: zod.int(),
                view_distance: zod.int(),
                simulation_distance: zod.int(),
                dimension_name: zod.string(),
                game_mode: zod.int()
            })
        );


        this.state.world = {
            hardcore: is_hardcore,
            dimensions: dimension_names,
            maxPlayers: max_players,
            viewDistance: view_distance,
            simulationDistance: simulation_distance,
            chunks: {},
            entities: {}
        } satisfies ServerWorld as any; // To avoid type conflict
        this.state.player!.dimension = dimension_name;
        this.state.player!.entityId = entity_id;
        this.state.player!.gameMode = game_mode;
        this.state.status = ClientStatus.Ready;

        if (this.state.useEncryption)
            this.sendPlayerSession();

        this.emit("ready");
    }

    private handleSynchronizePlayerPosition(data: object) {
        const {
            teleport_id,
            x,
            y,
            z,
            velocity_x,
            velocity_y,
            velocity_z,
            yaw,
            pitch,
            flags
        } = zodParse(data,
            zod.object({
                teleport_id: zod.int(),
                x: zod.number(),
                y: zod.number(),
                z: zod.number(),
                velocity_x: zod.number(),
                velocity_y: zod.number(),
                velocity_z: zod.number(),
                yaw: zod.number(),
                pitch: zod.number(),
                flags: zod.object({
                    x: zod.boolean(),
                    y: zod.boolean(),
                    z: zod.boolean(),
                    yaw: zod.boolean(),
                    pitch: zod.boolean(),
                    velX: zod.boolean(),
                    velY: zod.boolean(),
                    velZ: zod.boolean(),
                    rotateVelocity: zod.boolean(),
                }),
            })
        );

        const { position, velocity, angle } = this.state.player!;
        let { x: newPosX, y: newPosY, z: newPosZ } = position;
        let { x: newVelX, y: newVelY, z: newVelZ } = velocity;
        let { yaw: newYaw, pitch: newPitch } = angle;
        if (flags.x) newPosX += x; else newPosX = x;
        if (flags.y) newPosY += y; else newPosY = y;
        if (flags.z) newPosZ += z; else newPosZ = z;
        if (flags.velX) newVelX += velocity_x; else newVelX = velocity_x;
        if (flags.velY) newVelY += velocity_y; else newVelY = velocity_y;
        if (flags.velZ) newVelZ += velocity_z; else newVelZ = velocity_z;
        if (flags.yaw) newYaw += yaw; else newYaw = yaw;
        if (flags.pitch) newPitch += pitch; else newPitch = pitch;
        const newPosition = { x: newPosX, y: newPosY, z: newPosZ },
            newVelocity = { x: newVelX, y: newVelY, z: newVelZ },
            newAngle = { yaw: newYaw, pitch: newPitch };
        this.state.enqueueMutation(state =>
            state.player = {
                ...state.player!,
                position: newPosition,
                velocity: newVelocity,
                angle: newAngle,
            } satisfies ClientPlayer as any
        );
        this.state.enqueueEvent("playerPosition", { x: newPosX, y: newPosY, z: newPosZ });
        this.sendConfirmTeleportation(teleport_id);
        this.sendPacket("move_player_pos_rot", {
            x: newPosition.x,
            feet_y: newPosition.y,
            z: newPosition.z,
            yaw: newAngle.yaw,
            pitch: newAngle.pitch,
            flags: makeMovementFlag(true, false)
        });
    }

    private handleKeepAlive(data: object) {
        const { keep_alive_id } = zodParse(data,
            zod.object({
                keep_alive_id: zod.bigint().or(zod.number())
            })
        );
        this.sendKeepAlive(BigInt(keep_alive_id));
    }

    private handleChangeGameMode(data: object) {
        const { gameMode } = zodParse(data, zod.object({ gameMode: zod.number() }));
        this.state.enqueueMutation(state => state.player!.gameMode = gameMode);
    }

    // Chunk
    private handleChunkData(data_: object) {
        const {
            chunk_x,
            chunk_z,
            heightmaps,
            data,
            block_entities,
            light,
        } = zodParse(data_,
            zod.object({
                chunk_x: zod.int(),
                chunk_z: zod.int(),
                heightmaps: zod.array(zod.any()),
                data: zod.array(zod.int()),
                block_entities: zod.array(zod.object({
                    packed_xz: zod.int(),
                    y: zod.int(),
                    type: zod.int(),
                    data: zod.record(zod.string(), zod.any())
                })),
                light: zod.any().optional(),
            })
        );

        const chunkSections: Record<number, ChunkSection> = {};

        const chunkDataDecoder = new BinaryDecoder(Buffer.from(data));
        for (let height = 0; height < (SectionsPerChunk[this.state.player!.dimension] || 0); height++) {
            const blockCount = chunkDataDecoder.readShort();
            const fluidCount = chunkDataDecoder.readShort();

            // Blocks
            let blockStateBPE = chunkDataDecoder.readUByte();
            let blockStatePalettes: number[] = [];

            if (blockStateBPE === 0) {
                blockStatePalettes = [chunkDataDecoder.readVarInt()];
            } else if (blockStateBPE <= 8) {
                // Indirect palette
                if (blockStateBPE < 4) blockStateBPE = 4; // BPE smaller than 4 will be rounđe up to 4
                blockStatePalettes = chunkDataDecoder.readPrefixedArray(decoder => decoder.readVarInt());
            } else {
                // Direct palette (no palette array)
            }

            const blockEntriesPerSection = 4096;
            const blockEntriesPerLong = Math.floor(64 / blockStateBPE);
            let blockDataArray: BigInt64Array | null = null;
            if (blockStateBPE !== 0) {
                const blockDataArrayLength = Math.floor((blockEntriesPerSection + blockEntriesPerLong - 1) / blockEntriesPerLong);
                blockDataArray = new BigInt64Array(chunkDataDecoder.readArray(blockDataArrayLength, (decoder) => decoder.readLong()));
            }

            // Biomes - Not used yet, but need to be read to advance decoder
            const biomeBPE = chunkDataDecoder.readUByte();
            let biomePalettes: number[] = [];
            if (biomeBPE === 0) {
                biomePalettes = [chunkDataDecoder.readVarInt()]; // Palette value
            } else if (biomeBPE <= 3) {
                // Indirect palette
                biomePalettes = chunkDataDecoder.readPrefixedArray(decoder => decoder.readVarInt());
            } else {
                // Direct palette (no palette array)
            }

            const biomeEntriesPerSection = 64;
            const biomeEntriesPerLong = Math.floor(64 / biomeBPE);
            let biomeDataArray: BigInt64Array | null = null;
            if (biomeBPE !== 0) {
                const biomeDataArrayLength = Math.floor((biomeEntriesPerSection + biomeEntriesPerLong - 1) / biomeEntriesPerLong);
                biomeDataArray = new BigInt64Array(chunkDataDecoder.readArray(biomeDataArrayLength, (decoder) => decoder.readLong()));
            }

            chunkSections[height] = {
                block: {
                    bpe: blockStateBPE,
                    palette: blockStatePalettes,
                    data: blockDataArray
                },
                biome: {
                    bpe: biomeBPE,
                    palette: biomePalettes,
                    data: biomeDataArray
                }
            };

            this.state.enqueueEvent("loadChunk", chunk_x, height, chunk_z);
        }

        const blockEntitiesObj: Record<number, BlockEntity> = Object.fromEntries(
            block_entities.map(val => [val.packed_xz, { type: val.type, data: val.data }])
        );


        this.state.enqueueMutation(state =>
            state.world!.chunks[`${state.player!.dimension}:${chunk_x}:${chunk_z}`] = {
                sections: chunkSections,
                blockEntities: blockEntitiesObj
            });
    }

    private handleUnloadChunk(data: object) {
        const {
            chunk_x,
            chunk_z
        } = zodParse(data, zod.object({
            chunk_x: zod.number(),
            chunk_z: zod.number()
        }));
        this.state.enqueueMutation(state => delete state.world!.chunks[`${state.player!.dimension}:${chunk_x}:${chunk_z}`]);
        this.state.enqueueEvent("unloadChunk", chunk_x, chunk_z);
    }

    private handleBlockEntityData(data_: object) {
        const {
            location,
            type,
            data
        } = zodParse(data_, zod.object({
            location: zod.object({ x: zod.number(), y: zod.number(), z: zod.number() }),
            type: zod.int(),
            data: zod.record(zod.string(), zod.any())
        }));

        const chunkX = Math.floor(location.x / 16),
            chunkZ = Math.floor(location.z / 16);
        const xWitinChunk = location.x % 16,
            zWitinChunk = location.z % 16;
        const packedPosition = packBlockPos(xWitinChunk, location.y, zWitinChunk);
        if (`${this.state.player!.dimension}:${chunkX}:${chunkZ}` in this.state.world!.chunks)
            this.state.enqueueMutation(state =>
                state.world!.chunks[`${state.player!.dimension}:${chunkX}:${chunkZ}`]!.blockEntities[packedPosition] = {
                    type,
                    data
                }
            );
    }

    // Entity
    private handleSpawnEntity(data_: object) {
        const {
            entity_id,
            entity_uuid,
            type,
            x,
            y,
            z,
            velocity,
            pitch,
            yaw,
            head_yaw,
            data
        } = zodParse(data_, zod.object({
            entity_id: zod.int(),
            entity_uuid: zod.string(),
            type: zod.int(),
            x: zod.number(),
            y: zod.number(),
            z: zod.number(),
            velocity: zod.instanceof(Vec3),
            pitch: zod.number(),
            yaw: zod.number(),
            head_yaw: zod.number(),
            data: zod.int(),
        }));

        const entity: Entity = {
            id: entity_id,
            type,
            position: { x, y, z },
            velocity,
            angle: {
                pitch,
                yaw
            },
            data
        };
        this.state.enqueueMutation(state => state.world!.entities[entity_id] = entity);
        this.state.enqueueEvent("spawnEntity", entity);
    }

    private handleTeleportEntity(data: object) {
        const {
            entity_id,
            x,
            y,
            z,
            velocity_x,
            velocity_y,
            velocity_z,
            pitch,
            yaw
        } = zodParse(data, zod.object({
            entity_id: zod.int(),
            x: zod.number(),
            y: zod.number(),
            z: zod.number(),
            velocity_x: zod.number(),
            velocity_y: zod.number(),
            velocity_z: zod.number(),
            pitch: zod.number(),
            yaw: zod.number(),
        }));

        if (entity_id in this.state.world!.entities) this.state.enqueueMutation(state => {
            state.world!.entities[entity_id]!.position = { x, y, z };
            state.world!.entities[entity_id]!.velocity = { x: velocity_x, y: velocity_y, z: velocity_z };
            state.world!.entities[entity_id]!.angle = { pitch, yaw };
        });
        this.state.enqueueEvent("updateEntity", entity_id);
    }

    private handleUpdateEntityPosition(data: object) {
        const {
            entity_id,
            delta_x,
            delta_y,
            delta_z
        } = zodParse(data, zod.object({
            entity_id: zod.number(),
            delta_x: zod.number(),
            delta_y: zod.number(),
            delta_z: zod.number(),
        }));

        if (entity_id in this.state.world!.entities) this.state.enqueueMutation(state => {
            let { x, y, z } = state.world!.entities[entity_id]!.position;
            x += delta_x;
            y += delta_y;
            z += delta_z;
            state.world!.entities[entity_id]!.position = { x, y, z };
        });
        this.state.enqueueEvent("updateEntity", entity_id);
    }

    private handleUpdateEntityPositionRotation(data: object) {
        const {
            entity_id,
            delta_x,
            delta_y,
            delta_z,
            pitch,
            yaw
        } = zodParse(data, zod.object({
            entity_id: zod.number(),
            delta_x: zod.number(),
            delta_y: zod.number(),
            delta_z: zod.number(),
            pitch: zod.number(),
            yaw: zod.number(),
        }));
        if (entity_id in this.state.world!.entities) {
            this.state.enqueueMutation(state => {
                let { x, y, z } = state.world!.entities[entity_id]!.position;
                x += delta_x;
                y += delta_y;
                z += delta_z;
                state.world!.entities[entity_id]!.position = { x, y, z };
                state.world!.entities[entity_id]!.angle = { yaw, pitch };
            });
            this.state.enqueueEvent("updateEntity", entity_id);
        }
    }

    private handleSetEntityVelocity(data: object) {
        const { entity_id, velocity } = zodParse(data, zod.object({
            entity_id: zod.number(),
            velocity: zod.instanceof(Vec3)
        }));

        if (entity_id in this.state.world!.entities)
            this.state.enqueueMutation(state => state.world!.entities[entity_id]!.velocity = velocity);
    }

    private handleRemoveEntity(data: object) {
        const { entity_ids } = zodParse(data, zod.object({ entity_ids: zod.array(zod.number()) }));

        this.state.enqueueMutation(state => {
            for (const entityId of entity_ids) {
                delete state.world!.entities[entityId];
                this.state.enqueueEvent("removeEntity", entityId);
            }
        });
    }

    // Chat
    private handlePlayerChat(data: object) {
        const {
            global_index,
            sender,
            index,
            message_signature_bytes,
            message,
            timestamp,
            salt,
            previous_messages,
            unsigned_content,
            filter_type,
            filter_type_bits,
            chat_type,
            sender_name,
            target_name
        } = zodParse(data, zod.object({
            global_index: zod.int(),
            sender: zod.string(),
            index: zod.int(),
            message_signature_bytes: zod.array(zod.number()).nullable(),
            message: zod.string(),
            timestamp: zod.bigint(),
            salt: zod.bigint(),
            previous_messages: zod.array(zod.object({
                message_id: zod.number(),
                signature: zod.array(zod.number()).optional()
            })),
            unsigned_content: zod.record(zod.string(), zod.any()).nullable(),
            filter_type: zod.int(),
            filter_type_bits: zod.array(zod.bigint()).nullable(),
            chat_type: zod.int().or(zod.record(zod.string(), zod.any())),
            sender_name: zod.record(zod.string(), zod.any()),
            target_name: zod.record(zod.string(), zod.any()).nullable()
        }));

        const senderNameText = getTextFromTextComponent(sender_name).toString(),
            targetNameText = target_name ? getTextFromTextComponent(target_name).toString() : undefined;

        const emitObject = {
            sender: senderNameText,
            target: targetNameText,
            content: message,
            raw: {
                sender: sender_name,
                target: target_name || undefined,
                content: unsigned_content || undefined,
            }
        };

        let link: MessageLink | undefined = undefined;
        if (this.state.clientOptions.shouldVerifyMessageOrder && this.state.messageLinks) {
            if (index === 0) {
                if (this.state.sessionID)
                    link = MessageLink.root(sender, this.state.sessionID.toString("hex"));
                else
                    link = MessageLink.unsinged(sender);
                this.state.messageLinks[sender] = link;
            } else {
                const oldLink = this.state.messageLinks[sender];
                if (!oldLink)
                    throw new MessageLinkNotFound(sender);
                let newLink;
                if (this.state.sessionID)
                    newLink = new MessageLink(global_index, sender, this.state.sessionID.toString("hex"));
                else
                    newLink = MessageLink.unsinged(sender);
                if (!newLink.isDescendantOf(oldLink))
                    throw new UnexpectedValue("message order", newLink.index.toString(), (oldLink.index + 1).toString());
                this.state.messageLinks[sender] = newLink;
                link = newLink;
            }
        }

        if (message_signature_bytes !== null)
            this.state.messageCount += 1;
        if (this.state.clientOptions.shouldVerifyMessageSignature === true && message_signature_bytes) {
            if (!this.state.sessionID)
                throw new AuthRelatedNotFound("session uuid");
            if (!this.state.messageSignatureCache)
                throw new AuthRelatedNotFound("signature cache");
            if (!link)
                throw new HaveSignatureButNotIndex();
            const { publicKey } = this.state.getSignature();

            const formatVersion = Buffer.alloc(4); formatVersion.writeInt32BE(1);
            const senderUUIDBuf = uuidToBuffer(sender);
            const sessionUUIDBuf = this.state.sessionID;
            const indexBuf = Buffer.alloc(4); indexBuf.writeInt32BE(link.index);
            const saltBuf = Buffer.alloc(8); saltBuf.writeBigInt64BE(salt);
            const timestampBuf = Buffer.alloc(8); timestampBuf.writeBigInt64BE(timestamp);
            const _messageBuf = Buffer.from(message, "utf-8");
            const lengthBuf = Buffer.alloc(4); lengthBuf.writeInt32BE(_messageBuf.length);
            const messageBuf = _messageBuf;
            const previousMessagesLenghtBuf = Buffer.alloc(4); previousMessagesLenghtBuf.writeInt32BE(previous_messages.length);
            const previousMessagesBuf = Buffer.concat(this.state.messageSignatureCache.unpack(previous_messages));
            const signaturePayload = Buffer.concat([
                formatVersion,
                senderUUIDBuf,
                sessionUUIDBuf,
                indexBuf,
                saltBuf,
                timestampBuf,
                lengthBuf,
                messageBuf,
                previousMessagesLenghtBuf,
                previousMessagesBuf
            ]);

            const verify = createVerify("RSA-SHA256");
            verify.update(signaturePayload);
            verify.end();
            const signature = Buffer.from(message_signature_bytes);

            if (!verify.verify(publicKey!, signature))
                return this.emit("failedMessage", emitObject);
        }

        this.emit("message", emitObject);
    }

    private handleSystemMessage(data: object) {
        const {
            content,
            overlay: isActionbar
        } = zodParse(data, zod.object({
            content: zod.record(zod.string(), zod.any()),
            overlay: zod.boolean()
        }));
        const text = getTextFromTextComponent(content);

        if (isActionbar) {
            this.emit("actionBar", text.toString());
            this.emit("actionBarRaw", content);
        } else {
            this.emit("systemMessage", text.toString());
            this.emit("systemMessageRaw", content);
        }
    }

    private handleSetActionBar(data: object) {
        const { action_bar_text: content } = zodParse(data, zod.object({ action_bar_text: zod.record(zod.string(), zod.any()) }));
        const text = getTextFromTextComponent(content);
        this.emit("actionBar", text.toString());
        this.emit("actionBarRaw", content);
    }

    private handleDisguisedChatMessage(data: object) {
        const {
            message,
            chatType,
            senderName,
            targetName
        } = zodParse(data, zod.object({
            message: zod.record(zod.string(), zod.any()),
            chatType: zod.string().or(zod.record(zod.string(), zod.any())),
            senderName: zod.record(zod.string(), zod.any()),
            targetName: zod.record(zod.string(), zod.any()).nullable(),
        }));
        const messageText = getTextFromTextComponent(message).toString(),
            senderNameText = getTextFromTextComponent(senderName).toString(),
            targetNameText = targetName ? getTextFromTextComponent(targetName).toString() : undefined;
        this.emit("message", {
            sender: senderNameText,
            target: targetNameText,
            content: messageText,
            raw: {
                sender: senderName,
                target: targetName || undefined,
                content: message,
            }
        });
    }

    /*
    * Send packet 
    */

    // Login

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

    private sendEncryptionResponse(publicKey: Buffer, verifyToken: Buffer) {
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

    private sendLoginAck() {
        this.sendPacket("login_acknowledged", {});
        this.state.state = ConnectionState.Configure;
        this.state.server = {};
    }

    // Configuring

    private sendKnownPack(knownPacks: ServerKnownPack[]) {
        this.sendPacket("select_known_packs", {
            known_packs: {
                value: knownPacks,
                length: knownPacks.length
            }
        });
    }

    private sendConfigureAck() {
        this.sendPacket("finish_configuration", {});
        this.state.state = ConnectionState.Play;
    }

    // Play

    private sendPlayerSession() {
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

    private sendConfirmTeleportation(teleportId: number) {
        this.sendPacket("accept_teleportation", {
            teleport_id: teleportId
        });
    }

    private sendKeepAlive(id: bigint) {
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