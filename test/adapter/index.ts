import { ZodError } from "zod";
import { VersionDefinitions } from "../../src/version/adapter";
import { readFileSync } from "node:fs";

const raw = readFileSync("assets/minecraft/26.2/packets.json", { encoding: "utf8" });
const obj = JSON.parse(raw);
try {
    VersionDefinitions.parse(obj);
} catch (err) {
    if (err instanceof ZodError) {
        console.dir(err.issues[0], { depth: null });
    } else
        throw err;
}