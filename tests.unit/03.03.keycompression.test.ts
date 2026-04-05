#!/usr/bin/env -S deno run

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
import { SB384, base64ToArrayBuffer, arrayBufferToBase64url } from "../dist/384.esm.js"

import { assert } from "@std/assert";

// this test file also includes code that we've used to see what RFC
// standards the different browsers (and Deno) de facto support.
// TL;DR: only on Firefox do we know how to go from just private
// key ('d') to full key without 3rd party library; other environments 
// (Chromium/Edge/Chrome, Safari, Deno) do not allow an import of
// a PKCS#8 private key without the public key, presumably they
// follow RFC 5915 (https://tools.ietf.org/html/rfc5915) which
// states that implementations 'should' include the public key
// (though since it doesn't say 'must', arguably Firefox has
// the only correct implementation).

// We have a variant of this code in SB384, but we want to maintain
// bitcoin-compatible test code, since that makes it simple to
// add new tests and verify against other implementations.

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    if (modulus === 1n) return 0n;
    let result = 1n;
    base = base % modulus;
    while (exponent > 0n) {
        if (exponent % 2n === 1n)
            result = (result * base) % modulus;
        exponent = exponent >> 1n;
        base = (base * base) % modulus;
    }
    return result;
}

/**
 * Point decompress secp256k1 curve
 * 
 * Typescript version of the Python code Tim S shared on:
 * https://bitcointalk.org/index.php?topic=644919.msg7205689#msg7205689
 * and we test against the example he gave
 */
function ECPointDecompress(comp: string, Debug: boolean = false) {
    if (Debug) console.log("Input compressed key:\n", comp, "\n")

    // Consts for secp256k1 curve.  https://en.bitcoin.it/wiki/Secp256k1
    const prime = BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f'),
        pIdent = (prime + 1n) / 4n

    var signY = Number(comp[1]) - 2;
    var x = BigInt('0x' + comp.substring(2));
    var y = modPow(x * x * x + 7n, pIdent, prime)
    if (y % 2n !== BigInt(signY))
        y = prime - y;
    const xHex = x.toString(16).padStart(64, '0');
    const yHex = y.toString(16).padStart(64, '0');
    const ret = '04' + xHex + yHex;
    if (Debug) {
        console.log("\n", "Input\n", comp.substring(2), "\n", "xHex:\n", xHex, "\n", "yHex:\n", yHex, "\n");
        console.log("Output\n", ret, "\n");
    }
    return ret;
}

// secp256k1 uncompressed key
const refUncompressed = '0414fc03b8df87cd7b872996810db8458d61da8448e531569c8517b469a119d267be5645686309c6e6736dbd93940707cc9143d3cf29f1b877ff340e2cb2d259cf'

/**
 * secp384r1 version
 */
function ECPointDecompressP384(comp: string, Debug: boolean = false) {
    if (Debug) console.log("Input compressed key:\n", comp, "\n")

    // Consts for secp384r1 curve
    const prime = BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff'),
        b = BigInt('0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef'),
        pIdent = (prime + 1n) / 4n;

    var signY = Number(comp[1]) - 2;
    var x = BigInt('0x' + comp.substring(2));
    var y = modPow(x * x * x - 3n * x + b, pIdent, prime);
    if (y % 2n !== BigInt(signY))
        y = prime - y;
    const xHex = x.toString(16).padStart(96, '0');
    const yHex = y.toString(16).padStart(96, '0');
    const ret = '04' + xHex + yHex;
    if (Debug) {
        console.log("\n", "Input\n", comp.substring(2), "\n", "xHex:\n", xHex, "\n", "yHex:\n", yHex, "\n");
        console.log("Output\n", ret, "\n");
    }
    return ret;
}


