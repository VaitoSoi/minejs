import { BitSet } from "bitset";

const bitset = new BitSet(100);
bitset.set(1, 1);
bitset.set(88, 1);
console.log(bitset.get(88));