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
import { base64ToArrayBuffer, arrayBufferToBase64url } from "src/utils/b64";
import { base62ToArrayBuffer, arrayBufferToBase62 } from "src/utils/b62";
import { jwkStruct } from "./SB384";

import {
    _sb_assert, SBUserId,
    SBUserPrivateKey, SBUserPublicKey, SBError,
    assemblePayload,
    sbCrypto,
} from 'src/common'

import { NONCE_TYPE } from 'src/types'

import { importKey } from 'src/sbCrypto/core'

const DBG0 = false;

import { ChannelMessage } from 'src/channel/ChannelMessage'
import { ChannelApi } from 'src/channel/ChannelApi'
import { _check_ChannelHandle } from 'src/channel/ChannelHandle'
import { _check_SBChannelData } from 'src/channel/Channel'

export enum KeyPrefix {
    SBPublicKey = "PNk",
    SBPrivateKey = "Xj3",
    SBDehydratedKey = "XjZ",
}

export enum KeySubPrefix {
    CompressedEven = "2",
    CompressedOdd = "3",
    Uncompressed = "4",
    Dehydrated = "x",
}

/**
 * for key compression/decompression; extract sign of y-coordinate (0 is even)
 * @internal
 * */
export function ySign(y: string | ArrayBuffer): 0 | 1 {
    if (typeof y === 'string')
        y = base64ToArrayBuffer(y).buffer;
    const yBytes = new Uint8Array(y);
    return (yBytes[yBytes.length - 1] & 1) === 1 ? 1 : 0;
}

/**
 * Modular exponentiation (BigInt version)
 * @internal
 */
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
 * Decompresses a compressed P384 key.
 * signY is 0 or 1 (even or odd).
 * 
 * @internal
 */
