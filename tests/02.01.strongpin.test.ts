#!/usr/bin/env -S deno run --allow-read

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
import {
    base32mi, generateStrongPin, generateStrongPin16, generateStrongPinNN,
    processStrongPin as process, encodeStrongPin as encode, decodeStrongPin as decode,
} from '../src/sbCrypto/strongpin.ts';

// import { assertThrows, assertRejects } from "../../deno_std/assert/mod.ts";
import { assertThrows, assertRejects } from "@std/assert";

// ====================================================
// TEST FUNCTIONS 
// ====================================================

const base62Regex = new RegExp(`^[${base32mi}]{4}$`);

// returns string if parity is correct, otherwise null
function checkParity(encoded: string): string | null {
    if (!base62Regex.test(encoded))
        throw new Error(`Input string contains invalid characters (${encoded}).`);
    // Convert each character into 5-bit binary data
    let binaryData = Array.from(encoded).map(c => {
        return base32mi.indexOf(c).toString(2).padStart(5, "0");
    });
    if (binaryData.map(bitString => Number(bitString[0])).reduce((a, b) => a ^ b)) {
        return null;
    } else {
        return encoded;
    }
}

// function testEncodeBase62(numTest: number = 5) {
//     for (let i = 0; i < numTest; i++) {
//         const { num, encoded } = generateRandomStrongpin();
//         console.log(
//             '0x' + num.toString(16),
//             "=>", num.toString(2).padStart(19, '0'),
//             '=>', encoded,
//             '=>', checkParity(encoded) ? `correct: ${'0x' + decode(encoded)!.toString(16)}` : 'invalid parity (that is ok)');
//     }
// }

// generates a random alphanumeric string
function generateRandomString(length: number = 4): string {
    const charMap = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charMap[Math.floor(Math.random() * charMap.length)];
    }
    return result;
}

function generateRandom19bits() {
    const array = new Uint32Array(1);
    globalThis.crypto.getRandomValues(array);
    return array[0] & 0x7FFFF; // xor in entropy, extract 19 bits
}

// generate random four-character (A-Z, a-z, 0-9) strings and process them
// the random strings should be from the full set of 62 characters:
// "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
function testProcessInput(numTest: number = 8) {
    for (let i = 0; i < numTest; i++) {
        const str = generateRandomString(4);
        const processedString = process(str);
        console.log(
            str,
            '=>', processedString,
            '=>', checkParity(processedString) ? 'invalid parity (which is fine)' : 'happens to be correct');
    }
}

function generateRandomK(K: number): number {
    return Math.floor(Math.random() * K);
}

// for every randomized pin, picks a random char and injects substition error
async function singleSubstitutionError(numTests: number = 8): Promise<boolean> {
    let anyFailures: boolean = false;
    const substitutions: { [key: string]: Array<string> } = {
        // error model
        '0': ['o', 'O'],
        '1': ['i', 'I', 'l'],
        '2': ['z', 'Z'],
        '5': ['s', 'S'],
        '6': ['b', 'G'],
        '9': ['a', 'g', 'q'],
        'c': ['C'],
        'f': ['F'],
        'j': ['J'],
        'k': ['K'],
        'p': ['P'],
        'u': ['U', 'v', 'V'],
        'w': ['W'],
        'x': ['X'],
        'E': ['e'],
        'M': ['m'],
        'N': ['n', 'h'],
        'T': ['t'],
        'Y': ['y'],
    };
    let count = 0;
    while (count < numTests) {
        let num = generateRandom19bits();
        let str = encode(num);
        let index = generateRandomK(4);
        let char = str.charAt(index);
        if (substitutions[char]) {
            let newChar = substitutions[char][generateRandomK(substitutions[char].length)];
            let damaged = str.slice(0, index) + newChar + str.slice(index + 1);
            let corrected = process(damaged);
            let decoded = decode(corrected);
            let passOrFail = decoded == num ? "PASS" : "FAIL";
            anyFailures ||= passOrFail == "FAIL";
            console.log(`Original: ${'0x' + num.toString(16)} => ${str} => Damaged: ${damaged} => Corrected: ${corrected} => Decoded: ${decoded ? '0x' + decoded.toString(16) : '<fail>'}, Test: ${passOrFail}`);
            count++;
        } else {
            // doesn't count, pick another random string and char
        }
    }
    if (anyFailures) console.log("****** Some substituion model tests failed *******")
    return anyFailures;
}

