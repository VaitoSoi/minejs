import { EntitiesManager } from "./entity";
import { Angle, Axis, BaseAxis, BaseVec3, Vec3 } from "./direction";
import { AABB, Shapes, VoxelShape } from "./aabb";
import { BlockGetter, BlockManager, BlockState } from "./block";
import { clamp, Epsilon, equal, lerp } from "./math";
import { TCPClient } from "../client/tcp";
import { ClientNotReady } from "./error";
import { LevelHeightLimit } from "../client/static";

export enum MoveDirection {
    Forward = "W",
    Backward = "S",
    Left = "A",
    Right = "D",
}

const VectorMovement: Record<MoveDirection, Vec3> = {
    [MoveDirection.Forward]: new Vec3(0, 0, 1),
    [MoveDirection.Backward]: new Vec3(0, 0, -1),
    [MoveDirection.Left]: new Vec3(1, 0, 0),
    [MoveDirection.Right]: new Vec3(-1, 0, 0),
};

/**
 * Not used for now
 */
export enum MoverType {
    SELF,
    PLAYER,
    PISTON,
    SHULKER_BOX,
    SHULKER
}

export class Player {
    private fallDistance: number = 0;
    private deltaMovement: Vec3 = Vec3.Zero;
    private supportBlockPos: BaseVec3 | null = null;

    // Moving state
    // TODO: need is sprinting
    private heldInputs: Set<MoveDirection> = new Set();
    private isCrouncing: boolean = false;
    private isJumping: boolean = false;
    private lastPos: BaseVec3 | null = null;
    private lastAngle: Angle | null = null;
    private positionReminder: number = 0;

    // Collision
    private horizontalCollision: boolean = false;
    private verticalCollision: boolean = false; // For debuging now
    private onGround: boolean = true;
    private lastHorizontalCollision: boolean = false;
    private lastOnGround: boolean = true;

    constructor(
        private entities: EntitiesManager,
        private blocks: BlockManager,
        private tcp: TCPClient
    ) {
        this.tcp.on("playerPosition", () => {
            this.onGround = true;
            this.horizontalCollision = false;
            this.fallDistance = 0;
            this.deltaMovement = new Vec3(this.tcp.player!.velocity);
        });
    }

    public setInitialVal() {
        this.lastPos = this.getPos();
        this.lastAngle = this.getAngle();
    }
    public pruneInitialVal() {
        this.fallDistance = 0;
        this.deltaMovement = Vec3.Zero;
        this.supportBlockPos = null;
        this.heldInputs = new Set();
        this.isCrouncing = false;
        this.isJumping = false;
        this.lastPos = null;
        this.lastAngle = null;
        this.positionReminder = 0;
        this.horizontalCollision = false;
        this.verticalCollision = false;
        this.onGround = true;
        this.lastHorizontalCollision = false;
        this.lastOnGround = true;
    }

    // Inputting, to control current plat
    public input(input: MoveDirection) { this.heldInputs.add(input); }
    public releaseInput(input: MoveDirection) { this.heldInputs.delete(input); }
    public releaseAllInputs() { this.heldInputs.clear(); }
    public pressShift() { this.isCrouncing = true; }
    public releaseShift() { this.isCrouncing = false; }
    public pressSpace() { this.isJumping = true; }
    public releaseSpace() { this.isJumping = false; }

    private getInputVector(): Vec3 {
        let vec = Vec3.Zero;
        for (const held of this.heldInputs)
            vec = vec.add(VectorMovement[held]);
        return vec;
    }

    /* Getting helper, from TCP client */
    private getPos() {
        this.tcp.checkReady();
        return new Vec3(this.tcp.player!.position);
    }
    private setPos(pos: Vec3) {
        this.tcp.checkReady();
        this.tcp.player!.position = pos.copyBase();
    }
    private getAngle() {
        this.tcp.checkReady();
        return this.tcp.player!.angle;
    }
    private getDimension() {
        this.tcp.checkReady();
        return this.tcp.player!.dimension;
    }

    private setDeltaMovement(x: number, y: number, z: number): void;
    private setDeltaMovement(vec: BaseVec3): void;
    private setDeltaMovement(a: BaseVec3 | number, b?: number, c?: number): void {
        const vec3 = a instanceof Vec3 ? a : new Vec3(Vec3.loadArgs(a, b, c));
        if (vec3.isFinite())
            this.deltaMovement = vec3;
    }

