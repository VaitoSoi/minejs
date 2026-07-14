import { createHash } from "node:crypto";

export const Epsilon = 1.0e-7; // 1^-7

export function computeUUID(playerName: string): Buffer {
    const md5 = createHash("md5").update(playerName).digest();
    md5[6]! &= 0x0f;  /* clear version        */
    md5[6]! |= 0x30;  /* set to version 3     */
    md5[8]! &= 0x3f;  /* clear variant        */
    md5[8]! |= 0x80;  /* set to IETF variant  */

    return md5;
}

export const minBigInt = (...args: bigint[]) => args.reduce((min, val) => val < min ? val : min);

export function mergeUnique<T = number>(arrA: T[], arrB: T[]): T[] {
    let i = 0, j = 0;
    const res: T[] = [];

    while (i < arrA.length && j < arrB.length) {
        if (arrA[i]! > arrB[j]!) {
            addUnique(arrB[j]!, res);
            j++;
        } else if (arrA[i]! < arrB[j]!) {
            addUnique(arrA[i]!, res);
            i++;
        } else {
            addUnique(arrA[i]!, res);
            i++;
            j++;
        }
    }

    for (; i < arrA.length; i++) addUnique(arrA[i]!, res);
    for (; j < arrB.length; j++) addUnique(arrB[j]!, res);

    return res;
}

function addUnique<T>(val: T, arr: T[]) {
    if (arr.at(-1) !== val)
        arr.push(val);
}

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