function decompressP384(xBase64: string, signY: number) {
    // Consts for secp384r1 curve
    const prime = BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff'),
        b = BigInt('0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef'),
        pIdent = (prime + 1n) / 4n;
    const xBytes = new Uint8Array(base64ToArrayBuffer(xBase64));
    const xHex = '0x' + Array.from(xBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    var x = BigInt(xHex);
    var y = modPow(x * x * x - 3n * x + b, pIdent, prime);
    if (y % 2n !== BigInt(signY))
        y = prime - y;
    // we now need to convert 'y' to a base64 string
    const yHex = y.toString(16).padStart(96, '0');
    const yBytes = new Uint8Array(yHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const yBase64 = arrayBufferToBase64url(yBytes);
    return { x: xBase64, y: yBase64 };
}

/**
 * Takes a public or private key string, returns a populated jwkStruct.
 * If a key is dehydrated (missing x), x must be provided (base64, eg jwk.x).
 * Any issues and it will return undefined.
 * @public
 */
export function parseSB384string(input: SBUserPublicKey | SBUserPrivateKey): jwkStruct | undefined {
    try {
        if (input.length <= 4) return undefined;
        const prefix = input.slice(0, 4);
        const data = input.slice(4);
        switch (prefix.slice(0, 3)) {
            case KeyPrefix.SBPublicKey: {
                switch (prefix[3]) {
                    case KeySubPrefix.Uncompressed: {
                        const combined = base62ToArrayBuffer(data)
                        if (combined.byteLength !== (48 * 2)) return undefined;
                        const yBytes = combined.slice(48, 96);
                        return {
                            x: arrayBufferToBase64url(combined.slice(0, 48)),
                            y: arrayBufferToBase64url(yBytes),
                            ySign: ySign(yBytes)
                        };
                    }
                    case KeySubPrefix.CompressedEven:
                    case KeySubPrefix.CompressedOdd: {
                        const ySign = prefix[3] === KeySubPrefix.CompressedEven ? 0 : 1;
                        const xBuf = base62ToArrayBuffer(data);
                        if (xBuf.byteLength !== 48) return undefined;
                        const { x: xBase64, y: yBase64 } = decompressP384(arrayBufferToBase64url(xBuf), ySign);
                        return {
                            x: xBase64,
                            y: yBase64,
                            ySign: ySign,
                        };
                    }
                    default: { console.error("KeySubPrefix not recognized"); }
                }
            } break;
            case KeyPrefix.SBPrivateKey: {
                switch (prefix[3]) {
                    case KeySubPrefix.Uncompressed: {
                        const combined = base62ToArrayBuffer(data)
                        if (combined.byteLength !== (48 * 3)) return undefined;
                        const yBytes = combined.slice(48, 96);
                        return {
                            x: arrayBufferToBase64url(combined.slice(0, 48)),
                            y: arrayBufferToBase64url(yBytes),
                            ySign: ySign(yBytes),
                            d: arrayBufferToBase64url(combined.slice(96, 144))
                        };
                    }
                    case KeySubPrefix.CompressedEven:
                    case KeySubPrefix.CompressedOdd: {
                        const ySign = prefix[3] === KeySubPrefix.CompressedEven ? 0 : 1;
                        const combined = base62ToArrayBuffer(data)
                        if (combined.byteLength !== (48 * 2)) return undefined;
                        const xBuf = combined.slice(0, 48);
                        const { x: xBase64, y: yBase64 } = decompressP384(arrayBufferToBase64url(xBuf), ySign);
                        return {
                            x: xBase64,
                            y: yBase64,
                            ySign: ySign,
                            d: arrayBufferToBase64url(combined.slice(48, 96))
                        };
                    }
                    case KeySubPrefix.Dehydrated: {
                        console.error("parseSB384string() - you need to rehydrate first ('hydrateKey()')");
                        return undefined;
                    }
                    default: { console.error("KeySubPrefix not recognized"); }
                }
            } break;
            default: {
                console.error("KeyPrefix not recognized");
            }
        }
        // all paths to this point are failures to parse
        return undefined
    } catch (e) {
        console.error("parseSB384string() - malformed input, exception: ", e);
        return undefined;
    }
}

// @internal
export function xdySignToPrivateKey(x: string, d: string, ySign: 0 | 1): SBUserPrivateKey | undefined {
    if (!x || x.length !== 64 || !d || d.length !== 64 || ySign === undefined) return undefined;
    const combined = new Uint8Array(2 * 48);
    combined.set(base64ToArrayBuffer(x), 0);
    combined.set(base64ToArrayBuffer(d), 48);
    return KeyPrefix.SBPrivateKey + (ySign === 0 ? KeySubPrefix.CompressedEven : KeySubPrefix.CompressedOdd) + arrayBufferToBase62(combined)
}

/**
 * 'hydrates' a key - if needed; if it's already good on hydration, just returns it.
 * Providing pubKey (from other source) is optional so that you can use this function
 * to easily confirm that a key is hydrated, it will return undefined if it's not.
 * @public
 */
export function hydrateKey(privKey: SBUserPrivateKey, pubKey?: SBUserPrivateKey): SBUserPrivateKey | undefined {
    if (privKey.length <= 4) return undefined;
    const prefix = privKey.slice(0, 4);
    switch (prefix.slice(0, 3)) {
        case KeyPrefix.SBPublicKey:
            return privKey;
        case KeyPrefix.SBPrivateKey: {
            switch (prefix[3]) {
                case KeySubPrefix.Uncompressed:
                case KeySubPrefix.CompressedEven:
                case KeySubPrefix.CompressedOdd:
                    return privKey;
                case KeySubPrefix.Dehydrated: {
                    if (!pubKey) {
                        console.error("hydrateKey() - you need to provide pubKey to hydrate");
                        return undefined;
                    }
                    const privKeyData = privKey.slice(4);
                    const combined = base62ToArrayBuffer(privKeyData)
                    const dBytes = combined.slice(0, 48);
                    const d = arrayBufferToBase64url(dBytes);
                    const jwk = parseSB384string(pubKey);
                    if (!jwk || !jwk.x || jwk.ySign === undefined) {
                        console.error("hydrateKey() - failed to parse public key");
                        return undefined;
                    }
                    return xdySignToPrivateKey(jwk.x!, d, jwk.ySign);
                }
                default: { console.error("KeySubPrefix not recognized"); }
            }
        } break;
        default: {
            console.error("KeyPrefix not recognized");
        }
    }
    return undefined
}

/**
 * This is eseentially web standard type AesGcmParams, but with properties being
 * optional - they'll be filled in at the "bottom layer" if missing (and if
 * needed).
 * 
 * @internal
 */
export interface EncryptParams {
    name?: string;
    iv?: NONCE_TYPE;
    additionalData?: BufferSource;
    tagLength?: number;
}

import {
    encodeStrongPin, decodeStrongPin,
    generateStrongPin, generateStrongPin16,
    processStrongPin
} from "./strongpin";

import { base32mi } from "./strongpin";

/**
  * Utility class for SB crypto functions. Generally we use an object
  * instantiation of this (typically ''sbCrypto'') as a global variable.
  *
  * 'SBCrypto' provides a class with wrappers for subtle crypto, as well as some
  * SB-specific utility functions.
  *
  * Typically a public jsonwebkey (JWK) will look something like this in json
  * string format:
  *
  *                        "{\"crv\":\"P-384\",\"ext\":true,\"key_ops\":[],\"kty\":\"EC\",
  *                        \"x\":\"9s17B4i0Cuf_w9XN_uAq2DFePOr6S3sMFMA95KjLN8akBUWEhPAcuMEMwNUlrrkN\",
  *                        \"y\":\"6dAtcyMbtsO5ufKvlhxRsvjTmkABGlTYG1BrEjTpwrAgtmn6k25GR7akklz9klBr\"}"
  *
  * A private key will look something like this:
  *
  *                       "{\"crv\":\"P-384\",
  *                       \"d\":\"KCJHDZ34XgVFsS9-sU09HFzXZhnGCvnDgJ5a8GTSfjuJQaq-1N2acvchPRhknk8B\",
  *                       \"ext\":true,\"key_ops\":[\"deriveKey\"],\"kty\":\"EC\",
  *                       \"x\":\"rdsyBle0DD1hvp2OE2mINyyI87Cyg7FS3tCQUIeVkfPiNOACtFxi6iP8oeYt-Dge\",
  *                       \"y\":\"qW9VP72uf9rgUU117G7AfTkCMncJbT5scIaIRwBXfqET6FYcq20fwSP7R911J2_t\"}"
  *
  * These are elliptic curve keys, we use P-384 (secp384r1). Mostly you will
  * just be using the 'class SB384' object, and all the details are handled.
  *
  * The main (EC) RFC is 7518
  * (https://datatracker.ietf.org/doc/html/rfc7518#section-6.2), supervised by
  * IESG except for a tiny addition of one parameter ("ext") that is supervised
  * by the W3C Crypto WG (https://w3c.github.io/webcrypto/#ecdsa).
  *
  * EC in JWK has a number of parameters, but for us the only required ones are:
  *
  *  crv: the curve (P-384 in this case) x: the x coordinate of the public key
  *  y: the y coordinate of the public key d: the private key (if it's a private
  *  key) kty: the key type (EC in this case) ext: the 'extractable' flag
  *  key_ops: (optional) permitted the key operations
  *
  * All these components are implied except for x, y, and d. Various ways of
  * encoding (eg either just 'd', or just 'x', or 'x,y', or 'd,x', or 'd,x,y')
  * are handled using a prefix system on the keys when represented as a single
  * (base62) string.
  *
  * Starting with 'P' means public, 'X' means private.
  *
  *  "PNk4": public key; x and y are present, the rest implied
  *  [KeyPrefix.SBPublicK+ey] "PNk2": public key, compressed, y is even "PNK3":
  *  public key, compressed, y is odd
  *
  *  "Xj34": private key: x, y, d are present, the rest implied
  *  [KeyPrefix.SBPrivateKey] "Xj32": private key, compressed, has x and d, y is
  *  even "Xj33": private key, compressed, has x and d, y is odd
  *
  *  "XjZx": private key, "dehydrated"; only d is present, x needed from other
  *  source (and y is even)
  *
  * The fourth character encoded in enum KeySubPrefix below. Note that we encode
  * using base62 'externally', but 'x', 'y', and 'd' internally are in base64.
  *
  * Keys default to being compressed.
  *
  * For the AES key, we don't have an internal format; properties would include:
  *
  *  "k": the key itself, encoded as base64 "alg": "A256GCM" "key_ops":
  *  ["encrypt", "decrypt"] "kty": "oct"
  *
  * Only the "k" property is required, the rest are implied, so it's trivial to
  * track. Whenever on the wire A256GCM would just require base62 encoding (into
  * 43 characters).
  *
  * The above (3-letter) prefixes we've generated randomly to hopefully avoid
  * collisions with other formats. For 2/3/4 we follow common (wire) formats.
  * There aren't conventions for what we're calling 'dehydrated' keys (they sort
  * of appear in crypto currency wallets).
  *
  * The above in combination with Channels:
  *
  * - private key: always d, x, ySign
  * - public key: always x, ySign
  * - channel key: same as public key
  *
  * channelId: can be derived from (channel) public key (from x,y)
  *
  * when you join a channel, you can join with only the public key of channel,
  * or channelId; if you join just with channelId, you need channel server (to
  * fetch public key)
  *
  * special format: dehydrated private key: just d (x through some other means)
  *
  * @public
  */
export class SBCrypto {

    // cannot be static since we need to access through "__"
    strongpin = {
        encode: encodeStrongPin,
        decode: decodeStrongPin,
        generate: generateStrongPin,
        generate16: generateStrongPin16,
        process: processStrongPin,
        base32mi: base32mi,
    }

    // re-exporting any core functions
    public importKey = importKey

    /**
     * Hashes and splits into two (h1 and h1) signature of data, h1
     * is used to request (salt, iv) pair and then h2 is used for
     * encryption (h2, salt, iv).
     * @public
     */
    generateIdKey(buf: ArrayBuffer): Promise<{ idBinary: ArrayBuffer, keyMaterial: ArrayBuffer }> {
        if (!(buf instanceof ArrayBuffer)) throw new TypeError('Input must be an ArrayBuffer');
        return new Promise((resolve, reject) => {
            try {
                crypto.subtle.digest('SHA-512', buf).then((digest) => {
                    const _id = digest.slice(0, 32);
                    const _key = digest.slice(32);
                    resolve({
                        idBinary: _id,
                        keyMaterial: _key
                    })
                })
            } catch (e) {
                reject(e)
            }
        })
    }

    /**
     * Generates standard ``ECDH`` keys using ``P-384``.
     * @public
     */
    async generateKeys(): Promise<CryptoKeyPair> {
        try {
            return await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey']);
        } catch (e) {
            throw new SBError('generateKeys() exception (' + e + ')');
        }
    }

    /**
     * Export key; note that if there's an issue, this will return undefined.
     * That can happen normally if for example the key is restricted (and
     * not extractable).
     * @public
     */
    async exportKey(format: 'jwk', key: CryptoKey) {
        return crypto.subtle
            .exportKey(format, key)
            .catch(() => {
                if (DBG0) console.warn(`... exportKey() protested, this just means we treat this as undefined`)
                return undefined
            })
    }

    /**
     * Encrypt data using a key.
     * @public
     */
    async encrypt(data: BufferSource, key: CryptoKey, params: EncryptParams): Promise<ArrayBuffer> {
        if (data === null) throw new SBError('no contents')
        if (!params.iv) throw new SBError('no nonce')
        if (!params.name) params.name = 'AES-GCM';
        else _sb_assert(params.name === 'AES-GCM', "Must be AES-GCM (L412)")
        return crypto.subtle.encrypt(params as AesGcmParams, key, data);
    }

    // async wrap(
    //   body: any,
    //   sender: SBUserId,
    //   encryptionKey: CryptoKey,
    //   salt: ArrayBuffer,
    //   signingKey: CryptoKey,
    //   /* options?: MessageOptions */): Promise<ChannelMessage> {
    //   _sb_assert(body && sender && encryptionKey && signingKey, "wrapMessage(): missing required parameter(2)")
    //   const payload = assemblePayload(body);
    //   _sb_assert(payload, "wrapMessage(): failed to assemble payload")
    //   _sb_assert(payload!.byteLength < MAX_SB_BODY_SIZE,
    //     `wrapMessage(): body must be smaller than ${MAX_SB_BODY_SIZE / 1024} KiB (we got ${payload!.byteLength / 1024} KiB)})`)
    //   _sb_assert(salt, "wrapMessage(): missing salt")
    //   if (DBG2) console.log("will wrap() body, payload:\n", SEP, "\n", body, "\n", SEP, payload, "\n", SEP)
    //   const iv = crypto.getRandomValues(new Uint8Array(12))
    //   const timestamp = await ChannelApi.dateNow()
    //   const view = new DataView(new ArrayBuffer(8));
    //   view.setFloat64(0, timestamp);
    //   var message: ChannelMessage = {
    //     f: sender,
    //     c: await sbCrypto.encrypt(payload!, encryptionKey, { iv: iv, additionalData: view }),
    //     iv: iv,
    //     salt: salt,
    //     s: await sbCrypto.sign(signingKey, payload!),
    //     ts: timestamp,
    //     // unencryptedContents: body, // 'original' payload' .. we do NOT include this
    //   }
    //   if (DBG2) console.log("wrap() message is\n", message)
    //   // if (options) {
    //   //   if (options.sendTo) message.t = options.sendTo
    //   //   if (options.ttl) message.ttl = options.ttl
    //   //   if (options.subChannel) throw new SBError(`wrapMessage(): subChannel not yet supported`)
    //   // }
    //   // try {
    //   //   message = validate_ChannelMessage(message)
    //   // } catch (e) {
    //   //   const msg = `wrapMessage(): failed to validate message: ${e}`
    //   //   console.error(msg)
    //   //   throw new SBError(msg)
    //   // }
    //   return message
    // }

    /**
     * Internally this is Deprecated, but we retain a simplified version for now; for example,
     * some unit tests use this to 'track' higher-level primitives. This used to be
     * the main approach to boot-strap a ChannelMessage object; this is now divided into
     * sync and async phases over internal channel queues.
     * @internal
     */
    async wrap(
        body: any,
        sender: SBUserId,
        encryptionKey: CryptoKey,
        salt: ArrayBuffer,
        signingKey: CryptoKey
    ): Promise<ChannelMessage> {
        const payload = assemblePayload(body);
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const timestamp = await ChannelApi.dateNow()
        const view = new DataView(new ArrayBuffer(8));
        view.setFloat64(0, timestamp);
        return ({
            f: sender,
            c: await sbCrypto.encrypt(payload!, encryptionKey, { iv: iv, additionalData: view }),
            iv: iv,
            salt: salt,
            s: await sbCrypto.sign(signingKey, payload!),
            ts: timestamp,
        })
    }


    // unwrapShard(k: CryptoKey, o: ChannelMessage): Promise<ArrayBuffer> {
    //   return new Promise(async (resolve, reject) => {
    //     try {
    //       const { c: t, iv: iv } = o
    //       _sb_assert(t, "[unwrap] No contents in encrypted message (probably an error)")
    //       const d = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, k, t!)
    //       resolve(d)
    //     } catch (e) {
    //       // not an error per se, for example could just be wrong key
    //       if (DBG0) console.error(`unwrap(): cannot unwrap/decrypt - rejecting: ${e}`)
    //       if (DBG2) console.log("message was \n", o)
    //       reject(e);
    //     }
    //   });
    // }

    /**
     * Basic signing
     * @public
     */
    sign(signKey: CryptoKey, contents: ArrayBuffer) {
        // return crypto.subtle.sign('HMAC', secretKey, contents);
        return crypto.subtle.sign({ name: "ECDSA", hash: { name: "SHA-384" }, }, signKey, contents)
    }

    /** Basic verification */
    verify(verifyKey: CryptoKey, sign: ArrayBuffer, contents: ArrayBuffer) {
        // return crypto.subtle.verify('HMAC', verifyKey, sign, contents)
        return crypto.subtle.verify({ name: "ECDSA", hash: { name: "SHA-384" }, }, verifyKey, sign, contents)
    }

    /** Standardized 'str2ab()' function, string to array buffer. */
    str2ab(string: string): Uint8Array {
        return new TextEncoder().encode(string);
    }

    /** Standardized 'ab2str()' function, array buffer to string. */
    ab2str(buffer: Uint8Array): string {
        return new TextDecoder('utf-8').decode(buffer);
    }

    /**
     * Generates a random alphanumeric (eg base62) string of a given length.
     * The string always starts with a letter.
     * 
     * @internal
     */
    generateRandomString(length: number = 16): string {
        const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const alphanumeric = letters + "0123456789";
        return Array.from({ length }, (_, i) =>
            i === 0 ? letters.charAt(Math.floor(Math.random() * letters.length)) :
                alphanumeric.charAt(Math.floor(Math.random() * alphanumeric.length))
        ).join('');
    }

    /**
     * Fills buffer with random data. Wraps the native crypto.getRandomValues() function.
     * For blocks larger than 4096 bytes the block must be a multiple of 1024 bytes.
     * Note also that for large blocks, entropy will be (much) worse. (Blocks above
     * 1024 bytes should not be used for any cryptographic purposes, only for testing.)
     * 
     * @internal
     */
    getRandomValues(buffer: Uint8Array) {
        if (buffer.byteLength < (4096)) {
            return crypto.getRandomValues(buffer)
        } else {
            // larger blocks should really only be used for testing
            _sb_assert(!(buffer.byteLength % 1024), 'getRandomValues(): large requested blocks must be multiple of 1024 in size')
            let i = 0
            try {
                for (i = 0; i < buffer.byteLength; i += 1024) {
                    let t = new Uint8Array(1024)
                    // this doesn't actually have enough entropy, we should just hash here anyweay
                    crypto.getRandomValues(t)
                    // console.log(`offset is ${i}`)
                    buffer.set(t, i)
                }
            } catch (e: any) {
                console.log(`got an error on index i=${i}`)
                console.log(e)
                console.trace()
            }
            return buffer
        }
    }

    /**
     * Takes a buffer or a string, returns the shorter hash. Uses SHA-256.
     * Returns value as base62. Minimum length is 4 and maximum is 42. 
     */
    async hashDown(value: ArrayBuffer | string, len = 12) {
        if ((len < 4) || (len > 42)) throw Error("[hashDown] Length must be range 12-42.")
        const data = value instanceof ArrayBuffer ? value : (new TextEncoder()).encode(value);
        return arrayBufferToBase62(await window.crypto.subtle.digest("SHA-256", data)).slice(0, len);
    }

}