    private getOnPos(offset: number): BaseVec3 {
        if (this.supportBlockPos) {
            if (offset > 1e-5) {
                const { x, z } = this.supportBlockPos;
                const belowState = this.blocks.at(this.supportBlockPos)!;
                // TODO: Add missing FenceGateBlock case
                if (offset < 0.5 && (belowState.owner.definitions['type'] === "minecraft:fence" || belowState.owner.definitions['type'] === "minecraft:wall")) {
                    return this.supportBlockPos;
                } else return {
                    x, y: this.getPos().y - offset, z
                };
            } else return this.supportBlockPos;
        }
        const { x, y, z } = this.getPos();
        return {
            x, y: y - offset, z
        };
    }

    private getLevelMinY() {
        const dimension = this.getDimension();
        return LevelHeightLimit[dimension]![0];
    }

    private getInBlockState() {
        const { x, y, z } = this.getPos();
        const blockPos = {
            x: Math.floor(x),
            y: Math.floor(y),
            z: Math.floor(z),
        };
        return this.blocks.at(blockPos)!;
    }

    private onClimbable() {
        const state = this.getInBlockState();
        if (state.owner.getClimbable())
            return true;
        if (state.owner.getType() === "minecraft:trapdoor") {
            const { x, y, z } = this.getPos();
            const posBelow = {
                x: Math.floor(x),
                y: Math.floor(y) - 1,
                z: Math.floor(z),
            };
            const stateBelow = this.blocks.at(posBelow)!;
            if (
                stateBelow.owner.getType() === "minecraft:ladder" && // if below is ladder
                (state.getFacing() && stateBelow.getFacing()) && // if both have facing props
                state.getFacing() === stateBelow.getFacing() // if both are the same
            ) return true;
        }
        return false;
    }

    /* Logics */

    public tick() {
        if (!this.tcp.isReady()) return;
        if (!this.lastPos || !this.lastAngle) throw new ClientNotReady();

        // // console.log("tick");
        // // console.log(this.getPos());

        this.aiStep();
        const { x, y, z } = this.getPos(),
            { x: xLast, y: yLast, z: zLast } = this.lastPos,
            { yaw: xRot, pitch: yRot } = this.getAngle(),
            { yaw: xRotLast, pitch: yRotLast } = this.lastAngle;
        const deltaX = x - xLast,
            deltaY = y - yLast,
            deltaZ = z - zLast,
            deltaYRot = yRot - yRotLast,
            deltaXRot = xRot - xRotLast;
        this.positionReminder++;
        const move = new Vec3(deltaX, deltaY, deltaZ).lengthSqr() > (2e-4 * 2e-4) || this.positionReminder > 20,
            rot = deltaXRot !== 0 || deltaYRot !== 0;
        if (move && rot)
            this.tcp.sendPlayerPosRot(this.getPos(), this.getAngle(), this.onGround, this.horizontalCollision);
        else if (move)
            this.tcp.sendPlayerPos(this.getPos(), this.onGround, this.horizontalCollision);
        else if (rot)
            this.tcp.sendPlayerRot(this.getAngle(), this.onGround, this.horizontalCollision);
        else if (
            this.onGround !== this.lastOnGround ||
            this.horizontalCollision !== this.lastHorizontalCollision
        )
            this.tcp.sendPlayerStatus(this.onGround, this.horizontalCollision);

        if (move) {
            this.lastPos = this.getPos();
            this.positionReminder = 0;
        }
        if (rot)
            this.lastAngle = this.getAngle();

        this.lastOnGround = this.onGround;
        this.lastHorizontalCollision = this.horizontalCollision;
    }

    private aiStep() {
        // eslint-disable-next-line prefer-const
        let { x, y, z } = this.deltaMovement;
        if (this.deltaMovement.horizontalDistanceSqr() < 9e-6) {
            x = 0;
            z = 0;
        }
        this.setDeltaMovement(x, y, z);

        if (this.isJumping) {
            const jumpPower = this.getJumpFactor();

            if (jumpPower > 1e-5) {
                const { x: dx, y: dy, z: dz } = this.deltaMovement;
                this.setDeltaMovement(dx, Math.max(dy, jumpPower), dz);
            }
        }
        // TODO: Handle in fluid

        // TODO: Handle potion effect: Slow falling and Levitation

        // TODO: Push entities
        // console.log({
        //     type: "BEFORE-TRAVEL",
        //     pos: this.getPos(),
        //     vel: this.deltaMovement,
        //     onGround: this.onGround,
        //     horizontalCollision: this.horizontalCollision,
        //     verticalCollision: this.verticalCollision
        // });
        this.travel(this.getInputVector());
    }

