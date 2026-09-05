import assert from "node:assert";
import { UnexpectedValue } from "./error";
import { numberOfLeadingZeros, numberOfTrailingZeros } from "./math";

/**
 * Simplified implementation of the Java's BitSet class
 * 
 * @see https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/BitSet.java
 * @hidden
 */
export class BitSet {
    public static readonly ADDRESS_BITS_PER_WORD = 6;
    public static readonly BITS_PER_WORD = 1 << this.ADDRESS_BITS_PER_WORD;
    public static readonly WORD_MASK = 0xffffffffffffffffn;

    public words: BigUint64Array;
    public wordsInUse: number = 0;

    private static wordIndex(bitIndex: number) {
        return bitIndex >> this.ADDRESS_BITS_PER_WORD;
    }

    private static bitIndexInWord(bitIndex: number) {
        return bitIndex & (this.BITS_PER_WORD - 1); // should be bitIndex & 63
    }

    /**
     * Create a mask with lowest `n` bits set to 1
     * 
     * For example:
     * * n = 0 -> `0b0n`
     * * n = 3 -> `0b111n`
     * * n = 5 -> `0b11111n`
     * 
     * @param nBits 
     * @returns 
     */
    private static lowBits(nBits: number) {
        return (1n << BigInt(nBits)) - 1n;
    }

    private initWords(nBits: number) {
        return new BigUint64Array(BitSet.wordIndex(nBits - 1) + 1);
    }

    private static checkRange(fromIndex: number, toIndex: number) {
        if (fromIndex < 0)
            throw new UnexpectedValue("value of fromIndex", fromIndex.toString(), "non-negative number");
        if (toIndex < 0)
            throw new UnexpectedValue("value of toIndex", toIndex.toString(), "non-negative number");
        if (fromIndex > toIndex)
            throw new UnexpectedValue("fromIndex and toIndex", `fromIndex ${fromIndex}; toIndex ${toIndex}`, "fromIndex has to be smaller than toIndex");
    }


    constructor(nBits?: number) {
        if (nBits && nBits < 0)
            throw new UnexpectedValue("length of bitset", nBits.toString(), "non-negative number");
        this.words = this.initWords(nBits ?? BitSet.BITS_PER_WORD);
    }

    public clone() {
        const bitset = new BitSet(0);
        bitset.words = structuredClone(this.words);
        bitset.wordsInUse = this.wordsInUse;
        bitset.checkInvariants();
        return bitset;
    }

    private expandTo(wordIndex: number) {
        const wordsRequired = wordIndex + 1;
        if (this.wordsInUse < wordsRequired) {
            this.ensureCapacity(wordsRequired);
            this.wordsInUse = wordsRequired;
        }
    }

    private ensureCapacity(wordsRequired: number) {
        if (wordsRequired > this.words.length) {
            // Allocate larger of doubled size or required size
            const request = Math.max(2 * this.words.length, wordsRequired);
            const newWords = new BigUint64Array(request);
            newWords.set(this.words);
            this.words = newWords;
        }
    }

    private recalculateWordsInUse() {
        let i = this.wordsInUse - 1;
        while (i >= 0 && this.words[i] === 0n) i--;
        this.wordsInUse = i + 1; // The new logical size
    }

    private checkInvariants() {
        assert(this.wordsInUse === 0 || this.words[this.wordsInUse - 1] !== 0n);
        assert(this.wordsInUse >= 0 && this.wordsInUse <= this.words.length);
        assert(this.wordsInUse === this.words.length || this.words[this.wordsInUse] === 0n);
    }


    public toByteArray() {
        const n = this.wordsInUse;
        if (n == 0)
            return [];

        const bytes: number[] = [];
        for (const word of this.words) {
            let coppiedWord = structuredClone(word);
            // Slice a 64-bit (or 8-byte word) into 8 8-bit (or 1-byte) slices
            for (let i = 0; i < 8; i++) {
                bytes.push(Number(coppiedWord & 0xffn));
                coppiedWord >>= 8n;
            }
        }

        while (bytes.length > 0 && bytes.at(-1) === 0) bytes.pop();
        return bytes;
    }

    public flip(bitIndex: number) {
        if (bitIndex < 0)
            throw new UnexpectedValue("value of bitIndex", bitIndex.toString(), "non-negative number");

        const wordIndex = BitSet.wordIndex(bitIndex);
        this.expandTo(wordIndex);

        this.words[wordIndex]! ^= BigInt(BitSet.bitIndexInWord(bitIndex));

        this.recalculateWordsInUse();
        this.checkInvariants();
    }

