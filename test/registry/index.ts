import { readFile, writeFile } from "node:fs/promises";

async function main() {
    const blocks = JSON.parse(await readFile("./assets/minecraft/blocks.json", { encoding: "utf-8" }));

    for (const block in blocks) {
        if (block === "minecraft:honey_block")
            blocks[block]["definition"]["jump_factor"] = 0.5;
    }

    await writeFile("./assets/minecraft/blocks.json", JSON.stringify(blocks, null, 2));
}

main();