    private getJumpFactor() {
        const { x, y, z } = this.getPos();
        const inBlock = this.blocks.at(x, y, z)!;
        const belowBlock = this.blocks.at(x, y - 0.5, z)!;
        return inBlock.owner.getJumpFactor() === 1 ? belowBlock.owner.getJumpFactor() : inBlock.owner.getJumpFactor();
    }

    /*
     * Invoking flow
     * 
     *         |-> travelInAir ---|
     * travel -|-> travelInFluid -|--> move -> colision
     *         |-> flying? -------|
     */

    /* 
     * Travel related methods
     */
    private travel(input: Vec3) {
        // TODO: Handle other case: flying, water, lava
        return this.travelInAir(input);
    }

    private travelInAir(input: Vec3) {
        const posBelow = this.getOnPos(0.50001);
        if (!this.blocks.hasChunkAt(posBelow))
            return; // // console.log(`no chunk at ${Math.floor(posBelow.x / 16)} ${Math.floor(posBelow.y / 16)} ${Math.floor(posBelow.z / 16)}`);
        // // console.log('posBelow', posBelow, 'block', this.blocks.at(posBelow)?.owner.getType());
        const blockFriction = this.onGround ? this.blocks.at(posBelow)!.owner.getFriction() : 1;
        const movement = this.handleFrictionAndCalculateMovement(input, blockFriction);
        let movementY = movement.y;
        // TODO: handle levitation effect
        if (this.blocks.hasChunkAt(posBelow)) {
            movementY -= 0.08;
        } else if (this.getPos().y > this.getLevelMinY()) {
            movementY = -0.1;
        } else {
            movementY = 0;
        }
        const airDrag = 0.91; // the orignal code invoke some function 
        // TODO: fully implement missing method
        const friction = blockFriction * airDrag;
        this.setDeltaMovement(new Vec3(movement.x * friction, movementY * 0.98, movement.z * friction));
    }

    private handleFrictionAndCalculateMovement(input: Vec3, friction: number) {
        this.moveRelative(input, this.getFrictionInfluencedSpeed(friction));
        this.setDeltaMovement(this.handleOnClimbable(this.deltaMovement));
        this.move(MoverType.SELF, this.deltaMovement);
        let movement = this.deltaMovement;
        if (
            (this.horizontalCollision || this.isJumping) && this.onClimbable()
            // TODO: Handle case stuck in power snow
        )
            movement = movement.with(BaseAxis.Y, 0.2);
        return movement;
    }

    private getFrictionInfluencedSpeed(blockFriction: number): number {
        if (!this.onGround) return 0.02;
        if (blockFriction > 0.6)
            return this.getSpeed() * (0.21600002 / (blockFriction * blockFriction * blockFriction));
        return this.getSpeed();
    }

    private handleOnClimbable(delta: Vec3) {
        if (this.onClimbable()) {
            this.fallDistance = 0;
            const xd = clamp(delta.x, -0.15, 0.15);
            const zd = clamp(delta.z, -0.15, 0.15);
            let yd = Math.max(delta.y, -0.15);
            if (yd < 0.0 && this.getInBlockState().id !== "minecraft:scaffolding" && this.isCrouncing)
                yd = 0.0;
            delta = new Vec3(xd, yd, zd);
        }
        return delta;
    }

    private getSpeed() {
        // return the base for now
        // TODO: Handle other cases: sprinting, speed-enchanted gear and potion
        return 0.1;
    }

    private moveRelative(input: Vec3, speed: number) {
        let delta = Vec3.Zero;
        if (input.lengthSqr() >= Epsilon) {
            const movement = (input.lengthSqr() > 1 ? input.normalize() : input).scale(speed);
            const yRotation = this.getAngle().yaw,
                yRotInRad = yRotation * Math.PI / 180;
            const sin = Math.sin(yRotInRad),
                cos = Math.cos(yRotInRad);
            delta = new Vec3((movement.x * cos) - (movement.z * sin), movement.y, (movement.z * cos) + (movement.x * sin));
        }
        this.setDeltaMovement(this.deltaMovement.add(delta));
    }

