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
import { ObjectHandle } from './ObjectHandle'
import { arrayBufferToBase62, Base62Encoded, b62regex, base62ToArrayBuffer } from '../utils/b62'
import { extractPayload } from '../utils/payloads'
import { importKey } from 'src/sbCrypto/core'
import { SBError, _sb_assert } from 'src/utils/error'
import { SBApiFetch } from 'src/utils/fetch'
import { SBFile, isSBFile } from 'src/file/SBFile'
import { SALT_TYPE, NONCE_TYPE } from '../types'

// interface ObjectHandle {
//     id: Base62Encoded, // strictly speaking, only id is needed
//     iv?: Uint8Array | Base62Encoded,
//     salt?: ArrayBuffer | Base62Encoded,
//     actualSize?: number, // actual size of underlying (packaged, padded, and encrypted) contents
//     verification?: Promise<string> | string,
//     data?: WeakRef<ArrayBuffer> | ArrayBuffer, // if present, the raw data (packaged, encrypted)
//     key?: Base62Encoded, // decryption key
//     storageServer?: string, // if present, clarifies where to get it (or where it was found)
//     payload?: any // if present, decrypted and extracted data
//     type?: string,
//     hash?: string, // hash of the object (hashed in payload format)
// }

const DBG0 = false
declare var DBG2: boolean;
const SEP = '--------------------------------'

export const storageCoreKnownShards: Map<string, ObjectHandle> = new Map();

// ── Local mirror probe ──────────────────────────────────────────────
// On startup, silently HEAD-request the local mirror (localhost:3841).
// If it responds, all subsequent shard fetches prefer it; if absent,
// we skip it entirely.  No console noise either way.
const LOCAL_MIRROR = 'http://localhost:3841'

/** null = not yet probed, true = available, false = unavailable */
let _localMirrorAvailable: boolean | null = null
let _mirrorProbePromise: Promise<boolean> | null = null

/** Returns true if the local mirror responds within 800ms. */
async function _probeLocalMirror(): Promise<boolean> {
    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 800)
        // Mirror exposes /api/version — use GET since the Python
        // SimpleHTTPRequestHandler doesn't handle HEAD by default.
        const resp = await fetch(`${LOCAL_MIRROR}/api/version`, {
            method: 'GET',
            signal: controller.signal,
        })
        clearTimeout(timer)
        return resp.ok
    } catch {
        return false
    }
}

/**
 * Call once at app init to kick off the silent mirror probe.
 * Safe to call multiple times — only the first call triggers a probe.
 * Returns a promise that resolves to the probe result.
 */
export function initLocalMirrorProbe(): Promise<boolean> {
    if (!_mirrorProbePromise) {
        _mirrorProbePromise = _probeLocalMirror().then((ok) => {
            _localMirrorAvailable = ok
            return ok
        })
    }
    return _mirrorProbePromise
}

/** Synchronous read of the current mirror state. */
export function isLocalMirrorAvailable(): boolean | null {
    return _localMirrorAvailable
}
// ─────────────────────────────────────────────────────────────────────

/**
 * Bare bones version of StorageApi.fetchData(). Does not verify handle.
 */
export function getDataFromHandle(handle: ObjectHandle | undefined): ArrayBuffer | undefined {
    if (typeof handle === 'undefined') return undefined
    const h: ObjectHandle = handle
    if (!h.data) return undefined
    if (h.data instanceof WeakRef) {
        const dref = h.data!.deref()
        if (dref) return dref
        else return undefined
    } else if (h.data instanceof ArrayBuffer) {
        return h.data
    } else {
        throw new Error('Invalid data type in handle')
    }
}

/**
 * 'Shard' object is the format returned by storage server; this code
 * 'paraphrases' code in the storage server. it is essentially a variation
 * of ObjectHandle, but (much) more restrictive.
 * 
 * Validator is {@link validate_Shard}.
 * */
export interface Shard {
    version: '3',
    id: Base62Encoded,
    iv: NONCE_TYPE,
    salt: SALT_TYPE,
    actualSize: number, // of the data in the shard
    data: ArrayBuffer,
}

export function validate_Shard(s: Shard): Shard {
    if (!s) throw new Error(`invalid Shard (ObjectHandle) (null or undefined)`);
    else if (s.version === '3'
        && (typeof s.id === 'string' && s.id.length === 43 && b62regex.test(s.id))
        && (s.iv instanceof Uint8Array && s.iv.byteLength === 12)
        && (s.salt instanceof ArrayBuffer && s.salt.byteLength === 16)
        && (s.data instanceof ArrayBuffer && s.actualSize === s.data.byteLength)) return s
    else throw new Error(`invalid Shard`);
}

