#!/usr/bin/env -S deno run --allow-read

//  (c) 2023-2024, 384 (tm) Inc.

import { arrayBufferToBase62, base62ToArrayBuffer } from "../dist/384.esm.js"

// import { assert } from "@std/assert";
import { assert } from "@std/assert";


import { generateRandomArrayBuffer, compareArrayBuffers } from "./test.utils.ts";

const DBG0 = false


function generateRandomBufferSize() {
    // must be multiple of 32 bits
    return Math.floor(Math.random() * 32) * 4;
}

// Test the arrayBufferToBase62 function with random inputs
const GENERATE_TEST_CASES = false; // set to true to also output test cases to console
function testarrayBufferToBase62(numTests: number) {
    let testsPassed = 0;
    if (GENERATE_TEST_CASES) console.log("export const testCases = [");
    for (let i = 0; i < numTests; i++) {
        const n = generateRandomBufferSize();
        const buffer = generateRandomArrayBuffer(n);
        const base62String = arrayBufferToBase62(buffer);
        if (DBG0) console.log("Test: array buffer becomes ('" + base62String + "')");
        if (GENERATE_TEST_CASES) console.log(`    { buffer: new Uint8Array([${new Uint8Array(buffer).toString()}]), base62: "${base62String}" },`);
        const newBuffer = base62ToArrayBuffer(base62String);
        if (compareArrayBuffers(buffer, newBuffer)) {
            if (DBG0) console.log(`Passing test ...`)
            testsPassed++;
        } else {
            console.warn(`testarrayBufferToBase62: Test ${i + 1} failed. Expected, but got`, buffer, newBuffer);
            assert(false, `testarrayBufferToBase62: Test ${i + 1} failed.`)
        }
    }
    if (GENERATE_TEST_CASES) console.log("];");
    console.log(`// testarrayBufferToBase62: ${testsPassed} out of ${numTests} tests passed.`);
}

function runTests(reps: number) {
    // deterministic:
    // runTestCasesFromFile("./set.01.ts")
    // random (each time):
    testarrayBufferToBase62(reps);
}


Deno.test("[fast] basic SB384 tests", async () => {
    runTests(400);
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    runTests(5000);
}