    /*
     * Move (collision) related methods  
     */
    private move(
        type: MoverType, // Not used for now 
        delta: Vec3
    ) {
        // console.log({
        //     type: "BEGIN-MOVE",
        //     pos: this.getPos(),
        //     velocity: this.deltaMovement,
        //     onGround: this.onGround,
        //     delta,
        // });
        const movement = this.collide(delta);
        // console.log({
        //     type: "AFTER-COLLIDE",
        //     movement
        // });
        if (movement.length() > Epsilon || delta.lengthSqr() - movement.lengthSqr() < Epsilon) {
            if (this.fallDistance != 0 && movement.length() >= 1) {
                const checkDistance = Math.min(movement.length(), 8);
                const checkTo = this.getPos().add(movement.normalize().scale(checkDistance));
                const hitResult = BlockGetter.clip(this.getPos(), checkTo, {
                    from: this.getPos(),
                    to: checkTo,
                    getBlockState: (position) => this.blocks.at(position)!.shape
                });
                if (hitResult?.miss !== false) {
                    this.fallDistance = 0;
                }
            }

            const pos = this.getPos();
            const newPosition = pos.add(movement);
            // addMovementThisTick(new Movement(pos, newPosition, delta2));
            this.setPos(newPosition);
        }

        this.checkFallDamage(movement.y);

        const movedVertically = Math.abs(delta.y) > 0,
            verticalCollision = !equal(delta.y, movement.y), // or yCollision
            verticalCollisionBelow = verticalCollision && delta.y < 0;
        const xCollision = !equal(delta.x, movement.x),
            zCollision = !equal(delta.z, movement.z),
            horizontalCollision = xCollision || zCollision;
        const effectPos = this.getOnPos(0.2),
            effectState = this.blocks.at(effectPos)!;
        this.horizontalCollision = horizontalCollision;
        this.verticalCollision = verticalCollision;
        if ((movedVertically && verticalCollision) || horizontalCollision)
            this.restituteMovementAfterCollisions(effectState, xCollision, zCollision, verticalCollision, verticalCollisionBelow, movement);

        this.onGround = verticalCollisionBelow;
        const speedFactor = effectState.owner.getSpeedFactor();
        this.setDeltaMovement(this.deltaMovement.multiply(speedFactor, 1, speedFactor));
        // console.log({
        //     type: "DONE-MOVE",
        //     pos: this.getPos(),
        //     vel: this.deltaMovement,
        //     onGround: this.onGround,
        //     horizontalCollision: this.horizontalCollision,
        //     verticalCollision: this.verticalCollision,
        //     originalMovement: delta,
        //     resolvedMovement: movement
        // });
    }

    private checkFallDamage(ya: number) {
        if (
            // !isInWater() &&
            ya < 0
        )
            this.fallDistance -= ya;
        if (this.onGround)
            this.fallDistance = 0;
    }

    private restituteMovementAfterCollisions(
        state: BlockState,
        xCollision: boolean,
        zCollision: boolean,
        verticalCollision: boolean,
        verticalCollisionBelow: boolean,
        movement: Vec3
    ) {
        const currentMovement = this.deltaMovement;
        let restitution = 0,
            gravityCompensation = 0,
            effectiveDrag = 1;
        let movementAfterBounced = currentMovement.copy();
        if (xCollision) movementAfterBounced = movementAfterBounced.with(BaseAxis.X, 0);
        if (zCollision) movementAfterBounced = movementAfterBounced.with(BaseAxis.Z, 0);
        if (verticalCollision) {
            if (verticalCollisionBelow)
                restitution = (
                    -currentMovement.y < 0.08 ||
                    this.isCrouncing ||
                    state.owner.getBounciness() === 0
                ) ? 0 : state.owner.getBounciness();

            if (restitution > 0) {
                const portionWithMovement = movement.y / currentMovement.y;
                gravityCompensation = portionWithMovement * 0.08;
                effectiveDrag = lerp(portionWithMovement, 1, 0.98);
            }
            movementAfterBounced = movementAfterBounced.with(BaseAxis.Y, (gravityCompensation - currentMovement.y) * effectiveDrag * restitution);
        }
        this.setDeltaMovement(movementAfterBounced);
    }

