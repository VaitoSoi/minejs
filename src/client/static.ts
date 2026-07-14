export const SectionsPerChunk: Record<string, number> = {
    "minecraft:overworld": 24,
    "minecraft:overworld_caves": 24,
    "minecraft:the_end": 16,
    "minecraft:the_nether": 8,
};

export const LevelHeightLimit: Record<string, [min: number, max: number]> = {
    "minecraft:overworld": [-64, 320],
    "minecraft:overworld_caves": [-64, 320],
    "minecraft:the_end": [0, 256],
    "minecraft:the_nether": [0, 0],
};

/**
 * Packed block position within a chunk column to an integer
 * 
 * A packed position look like this:
 * `[9 bits of Y][4 bits of Z][4 bits of X]`
 * 
 * @param x relative within chunk column
 * @param y world height
 * @param z relative within chunk column
 */
export const packBlockPos = (x: number, y: number, z: number) => y << 8 & z << 4 & x;


/**
 * Unpacked block position within a chunk column from an integer
 * 
 * @returns unpacked position
 */
export const readPackedBlockPos = (packed: number) => ({
    x: packed & 0xF,
    z: (packed >> 4) & 0xF,
    y: (packed >> 8) & 0x1FF,
});