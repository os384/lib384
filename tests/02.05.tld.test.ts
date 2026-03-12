#!/usr/bin/env -S deno run

//  (c) 2023-2024, 384 (tm) Inc.

const DBG0 = false;

import { assert } from "@std/assert";
import { getDomainDetails } from "../src/boot/tld.ts";

interface TestCase {
    input: string;
    expected: {
        baseDomain: string | null;
        subdomain: string | null;
    };
}

const testCases: TestCase[] = [
    { input: "", expected: { baseDomain: null, subdomain: null } },
    { input: (null as unknown as string), expected: { baseDomain: null, subdomain: null } },
    { input: "example.com", expected: { baseDomain: "example.com", subdomain: null } },
    { input: "subdomain.example.net", expected: { baseDomain: "example.net", subdomain: "subdomain" } },
    { input: "deep.subdomain.example.org", expected: { baseDomain: "example.org", subdomain: "deep.subdomain" } },
    { input: "example.co.uk", expected: { baseDomain: "example.co.uk", subdomain: null } },
    { input: "subdomain.example.co.uk", expected: { baseDomain: "example.co.uk", subdomain: "subdomain" } },
    { input: "localhost", expected: { baseDomain: "localhost", subdomain: null } },
    { input: "xyz.localhost", expected: { baseDomain: "localhost", subdomain: "xyz" } },
    { input: "192.168.1.1", expected: { baseDomain: "192.168.1.1", subdomain: null } },
    { input: "server.168.1.1", expected: { baseDomain: null, subdomain: null } },
    { input: "subdomain.192.168.1.1", expected: { baseDomain: "192.168.1.1", subdomain: "subdomain" } },
    { input: "s1.s2.192.168.1.1", expected: { baseDomain: "192.168.1.1", subdomain: "s1.s2" } },
    { input: "example.me", expected: { baseDomain: "example.me", subdomain: null } },
    { input: "subdomain.example.me", expected: { baseDomain: "example.me", subdomain: "subdomain" } },
    { input: "example.xyz", expected: { baseDomain: null, subdomain: null } },
    { input: "subdomain.example.xyz", expected: { baseDomain: null, subdomain: null } },
    { input: "a.b.c.example.com", expected: { baseDomain: "example.com", subdomain: "a.b.c" } },
    { input: "uk", expected: { baseDomain: null, subdomain: null } }, // Second-level domain without a main domain
    { input: "co.uk", expected: { baseDomain: null, subdomain: null } }, // Second-level domain without a main domain
    { input: "example", expected: { baseDomain: null, subdomain: null } }, // Single word, no TLD
    { input: "example.invalidtld", expected: { baseDomain: null, subdomain: null } }, // Invalid TLD
    { input: "example.localhost", expected: { baseDomain: "localhost", subdomain: "example" } }, // Localhost with subdomain
    { input: "s1.s2.s3.localhost", expected: { baseDomain: "localhost", subdomain: "s1.s2.s3" } }, // Localhost with subdomain
    { input: "localhost.localhost.localhost", expected: { baseDomain: "localhost", subdomain: "localhost.localhost" } }, // Localhost with subdomain
];

function runTestCases(DBG = false) {
    let passed = 0, failed = 0;
    testCases.forEach((testCase, index) => {
        const { input, expected } = testCase;
        const result = getDomainDetails(input);
        // console.log("RESULT:", result)
        if (result.baseDomain !== expected.baseDomain || result.subdomain !== expected.subdomain) {
            console.error(`Test case ${index + 1} failed. Input: ${input}, Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(result)}`);
            failed += 1;
        } else {
            if (DBG0) console.log(`Test case ${index + 1} passed. Input: ${input}, Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(result)}`);
            passed += 1;
        }

        // if (!result) {
        //     console.error(`Test case ${index + 1} failed. Input: ${input}, Expected: ${JSON.stringify(expected)}, Got: ${result}`);
        // } else {
        //     console.assert(result.baseDomain === expected.baseDomain && result.subdomain === expected.subdomain, `Test case ${index + 1} failed. Input: ${input}, Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(result)}`);
        // }
    });
    console.log(`Test result: ${passed} passed, ${failed} failed`)
    assert(failed === 0, "Some TLD test cases failed")
}

Deno.test("[fast] basic SB384 tests", async () => {
    runTestCases(true);
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    runTestCases(true);
}