    private collide(movement: Vec3): Vec3 {
        // Get player's bounding box
        const { x: playerX, y: playerY, z: playerZ } = this.tcp.player!.position;
        const playerBB = AABB.fromEntityType("minecraft:player")
            .move(playerX, playerY, playerZ);
        const expandedBB = playerBB.expandTowards(movement);
        // console.log({
        //     type: "PLAYER-AABB",
        //     pos: this.getPos(),
        //     playerBB: playerBB.copyBase(),
        //     expandedBB: expandedBB.copyBase(),
        // });

        // Collect all colliders
        const colliders = this.collectColliders(expandedBB, [this.tcp.player!.entityId]);
        // // console.log('nonEmptyColliders', colliders.filter(c => !c.isEmpty()).length);

        // Get the farest distance can move
        let movementStep: Vec3;
        if (colliders.length != 0 && movement.lengthSqr() !== 0)
            movementStep = this.collideWithShapes(movement, playerBB, colliders);
        else movementStep = movement;

        // Check if I can step up WITHOUT jumping
        const xCollision = movement.x != movementStep.x;
        const yCollision = movement.y != movementStep.y;
        const zCollision = movement.z != movementStep.z;
        const onGroundAfterCollision = yCollision && movement.y < 0.0;
        if ((onGroundAfterCollision || this.onGround) && (xCollision || zCollision)) {
            const groundedAABB = onGroundAfterCollision ? playerBB.move(0, movementStep.y, 0) : playerBB;
            let stepUpAABB = groundedAABB.expandTowards(movement.x, 0.6, movement.z);
            if (!onGroundAfterCollision)
                stepUpAABB = stepUpAABB.expandTowards(0, -1e-5, 0);

            const colliders = this.collectColliders(stepUpAABB, [this.tcp.player!.entityId]);
            const stepHeightToSkip = movementStep.y;
            const stepUpCandidateSet: Set<number> = new Set();
            for (const collider of colliders) {
                const coords = collider.getCoords(BaseAxis.Y);
                for (const coord of coords) {
                    const relativeCoord = coord - groundedAABB.minY;
                    if (relativeCoord < 0 || relativeCoord == stepHeightToSkip) continue;
                    if (relativeCoord > 0.6) break;
                    stepUpCandidateSet.add(relativeCoord);
                }
            }
            const stepUpCandidates = Array.from(stepUpCandidateSet.values());
            stepUpCandidates.sort((a, b) => a - b);

            // console.log({
            //     type: "STEP-UP",
            //     playerY: playerY,
            //     groundedAABBminY: groundedAABB.minY,
            //     movementY: movement.y,
            //     movementStepY: movementStep.y,
            //     stepHeightToSkip,
            //     candidates: stepUpCandidates,
            // });


            for (const candidateHeight of stepUpCandidates) {
                const stepFromGround = this.collideWithShapes(new Vec3(movement.x, candidateHeight, movement.z), groundedAABB, colliders);
                // console.log({
                //     type: "STEP-CANDIDATE",
                //     candidateHeight,
                //     requested: movement,
                //     movementStep,
                //     stepFromGround,
                //     accepted:
                //         stepFromGround.horizontalDistanceSqr() >
                //         movementStep.horizontalDistanceSqr(),
                // });
                if (stepFromGround.horizontalDistanceSqr() > movementStep.horizontalDistanceSqr()) {
                    const distanceFromGround = playerBB.minY - groundedAABB.minY;
                    // console.log({
                    //     type: "ACCEPTED-STEP-CANDIDATE",
                    //     after: stepFromGround.subtract(0, distanceFromGround, 0),
                    // });
                    return stepFromGround.subtract(0, distanceFromGround, 0);
                }
            }
        }

        // // console.log('expandedBB', expandedBB, 'colliderCount', colliders.length);
        // // console.log('movement.y', movement.y, 'movementStep.y', movementStep.y);

        return movementStep;
    }

    private collectColliders(aabb: AABB, ignoreEntity: number[] = []) {
        const entities = this.entities.queryAABB(aabb, ignoreEntity).map((box) => VoxelShape.fromBox(box));
        const blocks = this.blocks.queryAABB(aabb);
        return [...entities, ...blocks];
    }


    public collideWithShapes(movement: Vec3, aabb: AABB, colliders: VoxelShape[]) {
        let resolvedMovement = Vec3.Zero;
        for (const axis of Axis.stepOrder(movement.x, movement.z)) {
            const axisMovement = movement.get(axis);
            if (Math.abs(axisMovement) < Epsilon) continue;
            const distance = Shapes.collide(
                axis,
                aabb.move(resolvedMovement),
                colliders,
                axisMovement
            );
            resolvedMovement = resolvedMovement.with(axis, distance);
            // console.log({ type: "AXIS-STEP", axis, axisMovement, distanceResolved: distance, aabbUsed: aabb.move(resolvedMovement).copyBase() });
        }
        return resolvedMovement;
    }
}