    public set(bitIndex: number) {
        if (bitIndex < 0)
            throw new UnexpectedValue("value of bitIndex", bitIndex.toString(), "non-negative number");

        const wordIndex = BitSet.wordIndex(bitIndex);
        this.expandTo(wordIndex);

        this.words[wordIndex]! |= 1n << BigInt(BitSet.bitIndexInWord(bitIndex)); // Restores invariants

        this.checkInvariants();
    }
    public setRange(fromIndex: number, toIndex: number) {
        BitSet.checkRange(fromIndex, toIndex);

        if (fromIndex == toIndex)
            return;

        // Increase capacity if necessary
        const startWordIndex = BitSet.wordIndex(fromIndex);
        const endWordIndex = BitSet.wordIndex(toIndex - 1);
        this.expandTo(endWordIndex);

        const fromBit = BitSet.bitIndexInWord(fromIndex),
            toBitInclusive = BitSet.bitIndexInWord(toIndex - 1) + 1,

            /**
             * The NOT (~) bitwise meaning:
             * 
             * Let say we want to set 2 to 6:
             * ```
             * 110010100
             *    ^   ^
             *    |   +-- this is the 2nd bit
             *  and this is the 6th bit
             * ```
             * 
             * So we call lowBits(2) and it return `...0011`
             * 
             * Then we have to flip it to `...1100` to access the '2nd bit and the bits after it'
             */
            firstWordMask = ~BitSet.lowBits(fromBit),
            lastWordMask = BitSet.lowBits(toBitInclusive);
        if (startWordIndex == endWordIndex) {
            // Case 1: One word
            this.words[startWordIndex]! |= (firstWordMask & lastWordMask);
        } else {
            // Case 2: Multiple words
            // Handle first word
            this.words[startWordIndex]! |= firstWordMask;

            // Handle intermediate words, if any
            for (let i = startWordIndex + 1; i < endWordIndex; i++)
                this.words[i] = BitSet.WORD_MASK;

            // Handle last word (restores invariants)
            this.words[endWordIndex]! |= lastWordMask;
        }

        this.checkInvariants();
    }


    public clear(bitIndex: number) {
        if (bitIndex < 0)
            throw new UnexpectedValue("value of bitIndex", bitIndex.toString(), "non-negative number");

        const wordIndex = BitSet.wordIndex(bitIndex);
        if (wordIndex >= this.wordsInUse)
            return;

        this.words[wordIndex]! &= ~(1n << BigInt(bitIndex));

        this.recalculateWordsInUse();
        this.checkInvariants();
    }
    public clearRange(fromIndex: number, toIndex: number) {
        BitSet.checkRange(fromIndex, toIndex);

        if (fromIndex == toIndex)
            return;

        const startWordIndex = BitSet.wordIndex(fromIndex);
        if (startWordIndex >= this.wordsInUse)
            return;

        let endWordIndex = BitSet.wordIndex(toIndex - 1);
        if (endWordIndex >= this.wordsInUse) {
            toIndex = this.length();
            endWordIndex = this.wordsInUse - 1;
        }

        const fromBit = BitSet.bitIndexInWord(fromIndex),
            toBitInclusive = BitSet.bitIndexInWord(toIndex - 1) + 1,
            /**
             * See the explaination in the setRange function
             */
            firstWordMask = ~BitSet.lowBits(fromBit),
            lastWordMask = BitSet.lowBits(toBitInclusive);
        if (startWordIndex == endWordIndex) {
            // Case 1: One word
            this.words[startWordIndex]! &= ~(firstWordMask & lastWordMask);
        } else {
            // Case 2: Multiple words
            // Handle first word
            this.words[startWordIndex]! &= ~firstWordMask;

            // Handle intermediate words, if any
            for (let i = startWordIndex + 1; i < endWordIndex; i++)
                this.words[i]! = 0n;

            // Handle last word
            this.words[endWordIndex]! &= ~lastWordMask;
        }

        this.recalculateWordsInUse();
        this.checkInvariants();
    }


    public get(bitIndex: number) {
        if (bitIndex < 0)
            throw new UnexpectedValue("value of bitIndex", bitIndex.toString(), "non-negative number");

        this.checkInvariants();

        const wordIndex = BitSet.wordIndex(bitIndex);
        if (wordIndex >= this.wordsInUse) return false;

        const bit = 1n << BigInt(BitSet.bitIndexInWord(bitIndex));
        return (Number(this.words[wordIndex]! & bit) != 0);
    }

    public nextSetBit(fromIndex: number) {
        if (fromIndex < 0)
            throw new UnexpectedValue("value of fromIndex", fromIndex.toString(), "non-negative number");

        this.checkInvariants();

        let u = BitSet.wordIndex(fromIndex);
        if (u >= this.wordsInUse)
            return -1;

        let word = this.words[u]! & (~0n << BigInt(BitSet.bitIndexInWord(fromIndex)));

        while (true) {
            if (word != 0n)
                return (u * BitSet.BITS_PER_WORD) + numberOfTrailingZeros(word);
            if (++u == this.wordsInUse)
                return -1;
            word = this.words[u]!;
        }
    }

    public nextClearBit(fromIndex: number) {
        // Neither spec nor implementation handle bitsets of maximal length.
        // See 4816253.
        if (fromIndex < 0)
            throw new UnexpectedValue("value of fromIndex", fromIndex.toString(), "non-negative number");

        this.checkInvariants();

        let u = BitSet.wordIndex(fromIndex);
        if (u >= this.wordsInUse)
            return fromIndex;

        let word = ~this.words[u]! & (BitSet.WORD_MASK << BigInt(fromIndex));

        while (true) {
            if (word != 0n)
                return (u * BitSet.BITS_PER_WORD) + numberOfTrailingZeros(word);
            if (++u == this.wordsInUse)
                return this.wordsInUse * BitSet.BITS_PER_WORD;
            word = ~this.words[u]!;
        }
    }

    public length() {
        if (this.wordsInUse == 0)
            return 0;

        return BitSet.BITS_PER_WORD * (this.wordsInUse - 1) +
            (BitSet.BITS_PER_WORD - numberOfLeadingZeros(this.words[this.wordsInUse - 1]!));
    }

    public isEmpty() {
        return this.wordsInUse == 0;
    }
}

export default BitSet;