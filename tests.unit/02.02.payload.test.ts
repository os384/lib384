#!/usr/bin/env -S deno run --allow-net

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
import '../keys.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, assemblePayload, extractPayload } from "../dist/384.esm.js"

// import { assert } from "@std/assert";
import { assert } from "@std/assert";

let SB

// Pseudo-random number generator
var seed = 1;
function rnd(n: number) {
    var x = Math.sin(seed++) * 10000;
    return Math.floor((x - Math.floor(x)) * n);
}

function generateUglyString() {
    const chars = [
        '\u{1F4A9}', // Pile of Poo emoji (surrogate pair in UTF-16)
        '\u{263A}',  // Smiling Face (single code unit)
        '\u{1F1FA}\u{1F1F8}', // Flag for United States (combination of two regional indicator symbols, each represented by a surrogate pair)
        '\u{D834}\u{DD1E}', // A musical symbol (surrogate pair)
        '\u{202E}', // Right-to-left override (control character)
        'a',        // Simple ASCII character
        '\u{20AC}', // Euro sign
        '中',       // Chinese character
        '🇮🇳',     // Flag for India (surrogate pair)
        '𐍈'        // Gothic letter hwair (surrogate pair)
    ];
    return chars.join('');
}

// Recursive function to generate a random JavaScript object
function generateObject(depth: number) {
    if (depth === 0) {
        // Base case: return a primitive value
        switch (rnd(6)) {
            case 0: {
                switch (rnd(12)) {
                    case 0: return rnd(100); // small positive number
                    case 1: return rnd(2) ? Infinity : -Infinity; // Infinity
                    case 2: return rnd(2) ? NaN : -NaN; // NaN
                    case 3: return 0; // zero
                    case 4: return 1; // one
                    case 5: return -1; // negative one
                    case 6: return 0.5; // positive fraction
                    case 7: return -0.5; // negative fraction
                    case 8: return rnd(10000000000); // large positive number
                    case 9: return -rnd(10000000000); // large negative number
                    case 10: return rnd(10000000000) / 10000000000; // complex positive fraction
                    case 11: return -rnd(10000000000) / 10000000000; // complex negative fraction
                }
            }
            case 1: {
                switch (rnd(5)) {
                    // different strings
                    case 0: return generateUglyString();
                    case 1: return ''; // empty string
                    case 2: return `string${rnd(100)}`; // short string
                    case 3: return `string${rnd(100)} `.repeat(20); // long string
                    case 4: return ' '.repeat(rnd(20)); // string of spaces
                }
            }
            case 2: return Boolean(rnd(2)); // boolean
            case 3: return null; // null
            case 4: return undefined; // undefined
        }
    } else {
        // Recursive case: return a complex object
        switch (rnd(7)) {
            case 0: // object
                var obj: any = {};
                var numProps = rnd(6) + 1;
                for (var i = 0; i < numProps; i++) {
                    obj[`prop${i}`] = generateObject(depth - 1);
                }
                return obj;
            case 1: // array
                var arr = new Array(rnd(6) + 1);
                for (var i = 0; i < arr.length; i++) {
                    arr[i] = generateObject(depth - 1);
                }
                return arr;
            case 2: // map
                var map = new Map();
                var numEntries = rnd(6) + 1;
                for (var i = 0; i < numEntries; i++) {
                    map.set(`key${i}`, generateObject(depth - 1));
                }
                return map;
            case 3: // map with random objects as keys
                var map = new Map();
                var numEntries = rnd(6) + 1;
                for (var i = 0; i < numEntries; i++) {
                    map.set(generateObject(depth - 1), generateObject(depth - 1));
                }
                return map;
            case 4: // set
                var set = new Set();
                var numElements = rnd(6) + 1;
                for (var i = 0; i < numElements; i++) {
                    set.add(generateObject(depth - 1));
                }
                return set;
            case 5: // date
                return new Date(rnd(1000000000000));
            case 6: // Uint8Array
                var arr8 = new Uint8Array(rnd(32));
                for (var i = 0; i < arr8.length; i++) {
                    arr8[i] = rnd(256);
                }
                return arr8;
        }
    }
}

const s = "\n=============================================================================================\n"

