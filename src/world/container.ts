import { NotImplemented, UnexpectedValue } from "../base/error";
import { TextComponent } from "../base/typing";

/**
 * Represent the data of a slot
 * 
 * @see https://minecraft.wiki/w/Java_Edition_protocol/Slot_data#Format
 */
export interface Slot {
    counts: number,
    itemId: number | undefined,
    addComponents: Record<string, any> | undefined,
    removeComponents: number[] | undefined
}

export enum Button {
    LeftMouse = 0,
    RightMouse = 1,
}

/**
 * Represent a container (such as inventory, chest, anvil, ...)
 */
export class Container {
    /**
     * State ID
     * 
     * You SHOULD NOT edit this field since this field is for syncing state from client and server
     */
    public stateId: number = 0;
    /**
     * Slots data
     * 
     * @see https://minecraft.wiki/w/Java_Edition_protocol/Inventory For more info regarding how slot are organized
     */
    public slots: Slot[] = [];
    /**
     * Data from Set Container Property packet
     * 
     * @see https://minecraft.wiki/w/Java_Edition_protocol/Packets#Set_Container_Property
     * 
     * | Field                                    | Meaning |
     * |------------------------------------------|---------|
     * | # **Furnace / Blast furnace / Smoker**   | ------- |
     * | fuel_left                                | counting from fuel burn time down to 0 |
     * | max_burn_time                            | fuel burn time or 0 (in-game ticks) |
     * | progress_arrow                           | counting from 0 to maximum progress (in-game ticks) |
     * | max_progress                             | always 200 on the vanilla server |
     * | # **Enchantment table**                  | ------- |
     * | level_requirement_for_top_enchantment    |  |
     * | level_requirement_for_middle_enchantment | The enchantment's xp level requirement |
     * | level_requirement_for_bottom_enchantment |  |
     * | enchantment_seed                         | Used for drawing the enchantment names (in SGA) clientside. The same seed is used to calculate enchantments, but some of the data isn't sent to the client to prevent easily guessing the entire list (the seed value here is the regular seed bitwise and 0xFFFFFFF0). |
     * | enchant_id_of_top_enchantment            |  |
     * | enchant_id_of_middle_enchantment         | The enchantment ID (set to -1 to hide it), see below for values |
     * | enchant_id_of_bottom_enchantment         |  |
     * | enchant_level_of_top_enchantment         |  |
     * | enchant_level_of_middle_enchantment      | The enchantment level (1 = I, 2 = II, 6 = VI, etc.), or -1 if no enchant |
     * | enchant_level_of_bottom_enchantment      |  |
     * | # **Beacon**                             | ------- |
     * | power_level                              | 0-4, controls what effect buttons are enabled |
     * | first_effect                             | Potion effect ID for the first effect, or -1 if no effect |
     * | second_level                             | Potion effect ID for the second effect, or -1 if no effect |
     * | # **Anvil**                              | ------- |
     * | repair_cost                              | The repair's cost in XP levels |
     * | # **Brewing stand**                      | ------- |
     * | brew_time                                | 0 – 400, with 400 making the arrow empty, and 0 making the arrow full |
     * | fuel_time                                | 0 - 20, with 0 making the arrow empty, and 20 making the arrow full |
     * | # **Stonecutter**                        | ------- |
     * | selected_recipe                          | The index of the selected recipe. -1 means none is selected |
     * | # **Loom**                               | ------- |
     * | selected_pattern                         | The index of the selected pattern. 0 means none is selected, 0 is also the internal ID of the "base" pattern |
     * | # **Lectern**                            | ------- |
     * | page_number                              | The current page number, starting from 0. |
     * | # **Smithing table**                     | ------- |
     * | has_recipe_error                         | True if greater than zero |
     * | # **Crafter**                            | ------- |
     * | slot_0_disabled                          |  |
     * | slot_1_disabled                          |  |
     * | slot_2_disabled                          |  |
     * | slot_3_disabled                          |  |
     * | slot_4_disabled                          | 0 If the slot is enabled, 1 if the slot is disabled |
     * | slot_5_disabled                          |  |
     * | slot_6_disabled                          |  |
     * | slot_7_disabled                          |  |
     * | slot_8_disabled                          |  |
     * 
     * @see https://minecraft.wiki/w/Java_Edition_data_values#Effects For effect ID
     */
    public properties: Record<string, number> = {};

