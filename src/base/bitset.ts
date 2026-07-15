import BitSet_ from "bitset";

/**
 * Custom implementation of BitSet to implement missing method
 */
export class BitSet extends BitSet_ {
    public nextClearBit(fromIndex: number) {
        fromIndex = fromIndex || 0;
        const data = (this as any)['data'];
        let wordIndex = fromIndex >>> 5;

        if (wordIndex >= data.length) {
            // Past the stored words — depends on the infinite tail bit
            return (this as any)['_'] === 0 ? fromIndex : Infinity;
        }

        // ~word marks clear bits; mask off anything before fromIndex.
        // JS's << only uses the low 5 bits of the shift amount, so
        // `-1 << fromIndex` masks correctly even when fromIndex > 31.
        let word = ~data[wordIndex] & (-1 << fromIndex);

        while (true) {
            if (word !== 0) {
                const lowestSet = word & -word;   // isolate lowest set bit
                let c = 0;
                for (let v = lowestSet; (v >>>= 1); c++) {
                    //
                }
                return wordIndex * 32 + c;
            }
            wordIndex++;
            if (wordIndex >= data.length) {
                return (this as any)['_'] === 0 ? wordIndex * 32 : Infinity;
            }
            word = ~data[wordIndex];
        }
    };

    public override clone(): BitSet {
        return new BitSet(this.toString());
    }
}