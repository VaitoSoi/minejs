import { BitSet } from "../../src/base/bitset";

const bitset = new BitSet(10);
bitset.set(1, 1);
bitset.set(3, 1);
// console.log(bitset.toString());
const clone = bitset.clone();
// console.log(clone.toString());
clone.set(2, 1);
// console.log(bitset.toString());
// console.log(clone.toString());