    constructor(
        /**
         * This is not used at the moment
         */
        public id: number,
        /**
         * @see https://minecraft.wiki/w/Java_Edition_protocol/Inventory#Types
         */
        public type: number,
        public rawTitle: TextComponent
    ) { }

    public static sendClickContainer: (
        windowId: number,
        stateId: number,
        slot: number,
        button: number,
        mode: number
    ) => void = () => { throw new NotImplemented(); };
    private sendClick(
        slot: number,
        button: number,
        mode: number,
    ) {
        return Container.sendClickContainer(
            this.id,
            this.stateId,
            slot,
            button,
            mode
        );
    }

    /**
     * @see https://minecraft.wiki/w/Java_Edition_protocol/Packets#Set_Container_Property
     */
    public setProperty(property: number, data: number) {
        switch (this.type) {
            case 14: // Furnace
            case 10: // Blast furnace
            case 22: // Smoker
                switch (property) {
                    case 0: this.properties["fuel_left"] = data; break;
                    case 1: this.properties["max_burn_time"] = data; break;
                    case 2: this.properties["progress_arrow"] = data; break;
                    case 3: this.properties["max_progress"] = data; break;
                }
                break;
            case 13: // Enchantment table
                switch (property) {
                    case 0: this.properties["level_requirement_for_top_enchantment"] = data; break;
                    case 1: this.properties["level_requirement_for_middle_enchantment"] = data; break;
                    case 2: this.properties["level_requirement_for_bottom_enchantment"] = data; break;
                    case 3: this.properties["enchantment_seed"] = data; break;
                    case 4: this.properties["enchant_id_of_top_enchantment"] = data; break;
                    case 5: this.properties["enchant_id_of_middle_enchantment"] = data; break;
                    case 6: this.properties["enchant_id_of_bottom_enchantment"] = data; break;
                    case 7: this.properties["enchant_level_of_top_enchantment"] = data; break;
                    case 8: this.properties["enchant_level_of_middle_enchantment"] = data; break;
                    case 9: this.properties["enchant_level_of_bottom_enchantment"] = data; break;
                }
                break;
            case 9: // Beacon
                switch (property) {
                    case 0: this.properties["power_level"] = data; break;
                    case 1: this.properties["first_effect"] = data; break;
                    case 2: this.properties["second_level"] = data; break;
                }
                break;
            case 8: // Anvil
                switch (property) {
                    case 0: this.properties["repair_cost"] = data; break;
                }
                break;
            case 11: // Brewing stand
                switch (property) {
                    case 0: this.properties["brew_time"] = data; break;
                    case 1: this.properties["fuel_time"] = data; break;
                }
                break;
            case 24: // Stonecutter
                switch (property) {
                    case 0: this.properties["selected_recipe"] = data; break;
                }
                break;
            case 18: // Loom
                switch (property) {
                    case 0: this.properties["selected_pattern"] = data; break;
                }
                break;
            case 17: // Lectern
                switch (property) {
                    case 0: this.properties["page_number"] = data; break;
                }
                break;
            case 21: // Smithing table
                switch (property) {
                    case 0: this.properties["has_recipe_error"] = data; break;
                }
                break;
            case 7: // Crafter
                switch (property) {
                    case 0: this.properties["slot_0_disabled"] = data; break;
                    case 1: this.properties["slot_1_disabled"] = data; break;
                    case 2: this.properties["slot_2_disabled"] = data; break;
                    case 3: this.properties["slot_3_disabled"] = data; break;
                    case 4: this.properties["slot_4_disabled"] = data; break;
                    case 5: this.properties["slot_5_disabled"] = data; break;
                    case 6: this.properties["slot_6_disabled"] = data; break;
                    case 7: this.properties["slot_7_disabled"] = data; break;
                    case 8: this.properties["slot_8_disabled"] = data; break;
                }
                break;
        }
    }

