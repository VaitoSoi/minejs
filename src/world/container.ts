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
     * @see https://minecraft.wiki/w/Java_Edition_protocol/Inventory For more info how how slot are organized
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
}