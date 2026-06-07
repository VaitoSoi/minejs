import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { Decoder } from "../../src/nbt/decoder";

const zippedBuffer = readFileSync("./test/decoder/level.dat");
const buffer = gunzipSync(zippedBuffer);
const decoder = new Decoder(buffer, true);
console.log(decoder.decode());