    /**
     * Click the container slot.
     * 
     * Left click let you pick up all of the item in that slot.
     * 
     * When right-clicking on a stack of items, half the stack will be picked up and half left in the slot. 
     * If the stack is an odd number, the half left in the slot will be the smaller of the amounts
     * 
     * Shift left click and Shift right click do the same job is moving the item to your hotbar, inventory,
     * and containers.
     * 
     * @param slot The slot to interact
     * @param mouse The mouse button
     * @param shift Use Shift key
     * @throws {UnexpectedValue} If the slot is exceeding the total slot
     * @returns 
     */
    public click(slot: number, mouse: Button, shift?: boolean) {
        if (slot != -999 && (slot < 0 || slot >= this.slots.length))
            throw new UnexpectedValue("slot number", `valid slot number (less than ${this.slots.length})`, slot.toString());
        return this.sendClick(slot, mouse, shift ? 1 : 0);
    }

    /**
     * Drop the item in the slot.
     * 
     * Without Ctrl button, it will only drop one item at a time.
     * 
     * With Ctrl, it will drop all of the item in that slot.
     * 
     * @param slot The slot want to drop item
     * @param ctrl Use Ctrl to drop all item
     * @throws {UnexpectedValue} If the slot is exceeding the total slot
     * @returns 
     */
    public drop(slot: number, ctrl?: boolean) {
        if (slot < 0 || slot >= this.slots.length)
            throw new UnexpectedValue("slot number", `valid slot number (0 <= slot index < ${this.slots.length})`, slot.toString());
        return this.sendClick(slot, ctrl ? 1 : 0, 4);
    }

    /**
     * Start the paint mode.
     * 
     * The Minecraft wiki explain this mode:
     * ```text
     * Starting from version 1.5, “painting mode” is available for use in inventory windows. It is done by picking up 
     * a stack of something (more than 1 item), then holding Left Mouse Button, Right Mouse Button or Middle Mouse Button 
     * and dragging the held stack over empty (or same type in case of right button) slots
     * ```
     * 
     * Basically, this mode help you split the item you holding.
     * 
     * Left click will distribute the item. Right click just place one item in each slot.
     * 
     * @example
     * ```ts
     * // Get the `container` object from `client.getOpeningContainer` method or listen to event `openContainer`
     * container.click(1, Button.LeftMouse); // Take all of the item
     * container.paint(Button.LeftMouse) // Start the paint mode
     *     .select(6) // Move the cursor to slot 6, 7, 8
     *     .select(7)
     *     .select(8)
     *     .done(); // Confirm the paint mode
     * ```
     * 
     * @param button The mouse button
     * @throws {UnexpectedValue} If the slot is exceeding the total slot
     * @returns 
     */
    public paint(button: Button) {
        return new PaintingMode(
            this.slots.length,
            button,
            this.sendClick.bind(this)
        );
    }

    /**
     * Double click a slot. This action will collect all of the item, with the same type, in the container to
     * a stack.
     * 
     * @param slot 
     * @returns 
     */
    public doubleClick(slot: number) {
        if (slot < 0 || slot >= this.slots.length)
            throw new UnexpectedValue("slot number", `valid slot number (0 <= slot index < ${this.slots.length})`, slot.toString());
        return this.sendClick(slot, 0, 6);
    }
}

export class PaintingMode {
    constructor(
        private totalSlots: number,
        private currentButton: Button,
        private sendClick: (
            slot: number,
            button: number,
            mode: number,
        ) => void,
    ) {
        sendClick(
            -999,
            currentButton === Button.LeftMouse ? 0 : 4,
            5
        );
    };

    /**
     * Add new slot or, in other word, move the cursor to new slot.
     * 
     * It is unclear (un-documented) that the new slot has to be next to the old slot.
     * @throws {UnexpectedValue} If the slot is exceeding the total slot
     */
    public select(slot: number) {
        if (slot < 0 || slot >= this.totalSlots)
            throw new UnexpectedValue("slot number", `valid slot number (0 <= slot index < ${this.totalSlots})`, slot.toString());
        this.sendClick(
            slot,
            this.currentButton === Button.LeftMouse ? 1 : 5,
            5
        );
    }

    /**
     * Mark as complete the paint mode
     * 
     * You have to call this function to do other action.
     */
    public done() {
        this.sendClick(
            -999,
            this.currentButton === Button.LeftMouse ? 2 : 6,
            5
        );
    }
}