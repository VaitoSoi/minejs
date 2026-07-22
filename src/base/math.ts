import { createHash } from "node:crypto";

/** @hidden */
export const Epsilon = 1.0e-7; // 1^-7

/**
 * Convert player name into UUID
 * 
 * Use for offline account
 * 
 * @hidden
 */
export function computeUUID(playerName: string): Buffer {
    const md5 = createHash("md5").update(playerName).digest();
    md5[6]! &= 0x0f;  /* clear version        */
    md5[6]! |= 0x30;  /* set to version 3     */
    md5[8]! &= 0x3f;  /* clear variant        */
    md5[8]! |= 0x80;  /* set to IETF variant  */

    return md5;
}

/** @hidden */
export const minBigInt = (...args: bigint[]) => args.reduce((min, val) => val < min ? val : min);

/** @hidden */
export function lowerBoundBinarySearch(from: number, to: number, condition: (index: number) => boolean) {
    let i = to - from;
    while (true) {
        const len = i;
        if (len > 0) {
            const half = Math.floor(len / 2);
            const middle = from + half;
            if (condition(middle)) {
                i = half;
            } else {
                from = middle + 1;
                i = len - (half + 1);
            }
        } else {
            return from;
        }
    }
}

/** @hidden */
export const equal = (a: number, b: number) => Math.abs(a - b) < Epsilon;

/** @hidden */
export const lerp = (factor: number, min: number, max: number) => min + (max - min) * factor;

/** @hidden */
export const getSign = (a: number) => a === 0 ? 0 : a > 0 ? 1 : -1;

/** @hidden */
export const getFrac = (a: number) => a - Math.floor(a);

/** @hidden */
export function clamp(a: number, min: number, max: number) {
    if (a < min) return min;
    if (a > max) return max;
    return a;
}