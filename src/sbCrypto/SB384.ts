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
const DBG0 = false;

import {
    _sb_assert, ChannelId,
    SBUserPrivateKey, SBUserPublicKey, SBError,
    DBG2, Memoize, Ready,
    sbCrypto,
    SB384Hash
} from 'src/common'

import { WrapError } from 'src/utils/error'

import { parseSB384string, ySign, KeyPrefix, KeySubPrefix, xdySignToPrivateKey } from './SBCrypto'

import { _appendBuffers } from 'src/utils/buffers'

export type jwkStruct = {
    x: string;
    y: string;
    ySign: 0 | 1;
    d?: string
}

import { base64ToArrayBuffer } from 'src/utils/b64'
import { arrayBufferToBase62 } from 'src/utils/b62'
import { b32encode } from 'src/utils/b32mi'
import { base64ToBase62 } from 'src/utils/index'


/**
  * Basic (core) capability object in SB.
  *
  * Can initialize from various formats. If no starting point key is given,
  * it will "mint" a fresh key.
  *
  * If ``forcePrivate`` is true, will force SB384 to include private key; it
  * will throw an exception if the key is not private. If SB384 is used to mint,
  * then it's always private.
  *
  * The important "externally visible" formats are:
  *
  * - {@link SB384.userId}: unique hash ({@link SB384Hash}) of contents of
  *   public key, shorter format (256 bits, 43 x base62), cannot be used to
  *   reconstruct key, used to identify users (and channels)
  *
  * - {@link SB384.userPublicKey}: encodes core public key info ('x' and 'y' fields), as a
  *   base62 string (with a unique prefix). This is 'wire' format as well as
  *   human-readable. 
  *
  * - userPrivateKey(): similar to public key format, adds the 'd' field
  *   information (embedded), from this format a full private key can be
  *   reconstructed.
  *
  * Like most SB classes, SB384 follows the "ready template" design pattern: the
  * object is immediately available upon creation, but isn't "ready" until it
  * says it's ready. See {@link Channel} example below. Getters will throw
  * exceptions if the object isn't sufficiently initialized. Also see Design
  * Note [4]_.
  *
  * @public
  */
export class SB384 {
    // ready: Promise<SB384>
    sb384Ready: Promise<SB384>

    // SB384ReadyFlag: boolean = false // must be named <class>ReadyFlag
    static ReadyFlag = Symbol('SB384ReadyFlag'); // see below for '(this as any)[SB384.ReadyFlag] = false;'

    #private?: boolean

    #x?: string // all these are base64 encoded
    #y?: string
    #ySign?: 0 | 1 // 0 = even, 1 = odd
    #d?: string

    #privateUserKey?: CryptoKey // if present always private
    #publicUserKey?: CryptoKey  // always public

    #signKey?: CryptoKey // can sign/verify if private, or just verify

    #hash?: SB384Hash // generic 'identifier', see hash getter below
    #hashB32?: string // base32 version of hash (first 12 sets eg 48 chars)

    errorState = false; // catch errors and blocks; helps with async error/cleanup sequence