function runTests01() {
    const pub = ECPointDecompress('0314fc03b8df87cd7b872996810db8458d61da8448e531569c8517b469a119d267', true)
    if (pub === refUncompressed) {
        console.log("Point decompress test passed")
    } else {
        console.log("Point decompress test failed")
        console.log("For the starting point key:", '0314fc03b8df87cd7b872996810db8458d61da8448e531569c8517b469a119d267')
        console.log("Expected:", refUncompressed)
        console.log("Got:", pub)
        throw new Error("Point decompress test failed")
    }
}

// 'conventional' compression format (hex)
function compressPoint(xBase64: string, yBase64: string) {
    // Convert base64 to Uint8Array
    const xBytes = new Uint8Array(base64ToArrayBuffer(xBase64));
    const yBytes = new Uint8Array(base64ToArrayBuffer(yBase64));

    // Convert x-coordinate to hex
    const xHex = Array.from(xBytes, byte => byte.toString(16).padStart(2, '0')).join('');

    // Determine prefix based on the parity of the last byte of y-coordinate
    const prefix = (yBytes[yBytes.length - 1] & 1) === 1 ? '03' : '02';

    // Return the compressed point
    return prefix + xHex;
}

async function runTests02() {
    const K = await new SB384().ready;
    console.log("JWK from new key K:")
    console.log(K.jwkPublic)
    console.log(K.userPublicKey)

    const pub = ECPointDecompressP384(compressPoint(K.jwkPublic.x!, K.jwkPublic.y!))
    console.log("pub:", pub)

    // now we take 'pub', ignore first two chars, split in two, and each hex half we convert to binary and then to base64
    const pubXhex = pub.substring(2, 96 + 2)
    console.log("pubXhex:", pubXhex)
    const pubXuint8 = new Uint8Array(pubXhex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    console.log("pubXuint8:", pubXuint8)
    const pubXbase64 = arrayBufferToBase64url(pubXuint8)
    console.log("pubXbase64:", pubXbase64)
    // now same for Y
    const pubYhex = pub.substring(96 + 2)
    console.log("pubYhex:", pubYhex)
    const pubYuint8 = new Uint8Array(pubYhex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    console.log("pubYuint8:", pubYuint8)
    const pubYbase64 = arrayBufferToBase64url(pubYuint8)
    console.log("pubYbase64:", pubYbase64)

    console.log(
        "\n",
        "At the end of the day, these should be the same:\n",
        "K.jwkPublic.x :", K.jwkPublic.x, "\n",
        "pubXbase64    :", pubXbase64, "\n",
        "K.jwkPublic.y :", K.jwkPublic.y, "\n",
        "pubYbase64    :", pubYbase64, "\n")
}

async function runTests03(rep: number = 100) {
    // essentially runTests02() but we do a bunch of repetitions
    for (let i = 0; i < rep; i++) {
        const K = await new SB384().ready;
        const pub = ECPointDecompressP384(compressPoint(K.jwkPublic.x!, K.jwkPublic.y!))

        const pubXhex = pub.substring(2, 96 + 2)
        const pubXuint8 = new Uint8Array(pubXhex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        const pubXbase64 = arrayBufferToBase64url(pubXuint8)

        const pubYhex = pub.substring(96 + 2)
        const pubYuint8 = new Uint8Array(pubYhex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        const pubYbase64 = arrayBufferToBase64url(pubYuint8)

        assert(K.jwkPublic.x === pubXbase64, "Compression failed: K.jwkPublic.x === pubXbase64")
        assert(K.jwkPublic.y === pubYbase64, "Compression failed: K.jwkPublic.y === pubYbase64")

        // console.log("Compression test", i, "passed", "\n", pubXbase64, "\n", pubYbase64)
    }
    console.log(`Compression test passed (${rep} repetitions)`)
}

function hexStringToArrayBuffer(hexString: string): ArrayBuffer {
    const bytes = new Uint8Array(hexString.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hexString.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes.buffer;
}

async function derivePublicKeyFromPrivateD(dHex: string): Promise<JsonWebKey> {
    // Convert D from hex to an ArrayBuffer
    const dArrayBuffer = hexStringToArrayBuffer(dHex);
    // Import the private key
    const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        dArrayBuffer,
        {
            name: 'ECDSA',
            namedCurve: 'P-384'
        },
        true,
        ['sign']
    );
    // Derive the public key
    const publicKey = await crypto.subtle.exportKey(
        'jwk',
        privateKey
    );
    return publicKey;
}


async function runTests04() {

    // const K = await new SB384().ready;

    const K = await new SB384({
        crv: "P-384",
        ext: true,
        key_ops: [ "deriveKey" ],
        kty: "EC",
        x: "YWqkfJRU7pnBXBoPn3UvtO4arqHcFEqimzn5aq21Ms3CSOmOlP8nOhDSeO7L-aX8",
        y: "n2uF85VCWuhFBE1cJm7VRc_emrUv3M2JArSYQkf8lxMMHUV2_68sRL1vu9ngmq2X",
        d: "fw3TJEiU6X6vPe9_vV6dspYlogR0rCBF98AoXFFK_dvV0d4ClNBsKqipUZgj1Uq4"
      }).ready;

    console.log("JWK from new key K:")
    console.log(K.jwkPrivate)

    console.log("'x' in various formats:")
    console.log(K.jwkPrivate.x)
    const xBytes = new Uint8Array(base64ToArrayBuffer(K.jwkPrivate.x!));
    const xHex = Array.from(xBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    console.log(xBytes)
    console.log(xHex)

    console.log("'y' in various formats:")
    console.log(K.jwkPrivate.y)
    const yBytes = new Uint8Array(base64ToArrayBuffer(K.jwkPrivate.y!));
    const yHex = Array.from(yBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    console.log(yBytes)
    console.log(yHex)

    const dBytes = new Uint8Array(base64ToArrayBuffer(K.jwkPrivate.d!));
    const dHex = Array.from(dBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    console.log("'d' in various formats:")
    console.log(K.jwkPrivate.d)
    console.log(dBytes)
    console.log(dHex)

    console.log("K in 'pkcs8' format (private) (and then in hex):")
    const Kpkcs8 = await crypto.subtle.exportKey('pkcs8', K.privateKey)
    console.log(Kpkcs8)
    // and now print Kpkcs8 in hex:
    const Kpkcs8_hex = Array.from(new Uint8Array(Kpkcs8)).map(byte => byte.toString(16).padStart(2, '0')).join('')
    console.log(Kpkcs8_hex)
    console.log("K in 'raw' format (public):")
    console.log(await crypto.subtle.exportKey('raw', K.publicKey))
    console.log("K in 'spki' format (public):")
    console.log(await crypto.subtle.exportKey('spki', K.publicKey))


    const publicKey = await derivePublicKeyFromPrivateD(Kpkcs8_hex);
    console.log("Reconstructed public key from private key:")
    console.log(publicKey);

    // reflect back what's resulting from above
    const testHex = "3081b6020100301006072a8648ce3d020106052b8104002204819e30819b02010104307f0dd3244894e97eaf3def7fbd5e9db29625a20474ac2045f7c0285c514afddbd5d1de0294d06c2aa8a9519823d54ab8a16403620004616aa47c9454ee99c15c1a0f9f752fb4ee1aaea1dc144aa29b39f96aadb532cdc248e98e94ff273a10d278eecbf9a5fc9f6b85f395425ae845044d5c266ed545cfde9ab52fdccd8902b4984247fc97130c1d4576ffaf2c44bd6fbbd9e09aad97"
    
    const testKey = await derivePublicKeyFromPrivateD(testHex);
    console.log("Testing ...:")
    console.log(testKey);
}

async function runTests05() {

    // if we export a JWK key with 'crypto.subtle.exportKey('pkcs8', K.privateKey), we get the below (for this JWK)
    //
    // const K = await new SB384({
    //     crv: "P-384",
    //     ext: true,
    //     key_ops: [ "deriveKey" ],
    //     kty: "EC",
    //     x: "YWqkfJRU7pnBXBoPn3UvtO4arqHcFEqimzn5aq21Ms3CSOmOlP8nOhDSeO7L-aX8",
    //     y: "n2uF85VCWuhFBE1cJm7VRc_emrUv3M2JArSYQkf8lxMMHUV2_68sRL1vu9ngmq2X",
    //     d: "fw3TJEiU6X6vPe9_vV6dspYlogR0rCBF98AoXFFK_dvV0d4ClNBsKqipUZgj1Uq4"
    //   }).ready;
    //
    // eg if we do: await crypto.subtle.exportKey('pkcs8', K.privateKey)
    // and convert to Hex, and then we decypher it manually, we get this:
    // 
    // 30 81 b6 - sequence, object length 0xb6 182 bytes (0x81 means ‘long form’) not counting these 3 (158 + 3 + 16 + 2 + 3)
    //    02 01 00 - integer type length 1, value ‘0’, PKCS#8 version 0 (only one in widespread use)
    //    30 10    - sequence length 16 (short form of length)
    //       06 07    - object identifier of length 7
    //          2a 86 48 ce 3d 02 01 - OID for elliptic curve public key algorithm (ECDSA).
    //       06 05    - object identifier of length 5
    //          2b 81 04 00 22 - SECP384R1 (“1.3.132.0.34”)
    //    04 81 9e - octet string of length 158 bytes (155 + 3)
    //       30 81 9b - sequence length 0x9b 155 bytes (96 + 4 + 2 + 48 + 2 + 3)
    //          02 01 01 - integer type length 1, value ‘1’, version for something
    //          04 30  - octet string of length 48 bytes, which is the private key
    //             7f 0d d3 244894e97eaf3def7fbd5e9db29625a20474... 
    //          a1 64 - context specific tag (pub key?), length 100 bytes (4 + 48 + 48)
    //             03 62 00 - bit string length 98 bytes, no padding bits
    //                04    - uncompressed public key
    //                   61 6a a47c9454ee99c15c1a0f9f752fb4ee1aaea1dc.... 
    const hex1 = "3081b6020100301006072a8648ce3d020106052b8104002204819e30819b02010104307f0dd3244894e97eaf3def7fbd5e9db29625a20474ac2045f7c0285c514afddbd5d1de0294d06c2aa8a9519823d54ab8a16403620004616aa47c9454ee99c15c1a0f9f752fb4ee1aaea1dc144aa29b39f96aadb532cdc248e98e94ff273a10d278eecbf9a5fc9f6b85f395425ae845044d5c266ed545cfde9ab52fdccd8902b4984247fc97130c1d4576ffaf2c44bd6fbbd9e09aad97"

    // we can also try to "break" the above by randomly modifying some part of the public key section
    const hex1b = "3081b6020100301006072a8648ce3d020106052b8104002204819e30819b02010104307f0dd3244894e97eaf3def7fbd5e9db29625a20474ac2045f7c0285c514afddbd5d1de0294d06c2aa8a9519823d54ab8a16403620004616aa47c9454ee99c15c1a0f9f752fb4ee1aaea1dc144aa29b39f96aadb532cdc248e98e94ff273a10d278eecbf9a5fc9f6b85f395425ae845044d5c266ed545cfde9ab52fdccd8902b4984247fc97130c1d4576ffaf2c44bd6fbbd9e09bbd97"

    // and here is hex1 with all the public key contents set to zero
    const hex1c = "3081b6020100301006072a8648ce3d020106052b8104002204819e30819b02010104307f0dd3244894e97eaf3def7fbd5e9db29625a20474ac2045f7c0285c514afddbd5d1de0294d06c2aa8a9519823d54ab8a16403620004616a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"

    // if we try to manually strip out the public keys above, within legal PKCS#8 format, we might get:
    //
    // 30 4E - 78 bytes (55 + 2 + 16 + 2 + 3)
    //    02 01 00 - PKCS#8 version 0
    //    30 10 - 16 bytes (short form length)
    //       06 07 2a 86 48 ce 3d 02 01 - ECDSA
    //       06 05 2b 81 04 00 22 - SECP384R1
    //    04 37 - 55 bytes (short form length)
    //       30 35 - 53 bytes (48 + 2 + 3)
    //          02 01 01 - (we don’t know what this number ’01’ is for)
    //          04 30 - 48 bytes
    //             7f 0d d3 24 48 ... private key
    //
    const hex2 = "304E020100301006072a8648ce3d020106052b81040022043730350201017f0dd3244894e97eaf3def7fbd5e9db29625a20474ac2045f7c0285c514afddbd5d1de0294d06c2aa8a9519823d54ab8"
    // trying with that strange integer as '0' instead
    const hex2b = "304E020100301006072a8648ce3d020106052b81040022043730350201007f0dd3244894e97eaf3def7fbd5e9db29625a20474ac2045f7c0285c514afddbd5d1de0294d06c2aa8a9519823d54ab8"

    // we don't quite know what the second number (value 1) is for, so we can try to remove it
    
    // 30 49 - 73 bytes (50 + 2 + 16 + 2 + 3)
    //    02 01 00
    //    30 10
    //       06 07 2a 86 48 ce 3d 02 01
    //       06 05 2b 81 04 00 22
    //    04 32 - 50 bytes (48 + 2)
    //       04 30 7f0dd3244894e97eaf3def7fbd5e9db29625a20474ac2045f7c0285c514afddbd5d1de0294d06c2aa8a9519823d54ab8
    //
    const hex3 = "3049020100301006072a8648ce3d020106052b81040022043204307f0dd3244894e97eaf3def7fbd5e9db29625a20474ac2045f7c0285c514afddbd5d1de0294d06c2aa8a9519823d54ab8"

    
    // $xxd -p hex4.der
    // 3047020100301006052b8104002206072a8648ce3d020104308d9b1b763b
    // fa0db2d962889064d2aa377105c78bdbf42a6fefcc54826e517dca4f0bba
    // 1ad630aa624619e9a1b33cf11a
    //
    // 30 47
    //    02 01 00
    //    30 10
    //       06 05 2b 81 04 00 22
    //       06 07 f2 a8 64 8c e3 d0 20
    //    10 43 08 d9 b1 b7 63b
    // fa0db2d962889064d2aa377105c78bdbf42a6fefcc54826e517dca4f0bba1ad630aa624619e9a1b33cf11a
    // 
    const hex4 = "3047020100301006052b8104002206072a8648ce3d020104308d9b1b763bfa0db2d962889064d2aa377105c78bdbf42a6fefcc54826e517dca4f0bba1ad630aa624619e9a1b33cf11a"


    // results of the above vary by platform:
    //
    // Deno: accepts hex1, on hex1b throws "InconsistentComponents", on hex2 "expected valid PKCS#8 data", and on hex3 "InvalidEncoding"
    //
    // Firefox: fine with hex1 and in fact hext2, for all the others it says "Data provided to an operation does not meet requirements"
    //
    // Safari: accepts only hex1, for all others it says "Data provided to an operation does not meet requirements",
    //
    // Chrome: only hex1, for all others says "Uncaught Error"

    const testKey = await derivePublicKeyFromPrivateD(hex1); // hex1 works on all platforms tested
    console.log("Testing ...:")
    console.log(testKey);
}


Deno.test("[fast] ECPointDecompress testing", async () => {
    runTests01();
    await runTests02();
    await runTests03();
    await runTests04();
    await runTests04();
});


if (import.meta.main) { // tells Deno not to run this in the test suite
    console.log("\n",
        "===================================================================================\n",
        "===================================================================================\n",
        "===================================================================================\n")
    runTests01();
    await runTests02();
    await runTests03();
    await runTests04();
    await runTests04();
}
