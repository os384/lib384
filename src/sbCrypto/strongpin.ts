/*
 * Copyright (C) 2019-2021 Magnusson Institute
 * Copyright (C) 2022-2026 384, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
export const strongpinVersion = "0.8.0";

// export const base32mi05 = "012345ABCDMPQRTVXJrEYWH8GLN7dkfu" // "v05.02"
// export const base32mi05 = "0123456789ADMQRTXJrEYWCPBdHLNukf" // "v05.03"
// export const base32mi05 = "0123456789ADMRTXQjrEyWCLBdHpNufk" // "v05.04" (strongpinVersion 0.5.6)

export const base32mi05 = "0123456789ADMRTxQjrEywcLBdHpNufk" // "v05.05" (strongpinVersion ^0.6.0)

/**
 * v05.05 (strongpinVersion ^0.6.0)
 * 
 * In parity-pair order:
 * 
 * 0123456789ADMRTx
 * QjrEywcLBdHpNufk
 * 
 * Note: in ascii order:
 * 
 * 0123456789
 * ABDEHLMNQRT
 * cdfjkpruwxy
 * 
 * (Current base32mi 'v05.05')
 * 
 * @public
 */
export const base32mi = base32mi05;

// const strictBase62Regex = new RegExp(`^[${base62}]{4}$`); // strict, in case we want to do that
const base62Regex = new RegExp(`[${base32mi}.concat(' ')]`); // lenient, allows spaces

/** @public */
export type StrongPinOptions = { extraEntropy?: string, enforceMix?: boolean, setCount?: number }

/**
 * encodes a 19-bit number into a 4-character string
 * @public
 * */
export function encodeStrongPin(num: number): string {
    const charMap = base32mi;
    if (num < 0 || num > 0x7ffff)
        throw new Error('Input number is out of range. Expected a 19-bit integer.');
    let bitsArr15 = [
        (num >> 14) & 0x1f,
        (num >> 9) & 0x1f,
        (num >> 4) & 0x1f,
        (num) & 0x0f
    ];
    bitsArr15[3] |= (bitsArr15[0] ^ bitsArr15[1] ^ bitsArr15[2]) & 0x10;
    return bitsArr15.map(val => charMap[val]).join('');
}

// generates a single 4-character set, does NOT enforce mix
async function _generateStrongPin(options?: StrongPinOptions): Promise<string> {
    const { extraEntropy } = options || {}
    let num, encoded;
    const hashArray = extraEntropy
    ? new Uint32Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(extraEntropy)))
    : new Uint32Array([0]); // set to zero so has no effect
    const array = new Uint32Array(1);
    globalThis.crypto.getRandomValues(array);
    num = (array[0] ^ hashArray[0]) & 0x7FFFF; // xor in entropy, extract 19 bits
    encoded = encodeStrongPin(num);
    return encoded;
}

/**
 * Generates a strongpin with "setCount" sets of 4-characters each.
 * (19 bits of entropy per set) in string format.
 * 
 * Options:
 *  extraEntropy: string,
 *  enforceMix: boolean,
 *  setCount: number
 * 
 * ''enforceMix'' is a boolean that, if true, will ensure that the
 * generated strongpin has at least one of each: number, lowercase,
 * uppercase. With a single set, this will frequently cost one
 * or even two bits of entropy; with two sets, it will occasionally
 * cost one bit; with three sets, it will rarely cost one bit.
 * With four sets (the 'secure' setting), you lose less than
 * 1/100 of one bit of entropy (out of 76).
 * @public
 * 
 */
export async function generateStrongPinNN(options?: StrongPinOptions): Promise<string> {
    let { enforceMix, setCount } = options || {}
    let res, i = 0
    if (!setCount) setCount = 1
    if (setCount < 1 || setCount > 40)
        // we can handle any length but if it's too long, it's probably a mistake
        throw new Error('setCount must be between 1 and 40 (upper limit is arbitrary).')

    // if "enforceMix" is true, then we iterate to ensure that the generated
    // strongpin has at least one of each: number, lowercase, uppercase
    do {
        res = (await Promise.all(Array(setCount).fill(null)
            .map(() => _generateStrongPin(options))))
            .join(' ');

        // LCOV_EXCL_START
        if (++i > 32) throw new Error('Unable to generate a strongpin16 after 32 attempts (should never happen even with singleton sets).'); // LCOV_EXCL_LINE
        // LCOV_EXCL_STOP

    } while ((enforceMix) && (!(/[0-9]/.test(res) && /[a-z]/.test(res) && /[A-Z]/.test(res))));
    return res;
}

/**
 * Generates a strongpin with A SINGLE set of 4-characters.
 * (19 bits of entropy).
 * 
 *  Convenience function.
 * @public
 */
export async function generateStrongPin(options?: StrongPinOptions): Promise<string> {
    let options2 = { ...options, setCount: 1 } as StrongPinOptions
    return generateStrongPinNN(options2)
}

/**
 * generateStrongPin16()
 * 
 * Generates a strongpin with 4 sets of 4-characters each.
 * (19 bits of entropy per set, 76 bits total).
 * 
 * Convenience function.
 * @public
 */
export async function generateStrongPin16(options?: StrongPinOptions): Promise<string> {
    let options2 = { ...options, setCount: 4 } as StrongPinOptions
    return generateStrongPinNN(options2)
}


/**
 * does a "pre-processing", if there are substitions to be suggested,
 * it will perform them.  the callee should check if the returned
 * string has changed, in which case you should confirm with the user
 * something like 'did you mean to type this?'.  if the returned
 * string is the same as the input string, then there are no
 * substitutions to be made (unamgibuous).
 * 
 * The callee should enforce input matches ''/^[a-zA-Z0-9]*$/''.
 * @public
 */
export function processStrongPin(str: string): string {
    const substitutions: { [key: string]: string } = {
        // deliberately overly clear mapping
        "o": "0", "O": "0", "i": "1", "I": "1",
        "l": "1", "z": "2", "Z": "2", "s": "5",
        "S": "5", "b": "6", "G": "6", "a": "9",
        "g": "9", "q": "9", "m": "M", "t": "T",
        "X": "x", "J": "j", "e": "E", "Y": "y",
        "W": "w", "C": "c", "P": "p", "n": "N",
        "h": "N", "U": "u", "v": "u", "V": "u",
        "F": "f", "K": "k"
    }
    let processedStr = '';
    for (let char of str)
        processedStr += substitutions[char] || char;
    return processedStr;
}

/**
    will take a (correctly formed) 4-character string and return the
    original 19-bit number.  if the parity is incorrect, it will
    return null, meaning, one of the four characters were typed in
    incorrectly - for example, an "8" was entered that should be a "B".
    the callee should check for null and ask the user something like
    'are you sure about these four characters?'.
    @public
 */
export function decodeStrongPin(encoded: string): number | null {
    if (!base62Regex.test(encoded))
        throw new Error(`Input string contains invalid characters (${encoded}) - use 'process()'.`);
    let bin = Array.from(encoded)
        .map(c => base32mi.indexOf(c))
    if (bin.reduce((a, b) => (a ^ b)) & 0x10)
        return null;
    return (((bin[0] * 32 + bin[1]) * 32 + bin[2]) * 16 + (bin[3] & 0x0f));
}