/** Derives the encryption key for a given object (shard). */
export function getObjectKey(fileHashBuffer: BufferSource, salt: ArrayBuffer): Promise<CryptoKey> {
    return new Promise((resolve, reject) => {
        try {
            importKey('raw',
                fileHashBuffer,
                'PBKDF2', false, ['deriveBits', 'deriveKey']).then((keyMaterial) => {
                    crypto.subtle.deriveKey({
                        'name': 'PBKDF2',
                        'salt': salt,
                        'iterations': 100000, // small is fine
                        'hash': 'SHA-256'
                    }, keyMaterial, { 'name': 'AES-GCM', 'length': 256 }, true, ['encrypt', 'decrypt'])
                        .then((key) => {
                            resolve(key)
                        })
                })
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * Unpads a data buffer from a storage buf. Note that actual size is in the last 4 bytes.
 * Reverse of StorageApi.padData().
 */
export function unpadData(data_buffer: ArrayBuffer): ArrayBuffer {
    // this is here rather than in StorageApi, for 'core' packaging
    const tail = data_buffer.slice(-4)
    var _size = new DataView(tail).getUint32(0)
    const _little_endian = new DataView(tail).getUint32(0, true)
    if (_little_endian < _size) {
        // a bit of a hack, some code writes the size in little endian
        if (DBG2) console.warn("Unpadding: size of shard encoded as little endian (fixed upon read)")
        _size = _little_endian
    }
    if (DBG2) {
        console.log(`Unpadding: size of object is ${_size}`)
    }
    return data_buffer.slice(0, _size);
}

/**
     gets shard contents from server, and decrypts it.
    populates handle. returns hash (of decrypted contents) and updated handle.
    a wrapper: any failure conditions (exceptions) returns 'null', facilitates
    trying different servers. 
    @internal
    */
export async function fetchDataCore(useServer: string, url: string, h: ObjectHandle): Promise<{ hash: string, handle: ObjectHandle } | undefined> {
    try {
        let shard = validate_Shard(await SBApiFetch(useServer + url, { method: 'GET' }) as Shard)

        // todo: technically this isn't necessary, since we now distinguish data from payload
        _sb_assert(h.key, "object handle 'key' is missing, cannot decrypt")

        // we merge shard info into our handle
        h.iv = shard.iv
        h.salt = shard.salt
        h.data = new WeakRef(shard.data)
        // h.actualSize = shard.actualSize

        if (DBG2) console.log("fetchData(), handle (and data) at this point:", h, shard.data)

        const h_key = base62ToArrayBuffer(h.key!)
        const decryptionKey = await getObjectKey(h_key, h.salt);
        // const decryptedData = await sbCrypto.unwrapShard(decryptionKey, { c: shard.data, iv: h.iv })
        const decryptedData = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: h.iv }, decryptionKey, shard.data)
        const buf = unpadData(decryptedData)
        if (DBG2) console.log("shard.data (decrypted and unpadded):", buf)
        // hashes are on the inner binary data (eg decrypted but not extracted)
        const hash = arrayBufferToBase62(await crypto.subtle.digest('SHA-256', buf)).slice(0, 12);
        if (h.hash && h.hash !== hash)
            // if they differ, we ignore, and use the one we just calculated
            console.error("[fetchData] Hash mismatch in object, internal error (L4730) but ignored")
        h.payload = extractPayload(buf).payload
        h.data = new WeakRef(shard.data) // once we've gotten the payload, we keep ref but we're chill about it
        return ({ hash: hash, handle: h })
    } catch (error) {
        if (DBG0) console.log(`fetchData(): trying to get object on '${useServer}' failed: '${error}'`)
        return (undefined)
    }
}

/**
 * Lower level version of fetchData(), that can be used to fetch data from
 * a known (and 'good') handle. Static, requires no other context.
 */
export async function fetchDataFromHandle(handle: ObjectHandle): Promise<ObjectHandle> {
    if (!handle)
        throw new Error('[fetchData] No handle provided (cannot accept null or undefined)')
    if (!handle.storageServer)
        console.warn('[fetchData] No storage server in handle, probably an error. Will only probe for local mirror.')
    const h: ObjectHandle = handle // does not verify
    if (DBG0) console.log("fetchData(), handle:", h)

    // ... not correct
    // // we might be 'caching' as a weakref
    // if (h.data && h.data instanceof WeakRef && h.data.deref()) return (h); // the ref is still good

    // Note: we don't use any local storage as a cache, since the shards
    // already have a 'namespace' for caching in the browser (regular network
    // operations)

    const verification = await h.verification

    // Ensure the mirror probe has run. initLocalMirrorProbe() is idempotent —
    // first call kicks off the probe, subsequent calls return the same promise.
    // This way lib384 self-initializes; callers don't need to remember to probe.
    await initLocalMirrorProbe()

    const remoteServer = h.storageServer ? h.storageServer : null
    let servers: (string | null)[]
    if (_localMirrorAvailable === true) {
        servers = [LOCAL_MIRROR, remoteServer]    // mirror first when probed available
    } else if (_localMirrorAvailable === false) {
        servers = [remoteServer]                   // skip mirror when probed unavailable
    } else {
        servers = [remoteServer, LOCAL_MIRROR]     // not probed: try both (original behavior)
    }

    for (const server of servers) {
        if (!server) continue
        if (DBG0) console.log('\n', SEP, "fetchData(), trying server: ", server, '\n', SEP)
        const queryString = '/api/v2/fetchData?id=' + h.id + '&verification=' + verification
        const result = await fetchDataCore(server, queryString, h)
        if (result) {
            const { hash, handle } = result
            if (DBG0) console.log(`[fetchData] success: fetched from '${server}'`, result)
            handle.storageServer = server // store the one that worked
            storageCoreKnownShards.set(hash, handle)
            return (handle)
        }
    }
    throw new Error(`[fetchData] failed to fetch from any server`)
}

/**
 * Barebones version of fetchPayload(). Must have storage server set by callee.
 */
export async function fetchPayloadFromHandle(h: ObjectHandle): Promise<any> {
    if (!h) throw new Error('[fetchPayload] No handle provided (cannot accept null or undefined)')
    if (!h.payload && !h.data)
        h = await fetchDataFromHandle(h)
    if (h.payload)
        return h.payload
    if (h.data)
        return getDataFromHandle(h)
    throw new Error('[fetchPayload] Failed to fetch data or payload')
}

/**
 * Takes an SBFile or ObjectHandle and returns the payload. Throws 
 * if there are any issues. Handles large files as well.
 */
export async function fetchPayload(fileOrObject: SBFile | ObjectHandle): Promise<any> {
    let handle
    if (isSBFile(fileOrObject) /* (fileOrObject as SBFile)._SBFSVersion === '2024-02-01-0002'*/) {
        // const sb = fileOrObject as SBFile
        const sb = new SBFile(fileOrObject)
        if (sb.fileLocation === 'inline')
            if (sb.file instanceof ArrayBuffer)
                return sb.file // inline files are already in memory
            else
                throw new SBError("[fetchPayload] Inline files must have 'file' (ArrayBuffer) property set")
        if (sb.browserFile && sb.browserFile.size > SBFile.MAX_SBFILE_CHUNK_SIZE) {
            // if SBFile has a browserFile property, then it's still operating against disk
            return sb.browserFile.arrayBuffer()
        }
        if (sb.handle) {
            // singletons should have either 'handle' set, or '[handle]' in 'handleArray'
            handle = sb.handle
        } else if (!sb.handleArray || sb.handleArray.length === 0) {
            // (cutting this out for now)
            // // no handle is fine if it's present in our global buffer map
            // if (sb.hash && BrowserFileHelper.knownBuffers.has(sb.hash))
            //     return BrowserFileHelper.knownBuffers.get(sb.hash)
            // throw new SBError("[fetchPayload] Cannot find payload for SBFile")
            throw new SBError("[fetchPayload] No handle or handleArray in SBFile - need to hook up BrowserFileHelper.knownBuffers?")
        } else if (sb.handleArray.length === 1) {
            handle = sb.handleArray[0] // singleton (common case)
        } else {
            if (!sb.size) throw new SBError("[fetchPayload] No size in SBFile (large file)");
            if (!sb.handleArray || sb.handleArray.length === 0)
                throw new SBError("[fetchPayload] No handleArray in SBFile (large file)");
            const predictedChunkCount = Math.ceil(sb.size / SBFile.MAX_SBFILE_CHUNK_SIZE);
            if (sb.handleArray.length !== predictedChunkCount)
                throw new SBError("[fetchPayload] Size does not match number of expected shards");
            const completeBuffer = new ArrayBuffer(sb.size);
            const view = new Uint8Array(completeBuffer);
            let index = 0;
            for (const h of sb.handleArray) {
                console.log("Fetching and assembling payload from:", h);
                // const chunk = await this.SB.storage.fetchPayload(h);
                const chunk = await fetchPayloadFromHandle(h);
                if (!chunk) throw new SBError("[fetchPayload] No chunk in SBFile");
                if (!(chunk instanceof ArrayBuffer)) throw new SBError("[fetchPayload] Chunk is not ArrayBuffer");
                // all chunks except the last one must be of size 'MAX_SBFILE_CHUNK_SIZE'
                if (chunk.byteLength > SBFile.MAX_SBFILE_CHUNK_SIZE)
                    throw new SBError("[fetchPayload] Chunk size is too large");
                else if (index === predictedChunkCount - 1 && chunk.byteLength !== sb.size % SBFile.MAX_SBFILE_CHUNK_SIZE)
                    throw new SBError("[fetchPayload] Last chunk size does not match expected size");
                else if (index < predictedChunkCount - 1 && chunk.byteLength !== SBFile.MAX_SBFILE_CHUNK_SIZE)
                    throw new SBError("[fetchPayload] Chunk size does not match expected size");
                view.set(new Uint8Array(chunk), index * SBFile.MAX_SBFILE_CHUNK_SIZE);
                index += 1;
            }
            return completeBuffer;
        }
    } else {
        handle = fileOrObject as ObjectHandle
    }
    if (!handle) throw new SBError("[fetchPayload] No handle provided")
    return fetchPayloadFromHandle(handle);
}