// injects two substitution errors and checks that parity catches problem
async function testParityModel(numTests: number = 8): Promise<boolean> {
    let anyFailures: boolean = false;
    const substitutions: { [key: string]: string } = {
        // parity pairs:
        // 0123456789ADMRTx
        // QjrEywcLBdHpNufk
        // we include all with a few exceptions, that are unambiguous
        '0': 'Q',
        '1': 'j',
        '2': 'r',
        '3': 'E',
        '4': 'y',
        // '5': 'w',
        '6': 'c',
        '7': 'L',
        '8': 'B',
        '9': 'd',
        'A': 'H',
        'D': 'p',
        'M': 'N',
        // 'R': 'u',
        'T': 'f',
        'x': 'k',
        'Q': '0',
        'j': '1',
        'r': '2',
        'E': '3',
        'y': '4',
        // 'w': '5',
        'c': '6',
        'L': '7',
        'B': '8',
        'd': '9',
        'H': 'A',
        'p': 'D',
        'N': 'M',
        // 'u': 'R',
        'f': 'T',
        'k': 'x',
    }

    let count = 0;
    while (count < numTests) {
        let num = generateRandom19bits();
        let str = encode(num);
        let index = generateRandomK(4);
        let char = str.charAt(index);
        if (substitutions[char]) {
            let newChar = substitutions[char][generateRandomK(substitutions[char].length)];
            let damaged = str.slice(0, index) + newChar + str.slice(index + 1);
            let decoded = decode(damaged);
            let passOrFail = decoded == null ? "PASS" : "FAIL"; // 'null' means it was caught
            anyFailures ||= passOrFail == "FAIL";
            console.log(`Original: ${'0x' + num.toString(16)} => ${str} => Damaged: ${damaged} => Decoded: ${decoded ? '0x' + decoded.toString(16) : '<fail>'}, Test: ${passOrFail}`);
            count++;
        } else {
            // doesn't count, pick another random string and char
        }
    }
    if (anyFailures) console.log("****** Some parity model tests failed *******")
    return anyFailures;
}

Deno.test("[fast] strongpin generation - encode - decode", async () => {
    console.log('\n===================== 02 START strongpin test =====================')
    console.log("\nPre-processing examples:")
    testProcessInput(8);
    console.log("\nSubstition error tests:")
    if (await singleSubstitutionError(64))
        throw new Error("Some strongpin substition model tests failed.");
    console.log("\nParity model tests:")
    if (await testParityModel(64))
        throw new Error("Some strongpin parity model tests failed.");
    console.log('===================== 02 END strongpin tests =====================')

});


Deno.test("[fast] strongpin - various invalid uses. These should throw errors", async () => {
    // encode with negative number of greater than 19 bits
    assertThrows(() => encode(-1), Error, "Input number is out of range");
    assertThrows(() => encode(524288), Error, "Input number is out of range");

    // decode with invalid string
    assertThrows(() => decode("$$$$"), Error, "invalid characters");
});

Deno.test("[fast] strongpin - generateStrongPinNN", async () => {
    var pin = await generateStrongPinNN({ setCount: 12});
    console.log("Generated strongpin (12 sets):", pin);
    pin = await generateStrongPinNN();
    console.log("Generated strongpin with no options:", pin);
    pin = await generateStrongPinNN({ enforceMix: true });
    console.log("Generated strongpin with enforceMix:", pin);
    pin = await generateStrongPinNN({ enforceMix: true, setCount: 12 });
    console.log("Generated strongpin with enforceMix and setCount:", pin);
    var pin = await generateStrongPinNN({ setCount: null! });
    console.log("Generated strongpin with null setCount:", pin);
    var pin = await generateStrongPinNN({ setCount: 12, extraEntropy: "foobar"});
    console.log("Generated strongpin with extraEntropy:", pin);
    await assertRejects(() => {
        return generateStrongPinNN({ setCount: 99 })
    });
});
    
Deno.test("[fast] strongpin - generateStrongPin", async () => {
    const pin = await generateStrongPin();
    console.log("Generated strongpin:", pin);
});

Deno.test("[fast] strongpin - generateStrongPin16", async () => {
    const pin = await generateStrongPin16();
    console.log("Generated strongpin16:", pin);
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    console.log("Stand-alone strongpin test only does a few things ....")
    console.log(await generateStrongPin16())
    console.log(await generateStrongPin())
    console.log(await generateStrongPinNN())
    console.log(await generateStrongPinNN({ enforceMix: true }))
    console.log(await generateStrongPinNN({ enforceMix: true, setCount: 12 }))
}