function deepEquals(a: any, b: any) {
    if (typeof a !== typeof b) {
        console.error(s, "differs on TYPE\ntypeof a:\n", typeof a, "\ntypeof b:\n", typeof b,
        "\n(Object 'a'):\n", a, "\n(Object 'b'):\n", b, s)
        return false;
    }

    // actually there are other cases where a === b is false even though
    // they are the "same", but we'll ignore them until we run across them
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    
    // we check type before 'equality'
    if (a === b) return true;

    if (typeof a === 'object' && typeof b === 'object') { 
        
        if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
            for (let i = 0; i < a.length; i++) {
                if (!deepEquals(a[i], b[i])) {
                    console.error(s, ".. recursive deepEquals on two matching elements of an ARRAY fail ...", s)
                    return false;
                }
            }
            return true;
        }

        if (a instanceof Map && b instanceof Map && a.size === b.size) {
            // for (let [key, val] of a) {
            //     if (!b.has(key) || !deepEquals(val, b.get(key))) {
            //         console.error(s, "b.has(key):\n", b.has(key), "\ndeepEquals(val, b.get(key)):\n", deepEquals(val, b.get(key)), s)
            //         return false;
            //     }
            // }
            const aEntries = a.entries();
            const bEntries = b.entries();
            var aNext = aEntries.next();
            var bNext = bEntries.next();
            while (!aNext.done && !bNext.done) {
                const aEntry = aNext.value;
                const bEntry = bNext.value;
                if (!deepEquals(aEntry[0], bEntry[0])) {
                    console.log(s, "... recursive comparison of two matching KEYS of a MAP fail ...", s) 
                    return false;
                  }
                if (!deepEquals(aEntry[1], bEntry[1])) {
                    console.log(s, "... recursive comparison of two matching VALUES of a MAP fail ...", s)
                    return false
                }
                aNext = aEntries.next();
                bNext = bEntries.next();
            }
            if (aNext.done !== bNext.done) {
                console.error(s, "Inconsistent end conditinos in Map comparison.\naNext.done:\n", aNext.done, "\nbNext.done:\n", bNext.done, s)
                return false;
            }
            return true;
        }

        if (a instanceof Set && b instanceof Set && a.size === b.size) {
            const aEntries = a.entries();
            const bEntries = b.entries();
            var aNext = aEntries.next();
            var bNext = bEntries.next();
            while (!aNext.done && !bNext.done) {
                if (!deepEquals(aNext.value, bNext.value)) {
                    console.error(s, "... recursive deepEquals on two matching entries of a SET fail ...", s)
                    return false;
                }
                aNext = aEntries.next();
                bNext = bEntries.next();
            }
            if (aNext.done !== bNext.done) {
                console.error(s, "aNext.done:\n", aNext.done, "\nbNext.done:\n", bNext.done, s)
                return false;
            }
            return true;
        }

        if (a instanceof Date && b instanceof Date) {
            const result = a.getTime() === b.getTime();
            if (!result) {
                console.log(s, "b instanceof Date:\n", b instanceof Date, "\na.getTime():\n", a.getTime(), "\nb.getTime():\n", b.getTime(), s)
            }
            return result;
        }

        // it's some generic object so we go through it
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) {
            console.error(s, "aKeys.length:\n", aKeys.length, "bKeys.length:\n", bKeys.length, s)
            return false;
        }

        for (let key of aKeys) {
            if (!b.hasOwnProperty(key) || !deepEquals(a[key], b[key])) {
                console.error(s, "!b.hasOwnProperty(key):\n", !b.hasOwnProperty(key), "!deepEquals(a[key], b[key]):\n", !deepEquals(a[key], b[key]), s)
                return false;
            }
        }

        return true;
    }

    console.log(s, "a:\n", a, "b:\n", b, s)
    return false;
}


// Test function to generate, serialize, deserialize, and verify objects
function testSerialization(TEST_COUNT: number = 500) {
    var anyFailed = false;
    console.log(`Running ${TEST_COUNT} tests...`)

    var randomObject: any

    for (var i = 0; i < TEST_COUNT; i++) {
        randomObject = generateObject(rnd(5)); // depths 0-4

        // console.log("Testing with object:", randomObject)

        var serialized = assemblePayload(randomObject);
        var deserialized = extractPayload(serialized!).payload;

        // Compare randomObject and deserialized
        if (!deepEquals(randomObject, deserialized)) {
            console.error(
                'Test failed, original / recovered:\n',
                '============================= ORIGINAL  ================================================================\n',
                randomObject, '\n',
                '============================= RECOVERED ================================================================\n',
                deserialized, '\n',
                '=============================================================================================\n',
            );
            anyFailed = true;
            break;
        }
    }
    
    if (anyFailed) console.log(`After ${i} tests passed, a test failed, stopped.\nNOTE: it's recurseive so look for the FIRST reported difference above.`)
    else {
        console.log(
            'Last object we tested with:\n',
            '============================= ORIGINAL  ================================================================\n',
            randomObject, '\n',
            '========================================================================================================\n',
        )
        console.log(`All ${TEST_COUNT} tests passed`);
    }
    if (anyFailed) assert(false, "testSerialization() failed")
}

Deno.test({
    name: "[fast] 02.02 - payload / serialization tests",
    // todo: deno complains about timers not being cleared out properly
    sanitizeOps: false,  // Ignores unfinished async operations
    sanitizeResources: false,  // Ignores open resources like WebSockets
    async fn() {
        SB = new ChannelApi(configuration.channelServer, configuration.DBG) // set debug level
        console.log('\n===================== 02.02 START payload / serialization tests =====================')
        testSerialization();
        await ChannelApi.closeAll()
        console.log('\n===================== 02.02 END payload / serialization tests   =====================')
        }
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    SB = new ChannelApi(configuration.channelServer, configuration.DBG) // set debug level
    // from the command line we stress more
    testSerialization(9707);
    await ChannelApi.closeAll()
}
