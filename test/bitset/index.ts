import { BitSet } from "../../src/base/bitset";

const bitset = new BitSet(10);
bitset.set(1);
bitset.set(3);
console.log(bitset.get(3));