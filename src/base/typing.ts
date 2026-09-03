/** @hidden */
export type If<Condition extends boolean, True, False = null> = Condition extends true ? True : Condition extends false ? False : True | False;


/**
 * Representing a TextComponent
 * 
 * @see https://minecraft.wiki/w/Text_component_format
 */
export type TextComponent = Record<string, any>;

export interface RegistryData {
    registry_id: string,
    entries: { entry_id: string, data: Record<string, any> | null }[]
}