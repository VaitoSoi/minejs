import { readFile, writeFile } from "fs/promises";

async function main() {
    const blocks = JSON.parse(await readFile("./assets/minecraft/blocks.json", { encoding: "utf-8" }));
    const shapes = JSON.parse(await readFile("./assets/minecraft/shape.json", { encoding: "utf-8" }));

    for (const block in blocks)
        if (block in shapes && "states" in blocks[block])
            for (const state of blocks[block]["states"])
                if (state["id"] in shapes[block])
                    state["boxes"] = shapes[block][state["id"]];

    await writeFile("./assets/minecraft/blocks.json", JSON.stringify(blocks, null, 2));
}

main();