    /**
     * As a fundamental object, SB384 can be initialized from a number starting points:
     * 
     * - No key provided: a new key pair is generated
     * 
     * - A CryptoKey object: a key pair is generated from the CryptoKey
     * 
     * - A JsonWebKey object: a key pair is generated from the provided JsonWebKey
     * 
     * - A SBUserPublicKey object: a key pair is generated from the SBUserPublicKey
     * 
     * - A SBUserPrivateKey object: a key pair is generated from the SBUserPrivateKey
     * 
     * The 'forcePrivate' parameter is used to force the object to be private; if
     * the key provided is inherently not private, an exception is thrown. This simplifies
     * situation where it would only make sense if you're operating with a private key,
     * and spares you from (sometimes convoluted) checks (eg what fields are present in
     * a 'jwk' field etc).
     */
    constructor(key?: CryptoKey | JsonWebKey | SBUserPublicKey | SBUserPrivateKey, forcePrivate?: boolean) {
        (this as any)[SB384.ReadyFlag] = false;
        this.sb384Ready = new Promise<SB384>(async (resolve, reject) => {
            try {
                if (!key) {
                    // generate a fresh ID
                    if (DBG2) console.log("SB384() - generating new key pair")
                    const keyPair = await sbCrypto.generateKeys()
                    const _jwk = await sbCrypto.exportKey('jwk', keyPair.privateKey);
                    _sb_assert(_jwk && _jwk.x && _jwk.y && _jwk.d, 'INTERNAL');
                    this.#private = true
                    this.#x = _jwk!.x!
                    this.#y = _jwk!.y!
                    this.#d = _jwk!.d!
                    if (DBG2) console.log("#### FROM SCRATCH", this.#private)
                } else if (key instanceof CryptoKey) {
                    const _jwk = await sbCrypto.exportKey('jwk', key);
                    _sb_assert(_jwk && _jwk.x && _jwk.y, 'INTERNAL');
                    if (_jwk!.d) {
                        this.#private = true
                        this.#d = _jwk!.d!
                    } else {
                        this.#private = false
                        _sb_assert(!forcePrivate, `ERROR creating SB384 object: key provided is not the requested private`)
                    }
                    this.#x = _jwk!.x!
                    this.#y = _jwk!.y!
                } else if (key && key instanceof Object && 'kty' in key) {
                    // jwk key provided
                    const _jwk = key as JsonWebKey
                    _sb_assert(_jwk && _jwk.x && _jwk.y, 'Cannot parse format of JWK key');
                    if (key.d) {
                        this.#private = true
                        this.#d = _jwk!.d!
                    } else {
                        this.#private = false
                        _sb_assert(!forcePrivate, `ERROR creating SB384 object: key provided is not the requested private`)
                    }
                    this.#x = _jwk!.x!
                    this.#y = _jwk!.y!
                } else if (typeof key === 'string') {
                    // we're given a string encoding

                    const tryParse = parseSB384string(key)
                    if (!tryParse) {
                        if (DBG0) console.trace(`SB384() - failed to parse key, trying to create new key pair from '${key}'`)
                        throw new SBError('ERROR creating SB384 object: invalid key (must be a JsonWebKey | SBUserPublicKey | SBUserPrivateKey, or omitted)')
                    }
                    const { x, y, d } = tryParse as jwkStruct
                    if (d) {
                        this.#private = true
                        this.#d = d
                    } else {
                        this.#private = false
                        _sb_assert(!forcePrivate, `ERROR creating SB384 object: key provided is not the requested private`)
                    }
                    _sb_assert(x && y, 'INTERNAL');
                    this.#x = x
                    this.#y = y
                } else {
                    throw new SBError('ERROR creating SB384 object: invalid key (must be a JsonWebKey, SBUserId, or omitted)')
                }
                if (DBG2) console.log("SB384() constructor; x/y/d:\n", this.#x, "\n", this.#y, "\n", this.#d)
                if (this.#private)
                    this.#privateUserKey = await sbCrypto.importKey('jwk', this.jwkPrivate, 'ECDH', true, ['deriveKey'])
                this.#publicUserKey = await sbCrypto.importKey('jwk', this.jwkPublic, 'ECDH', true, [])
                // we mostly use for sign/verify, occasionally encryption, so double use is ... hopefully ok
                if (this.#private) {
                    const newJwk = { ...this.jwkPrivate, key_ops: ['sign'] }
                    if (DBG2) console.log('starting jwk (private):\n', newJwk)
                    this.#signKey = await crypto.subtle.importKey("jwk",
                        newJwk,
                        {
                            name: "ECDSA",
                            namedCurve: "P-384",
                        },
                        true,
                        ['sign'])
                } else {
                    const newJwk = { ...this.jwkPublic, key_ops: ['verify'] }
                    if (DBG2) console.log('starting jwk (public):\n', newJwk)
                    this.#signKey = await crypto.subtle.importKey("jwk",
                        newJwk,
                        {
                            name: "ECDSA",
                            namedCurve: "P-384",
                        },
                        true,
                        ['verify'])
                }

                // can't put in getter since it's async
                const channelBytes = _appendBuffers([base64ToArrayBuffer(this.#x!), base64ToArrayBuffer(this.#y!)])
                const rawHash = await crypto.subtle.digest('SHA-256', channelBytes)
                this.#hash = arrayBufferToBase62(rawHash)

                // we also create a base32 version of the hash, for use in channel ids (Pages)
                const hashBigInt = BigInt('0x' + Array.from(new Uint8Array(rawHash)).map(b => b.toString(16).padStart(2, '0')).join('')) >> 28n;
                this.#hashB32 = Array.from({ length: 12 }, (_, i) => b32encode(Number((hashBigInt >> BigInt(19 * (11 - i))) & 0x7ffffn))).join('');

                if (DBG2) console.log("SB384() constructor; hash:\n", this.#hash)

                this.#ySign = ySign(this.#y!);

                if (DBG2) console.log("SB384() - constructor wrapping up", this)
                    // sbCrypto.addKnownKey(this)
                    ; (this as any)[SB384.ReadyFlag] = true
                resolve(this)
            } catch (e) {
                reject('ERROR creating SB384 object failed: ' + WrapError(e))
            }
        })

        // if (DBG0) console.log("SB384() - constructor promises set up, promise is:", this.sb384Ready)
    }

    get SB384ReadyFlag() { return (this as any)[SB384.ReadyFlag] }
    get ready() { return this.sb384Ready }
    // get readyFlag() { return this.#SB384ReadyFlag }

    /** Returns true if this is a private key, otherwise false.
     * Will throw an exception if the object is not ready. */
    @Memoize @Ready get private() { return this.#private! }

    /**
     * Returns a unique identifier for external use, that will be unique
     * for any class or object that uses SB384 as it's root.
     * 
     * This is deterministic. Typical use case is to translate a user id
     * into a {@link ChannelId} (eg the channel that any user id is inherently
     * the owner of).
     * 
     * The hash is base62 encoding of the SHA-384 hash of the public key.
     * 
     */
    @Memoize @Ready get hash(): SB384Hash { return this.#hash! }

    /**
     * Similar to {@link SB384.hash}, but base32 encoded.
     */
    @Memoize @Ready get hashB32(): SB384Hash { return this.#hashB32! }

    // convenience getter
    @Memoize @Ready get userId(): SB384Hash { return this.hash }

    /**
     * This is the {@link ChannelId} corresponding to the user private key.
     * (If user is owner of THIS channel, then this is same as channelid.) 
     */
    @Memoize @Ready get ownerChannelId() {
        // error even though there's a #hash, since we know it needs to be private
        // ... update, hm, actually this is still used as "whatif" for non-owner
        // if (!this.private) throw new SBError(`ownerChannelId() - not a private key, cannot be an owner key`)
        return this.hash
    }

    /** @type {CryptoKey} Private key (might not be present, in which case this will throw) */
    @Memoize @Ready get privateKey(): CryptoKey {
        if (!this.private) throw new SBError(`this is a public key, there is no 'privateKey' value`)
        return this.#privateUserKey!
    }

    /** @type {CryptoKey} Signing key. */
    @Memoize @Ready get signKey(): CryptoKey { return this.#signKey! }

    /** @type {CryptoKey} Basic public key, always present. */
    @Memoize @Ready get publicKey(): CryptoKey { return this.#publicUserKey! }

    /* Deprecated For 'jwk' format use cases. @type {JsonWebKey} */
    // @Memoize @Ready get exportable_pubKey() { return sbCrypto.extractPubKey(this.#jwk!)! }

    /** @type {JsonWebKey} Exports private key in 'jwk' format. */
    @Memoize get jwkPrivate(): JsonWebKey {
        _sb_assert(this.#private, 'jwkPrivate() - not a private key')
        _sb_assert(this.#x && this.#y && this.#d, "JWK key info is not available (fatal)")
        return {
            crv: "P-384",
            ext: true,
            key_ops: ["deriveKey"],
            kty: "EC",
            x: this.#x!,
            y: this.#y!,
            d: this.#d!,
        }
    }

    /** @type {JsonWebKey} Exports public key in 'jwk' format. */
    @Memoize get jwkPublic(): JsonWebKey {
        _sb_assert(this.#x && this.#y, "JWK key info is not available (fatal)")
        return {
            crv: "P-384",
            ext: true,
            key_ops: [],
            kty: "EC",
            x: this.#x!,
            y: this.#y!
        }
    }

    @Memoize get ySign(): 0 | 1 {
        _sb_assert(this.#ySign !== null, "ySign() - ySign is not available (fatal)")
        return this.#ySign!
    }

    /**
     * Wire format of full (decodable) public key
     * @type {SBUserPublicKey}
     */
    @Memoize get userPublicKey(): SBUserPublicKey {
        _sb_assert(this.#x && (this.#ySign !== undefined), "userPublicKey() - sufficient key info is not available (fatal)")
        return KeyPrefix.SBPublicKey + (this.#ySign! === 0 ? KeySubPrefix.CompressedEven : KeySubPrefix.CompressedOdd) + base64ToBase62(this.#x!)
    }

    /**
     * Wire format of full info of key (eg private key). Compressed.
     */
    @Memoize get userPrivateKey(): SBUserPrivateKey {
        _sb_assert(this.#private, 'userPrivateKey() - not a private key, there is no userPrivateKey')
        const key = xdySignToPrivateKey(this.#x!, this.#d!, this.#ySign!)
        _sb_assert(key !== undefined, "userPrivateKey() - failed to construct key, probably missing info (fatal)")
        return key!
    }

    /**
     * Compressed and dehydrated, meaning, 'x' needs to come from another source
     * (namely, derived from 'd').
     */
    @Memoize get userPrivateKeyDehydrated(): SBUserPrivateKey {
        _sb_assert(this.#private && this.#d, "userPrivateKey() - not a private key, and/or 'd' is missing, there is no userPrivateKey")
        return (KeyPrefix.SBPrivateKey + KeySubPrefix.Dehydrated + base64ToBase62(this.#d!)) as SBUserPrivateKey
    }

    /**
     * Returns private key field 'd' as a binary ArrayBuffer.
     */
    @Memoize get binaryD(): ArrayBuffer {
        if (!this.#private || !this.#d) throw new SBError("binaryD() - not a private key, and/or 'd' is missing, there is no userPrivateKey")
        return (base64ToArrayBuffer(this.#d))
    }
    
    /**
     * Convenience wrapper, returns a promise to new, valid SB384 private key.
     * It's essentially short for:
     * 
     * ```javascript
     * const newKey = (await (new SB384()).ready).userPrivateKey
     * ```
     * @public
     */
    static async newPrivateKey(): Promise<SBUserPrivateKey> {
        return (await (new SB384()).ready).userPrivateKey
    }


} /* class SB384 */