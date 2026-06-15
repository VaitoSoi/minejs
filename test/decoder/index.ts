import { readFileSync } from "node:fs";

import { NBTDecoder } from "../../src/translator/decoder";

const zippedBuffer = readFileSync("./test/decoder/level.dat");
const decoder = new NBTDecoder(zippedBuffer, true);
console.log(decoder.decode());