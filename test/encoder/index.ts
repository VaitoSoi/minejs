import { NBTEncoder } from "../../src/nbt/encoder";
import { NBTDecoder } from "../../src/nbt/decoder";

const obj = {
    "hello": "world",
    "byte": 36,
    "short": 6769,
    "int": 2_147_000_000,
    "long": BigInt("9223372036854000000"),
    "float": 3.667,
    "array_of_byte": [36, 67, 69],
    "array_of_int": [2_147_000_000, 2_147_000_001],
    "array_of_long": [BigInt("9223372036854000000"), BigInt("9223372036854000001")],
    "array_of_str": ["six", "seven"],
    "an": { "nested": "coupound" },
    "even": { "deeper": { "nested": "coupound" }, "some_other_field": ["blah", "blah", "blah"] },
    "empty_coupound": {},
    "empty_array": []
};
const encoder = new NBTEncoder(obj);
const buffer = encoder.encode();

const decoder = new NBTDecoder(buffer);
console.log(decoder.decode());
