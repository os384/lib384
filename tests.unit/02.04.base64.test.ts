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
import { arrayBufferToBase64url, base64ToArrayBuffer } from "../dist/384.esm.js";
import { assert } from "@std/assert";
import { generateRandomArrayBuffer, compareArrayBuffers, SEP } from "./test.utils.ts";

const DBG0 = false;

function generateRandomBufferSize(maxSize: number = 1024) {
    return Math.floor(Math.random() * (maxSize + 1));
}

function arrayBufferToBase64_ref3(buffer: ArrayBuffer): string {
    return window.btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer_ref3(base64: string): ArrayBuffer {
    return Uint8Array.from(window.atob(base64), c => c.charCodeAt(0)).buffer;
}

function base64ToArrayBuffer_ref2(s: string): Uint8Array {
    try {
      s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
      s += '=='.slice(0, (4 - s.length % 4) % 4);
      if (!b64Regex.test(s)) throw new Error(`invalid character in b64 string (after cleanup: '${s}')`)
      return Uint8Array.from(window.atob(s), c => c.charCodeAt(0));
    } catch (e) {
      if (DBG0) console.error(SEP, SEP, `base64ToArrayBuffer() error: ${e}\n`, s);
      throw new Error(`base64ToArrayBuffer() error: ${e}`);
    }
  }
  


//#region Base64 encoding/decoding baseline
/*
  we use URI/URL 'safe' characters in our b64 encoding to avoid having
  to perform URI encoding, which also avoids issues with composed URI
  strings (such as when copy-pasting). however, that means we break
  code that tries to use 'regular' atob(), because it's not as forgiving.
  this is also referred to as RFC4648 (section 5). note also that when
  we generate GUID from public keys, we iterate hashing until '-' and '_'
  are not present in the hash, which does reduce entropy by about three
  (3) bits (out of 384).

  For possible future use:
  RFC 3986 (updates 1738 and obsoletes 1808, 2396, and 2732)
  type ALPHA = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z'
  type alpha = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
  type digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  type genDelims = ':' | '/' | '?' | '#' | '[' | ']' | '@'
  type subDelims = '!' | '$' | '&' | "'" | '(' | ')' | '*' | '+' | ',' | ';' | '='
  type unReserved = ALPHA | alpha | digit | '-' | '.' | '_' | '~'
*/

/**
 * based on https://github.com/qwtel/base64-encoding/blob/master/base64-js.ts
 */
const b64lookup: string[] = []
const urlLookup: string[] = []
const revLookup: number[] = []
const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const CODE_B64 = CODE + '+/'
const CODE_URL = CODE + '-_'
const PAD = '='
const MAX_CHUNK_LENGTH = 16383 // must be multiple of 3
for (let i = 0, len = CODE_B64.length; i < len; ++i) {
  b64lookup[i] = CODE_B64[i]
  urlLookup[i] = CODE_URL[i]
  revLookup[CODE_B64.charCodeAt(i)] = i
}
revLookup['-'.charCodeAt(0)] = 62 // minus
revLookup['_'.charCodeAt(0)] = 63 // underscore

function getLens(b64: string) {
  const len = b64.length
  let validLen = b64.indexOf(PAD)
  if (validLen === -1) validLen = len
  const placeHoldersLen = validLen === len ? 0 : 4 - (validLen % 4)
  return [validLen, placeHoldersLen]
}

function _byteLength(validLen: number, placeHoldersLen: number) {
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen;
}


const b64Regex = /^([A-Za-z0-9+/]*)(={0,2})$/ // strict (ish)

/**
 * Standardized 'atob()' function, e.g. takes the a Base64 encoded
 * input and decodes it. Note: always returns Uint8Array.
 * Accepts both regular Base64 and the URL-friendly variant,
 * where `+` => `-`, `/` => `_`, and the padding character is omitted.
 */
function base64ToArrayBuffer_ref(str: string): Uint8Array {
  if (!b64Regex.test(str)) throw new Error(`invalid character in string '${str}'`)
  let tmp: number
  switch (str.length % 4) {
    case 2: str += '=='; break;
    case 3: str += '='; break;
  }
  const [validLen, placeHoldersLen] = getLens(str);
  const arr = new Uint8Array(_byteLength(validLen, placeHoldersLen));
  let curByte = 0;
  const len = placeHoldersLen > 0 ? validLen - 4 : validLen;
  let i: number;
  for (i = 0; i < len; i += 4) {
    const r0: number = revLookup[str.charCodeAt(i)];
    const r1: number = revLookup[str.charCodeAt(i + 1)];
    const r2: number = revLookup[str.charCodeAt(i + 2)];
    const r3: number = revLookup[str.charCodeAt(i + 3)];
    tmp = (r0 << 18) | (r1 << 12) | (r2 << 6) | (r3);
    arr[curByte++] = (tmp >> 16) & 0xff;
    arr[curByte++] = (tmp >> 8) & 0xff;
    arr[curByte++] = (tmp) & 0xff;
  }
  if (placeHoldersLen === 2) {
    const r0 = revLookup[str.charCodeAt(i)];
    const r1 = revLookup[str.charCodeAt(i + 1)];
    tmp = (r0 << 2) | (r1 >> 4);
    arr[curByte++] = tmp & 0xff;
  }
  if (placeHoldersLen === 1) {
    const r0 = revLookup[str.charCodeAt(i)];
    const r1 = revLookup[str.charCodeAt(i + 1)];
    const r2 = revLookup[str.charCodeAt(i + 2)];
    tmp = (r0 << 10) | (r1 << 4) | (r2 >> 2);
    arr[curByte++] = (tmp >> 8) & 0xff;
    arr[curByte++] = tmp & 0xff;
  }
  return arr;
}

function tripletToBase64(lookup: string[], num: number) {
  return (
    lookup[num >> 18 & 0x3f] +
    lookup[num >> 12 & 0x3f] +
    lookup[num >> 6 & 0x3f] +
    lookup[num & 0x3f]
  );
}

function encodeChunk(lookup: string[], view: DataView, start: number, end: number) {
  let tmp: number;
  const output = new Array((end - start) / 3);
  for (let i = start, j = 0; i < end; i += 3, j++) {
    tmp =
      ((view.getUint8(i) << 16) & 0xff0000) +
      ((view.getUint8(i + 1) << 8) & 0x00ff00) +
      (view.getUint8(i + 2) & 0x0000ff);
    output[j] = tripletToBase64(lookup, tmp);
  }
  return output.join('');
}

const bs2dv = (bs: BufferSource) => bs instanceof ArrayBuffer
  ? new DataView(bs)
  : new DataView(bs.buffer, bs.byteOffset, bs.byteLength)

/**
 * Standardized 'btoa()'-like function, e.g., takes a binary string
 * ('b') and returns a Base64 encoded version ('a' used to be short
 * for 'ascii'). Defaults to URL safe ('url') but can be overriden
 * to use standardized Base64 ('b64').
 */
function arrayBufferToBase64_ref(buffer: BufferSource | ArrayBuffer | Uint8Array | null, variant: 'b64' | 'url' = 'url'): string {
  if (buffer == null) {
    assert(false, 'arrayBufferToBase64() -> null paramater')
    return ''
  } else {
    const view = bs2dv(buffer)
    const len = view.byteLength
    const extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
    const len2 = len - extraBytes
    const parts = new Array(
      Math.floor(len2 / MAX_CHUNK_LENGTH) + Math.sign(extraBytes)
    )
    const lookup = variant == 'url' ? urlLookup : b64lookup
    const pad = ''
    let j = 0
    for (let i = 0; i < len2; i += MAX_CHUNK_LENGTH) {
      parts[j++] = encodeChunk(
        lookup,
        view,
        i,
        (i + MAX_CHUNK_LENGTH) > len2 ? len2 : (i + MAX_CHUNK_LENGTH),
      )
    }
    if (extraBytes === 1) {
      const tmp = view.getUint8(len - 1);
      parts[j] = (
        lookup[tmp >> 2] +
        lookup[(tmp << 4) & 0x3f] +
        pad + pad
      )
    } else if (extraBytes === 2) {
      const tmp = (view.getUint8(len - 2) << 8) + view.getUint8(len - 1)
      parts[j] = (
        lookup[tmp >> 10] +
        lookup[(tmp >> 4) & 0x3f] +
        lookup[(tmp << 2) & 0x3f] +
        pad
      );
    }
    return parts.join('')
  }
}

/**
 * Make sure base64 encoding is URL version
 */
function encodeB64Url(input: string) {
  return input.replaceAll('+', '-').replaceAll('/', '_');
}

/**
 * Convert base64 URL encoding to standard base64
 */
function decodeB64Url(input: string) {
  input = input.replaceAll('-', '+').replaceAll('_', '/');
  // Pad out with standard base64 required padding characters
  const pad: number = input.length % 4;
  if (pad) {
    assert(pad !== 1, 'InvalidLengthError: Input base64url string is the wrong length to determine padding');
    input += new Array(5 - pad).join('=');
  }
  return input;
}

//#endregion


// FOR POSSIBLE FUTURE REFERENCE, these are strict base64 (eg padding)
// function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
//   const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
//   let result = '';
//   for (let i = 0; i < bytes.length; i += 3) {
//     const [b1, b2 = 0, b3 = 0] = bytes.slice(i, i + 3);
//     result += base64[b1 >> 2] +
//       base64[((b1 & 0x03) << 4) | (b2 >> 4)] +
//       (i + 1 < bytes.length ? base64[((b2 & 0x0f) << 2) | (b3 >> 6)] : '=') +
//       (i + 2 < bytes.length ? base64[b3 & 0x3f] : '=');
//   }
//   return result;
// }
// function base64ToArrayBuffer(s: string): Uint8Array {
//   s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
//   s += '=='.slice(0, (4 - s.length % 4) % 4);
//   const b64Regex = /^([A-Za-z0-9+/]*)(={0,2})$/
//   if (!b64Regex.test(s)) throw new Error(`invalid character in b64 string (after cleanup: '${s}')`)
//   const len = s.length, pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
//   const bytes = new Uint8Array((len * 3 / 4) - pad);
//   for (let i = 0, p = 0; i < len; i += 4) {
//     const [a, b, c, d] = [s[i], s[i + 1], s[i + 2], s[i + 3]].map(ch => base64.indexOf(ch));
//     bytes[p++] = (a << 2) | (b >> 4);
//     if (c !== -1) bytes[p++] = ((b & 15) << 4) | (c >> 2);
//     if (d !== -1) bytes[p++] = ((c & 3) << 6) | d;
//   }
//   return bytes;
// }



function testArrayBufferToBase64(numTests: number = 500, maxSize: number = 1024) {
    let testsPassed = 0;
    for (let i = 0; i < numTests; i++) {
        const n = generateRandomBufferSize(maxSize);
        const buffer = generateRandomArrayBuffer(n);
        const base64String = arrayBufferToBase64url(buffer);
        if (DBG0) console.log("Test: array buffer becomes ('" + base64String + "')");
        // first test that the reference implementation has the same result
        try {
            const refBase64String = arrayBufferToBase64_ref(buffer);
            if (base64String !== refBase64String) {
                console.warn('\n', SEP, `testArrayBufferToBase64: Test ${i + 1} failed, does not match reference.\n`,
                `Expected:\n`, SEP,
                refBase64String, '\n', SEP,
                'but got:\n', SEP, base64String, '\n', SEP);
                assert(false, `testArrayBufferToBase64: Test ${i + 1} failed.`);
            }
        } catch (e) {
            // if it's a range error, then that's just hitting btoa limits (and that's not an error on our code)
            if (e instanceof RangeError) {
                console.warn(`testArrayBufferToBase64: Test ${i + 1}: reference implementation hit btoa limits, not an error.`);
            }
        }
        const newBuffer = base64ToArrayBuffer(base64String);
        if (compareArrayBuffers(buffer, newBuffer)) {
            testsPassed++;
            // not much point using the reference implementation here
        } else {
            console.warn(`testArrayBufferToBase64: Test ${i + 1} failed. Expected, but got`, buffer, newBuffer);
            assert(false, `testArrayBufferToBase64: Test ${i + 1} failed.`)
        }
    }
    console.log(`// testArrayBufferToBase64: ${testsPassed} out of ${numTests} tests passed (size was ${maxSize}).`);
}



function runTests(reps: number, size: number) {
    testArrayBufferToBase64(reps, size);
}

// Manual test cases
const manualTestCases = [
    {
        description: "Empty ArrayBuffer",
        buffer: new ArrayBuffer(0),
        expectedBase64: "",
    },
    {
        description: "Non-standard characters in Base64 string",
        base64: "aGVsb#%G8hQCM=",
        expectedError: true,
    },

];

function runManualTests() {
    manualTestCases.forEach(testCase => {
        if (testCase.buffer) {
            const base64 = arrayBufferToBase64url(testCase.buffer);
            assert(base64 === testCase.expectedBase64, `Failed: ${testCase.description}`);
        } else if (testCase.base64) {
            try {
                base64ToArrayBuffer(testCase.base64);
                if (testCase.expectedError) {
                    console.error(`Expected error but none was thrown: ${testCase.description}`);
                    assert(false);
                } else {
                    // Additional checks can be performed here if needed
                }
            } catch (e) {
                if (!testCase.expectedError) {
                    console.error(`Unexpected error for ${testCase.description}: ${e}`);
                    assert(false);
                }
            }
        }
    });
}

Deno.test("[fast] basic Base64 tests", async () => {
    runTests(100, 1000);
    runManualTests();
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    runTests(10, 50);
    runTests(10000, 1000);
    runTests(50, 100000);
    // // runTests(4, 1000000); // our 'reserve' implementation can handle this, but not btoa
    // runManualTests();
}
