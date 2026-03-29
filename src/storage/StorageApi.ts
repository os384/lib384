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
    SBError,
    ChannelApi, _appendBuffers,
    arrayBufferToBase62,
    ChannelHandle, Channel, SBStorageToken,
    ObjectHandle, assemblePayload, 
    validate_SBStorageToken,
} from '../index'

import {
    fetchDataFromHandle,
    getDataFromHandle,
    getObjectKey,
    unpadData
} from './core'

import {
    DBG2, sbCrypto, SEP, 
    SBApiFetch, _sb_assert,
} from '../common'

import  { SALT_TYPE, NONCE_TYPE } from '../types'

const DBG0 = false;

import { _check_SBStorageToken } from 'src/storage/StorageToken'
import { _check_ChannelHandle } from 'src/channel/ChannelHandle'
import { SB_OBJECT_HANDLE_SYMBOL, currentSBOHVersion, validate_ObjectHandle } from 'src/storage/ObjectHandle'



/**
 * Basic object handle for a shard (all storage).
 * 
 * To RETRIEVE a shard, you need id and verification.
 * 
 * To DECRYPT a shard, you need key, iv, and salt. Current
 * generation of shard servers will provide (iv, salt) upon
 * request if (and only if) you have id and verification.
 * 
 * Note that id32/key32 are array32 encoded base62 encoded.
 * 
 * 'verification' is a 64-bit integer, encoded as a string
 * of up 23 characters: it is four 16-bit integers, either
 * joined by '.' or simply concatenated. Currently all four
 * values are random, future generation only first three
 * are guaranteed to be random, the fourth may be "designed".
 * 
 * 
 * @typedef {Object} ObjectHandleClass
 * @property {boolean} [SB_OBJECT_HANDLE_SYMBOL] - flag to indicate this is an ObjectHandle
 * @property {string} version - version of this object
 * @property {string} id - id of object
 * @property {string} key - key of object
 * @property {Base62Encoded} [id32] - optional: array32 format of id
 * @property {Base62Encoded} [key32] - optional: array32 format of key
 * @property {Promise<string>|string} verification - and currently you also need to keep track of this,
 * but you can start sharing / communicating the
 * object before it's resolved: among other things it
 * serves as a 'write-through' verification
 * @property {Uint8Array|string} [iv] - you'll need these in case you want to track an object
 * across future (storage) servers, but as long as you
 * are within the same SB servers you can request them.
 * @property {Uint8Array|string} [salt] - you'll need these in case you want to track an object
 * across future (storage) servers, but as long as you
 * are within the same SB servers you can request them.
 * @property {string} [fileName] - by convention will be "PAYLOAD" if it's a set of objects
 * @property {string} [dateAndTime] - optional: time of shard creation
 * @property {string} [shardServer] - optionally direct a shard to a specific server (especially for reads)
 * @property {string} [fileType] - optional: file type (mime)
 * @property {number} [lastModified] - optional: last modified time (of underlying file, if any)
 * @property {number} [actualSize] - optional: actual size of underlying file, if any
 * @property {number} [savedSize] - optional: size of shard (may be different from actualSize)
 * 
 * StorageAPI. Used to interact with storage server(s). It will have a concept
 * of a 'default' server, but that is not needed for all operations. It will
 * default to using server choices in any handles.
 * 
 * @public
 */
export class StorageApi {
    #server?: string; // either a channel or storage server
    #storageServer: string = ''; // empty means unknown (for example we're offline)
    static #uploadBacklog = 0
    static getObjectKey = getObjectKey // compatibility
    constructor(server?: string) {
        if (server) {
            this.#server = server
            this.#_getStorageServer().then((s) => {
                if (!s) {
                    if (DBG0) console.error("[StorageApi] Could not (immediately) resolve storage server")
                    // ToDo: we are proactive in checking again during dev&test, this might be unnecessary
                    //       since ''getStorageServer()'' will retry later anyway, as needed
                    const reCheckInterval = setInterval(async () => {
                        if (ChannelApi.isShutdown) {
                            clearInterval(reCheckInterval)
                            if (DBG0) console.error("[StorageApi] Shutting down, will not retry getting storage server")
                        } else {
                            const s2 = await this.#_getStorageServer()
                            if (s2) {
                                clearInterval(reCheckInterval)
                                if (DBG0) console.log(`[StorageApi] ... eventually resolved storage server ('${s2}')`)
                            } // else: no-op, we keep trying
                        }
                    }, 1000)
                } // else: no need to try again
            })
        }
    }

    // we use a promise so that asynchronicity can be handled interally in StorageApi,
    // eg so users don't have to do things like ''(await SB.storage).fetchObject(...)''.
    // this fetch is low-level and returns empty string if not online. if it receives
    // inconsistent or incorrect information, it will throw
    async #_getStorageServer(): Promise<string> {
        if (this.#storageServer) {
            return this.#storageServer
        } else if (!this.#server) {
            if (DBG0) console.warn('[StorageApi] No server information known (neither channel or storage)')
        } else {
            const retValue = await ChannelApi.getServerInfo(this.#server)
            if (!retValue) return '' // we're probably offline
            if (retValue && !retValue.storageServer)
                throw new SBError('[StorageApi] Server available did not provide storage server name, cannot initialize. Should not happen [L4651]')
            if (DBG0) console.log("[StorageApi] Fyi, server returned info info:", retValue)
            this.#storageServer = retValue.storageServer

        }
        return this.#storageServer // if undetermined, we return empty string
    }

    async getStorageServer() {
        const s = await this.#_getStorageServer()
        if (s) return s;
        else throw new SBError("[StorageApi] Identity of storage server is not (yet) known.");
    }

    /**
     * Pads object up to closest permitted size boundaries,
     * taking into account meta data overhead of the padding itself,
     * increasing privacy by hiding actual size of data.
     * 
     * Currently, this means minimum size of 4 KiB, after which
     * we round up to closest power of 2, doing so up to 1 MiB,
     * after which we round up to the next MiB boundary.
     */
    static padBuf(buf: ArrayBuffer): ArrayBuffer {
        const dataSize = buf.byteLength; let _target

        const MIN_SIZE = 4096;    // 4 KiB
        const MAX_SIZE = 1048576; // 1 MiB
        const OVERHEAD = 4;       // Size of Uint32

        // pick the size to be rounding up to
        if ((dataSize + OVERHEAD) < MIN_SIZE) _target = MIN_SIZE // smallest size
        else if ((dataSize + OVERHEAD) < MAX_SIZE) _target = 2 ** Math.ceil(Math.log2(dataSize + OVERHEAD)) // in between
        else _target = (Math.ceil((dataSize + OVERHEAD) / MAX_SIZE)) * MAX_SIZE // largest size
        // append the padding buffer
        let finalArray = _appendBuffers([buf, (new Uint8Array(_target - dataSize)).buffer]);
        // set the (original) size in the last 4 bytes
        (new DataView(finalArray)).setUint32(_target - OVERHEAD, dataSize)
        if (DBG2) console.log("padBuf bytes:", finalArray.slice(-OVERHEAD));
        return finalArray
    }

    /**
     * Reverse of padBuf(). Note that actual size is in the last 4 bytes.
     */
    static unpadBuf(data_buffer: ArrayBuffer): ArrayBuffer {
        return unpadData(data_buffer)
    }

    /** derives final object ID */
    static async getObjectId(iv: NONCE_TYPE, salt: SALT_TYPE, encryptedData: ArrayBuffer): Promise<string> {
        if (DBG2) console.log(
            SEP,
            "getObjectId()",
            SEP, iv,
            SEP, salt,
            SEP, encryptedData,
            SEP
        )
        // todo: yes we end up doing a bit more copying of data then needed
        const id = await crypto.subtle.digest('SHA-256',
            _appendBuffers([
                iv,
                salt,
                encryptedData
            ]))
        return arrayBufferToBase62(id)
    }

    /**
     * Paces uploads to avoid overloading the storage server. Takes into account
     * global number of operations.
     */
    static async paceUploads() {
        if (DBG0) console.log("+++++ [paceUploads] called, backlog is:", StorageApi.#uploadBacklog)
        while (StorageApi.#uploadBacklog > 8) { // ToDo: evaluate this better and/or redesign storage server
            if (DBG0) console.log("+++++ [paceUploads] waiting for server, backlog is:", StorageApi.#uploadBacklog)
            await new Promise((resolve) => setTimeout(resolve, 25))
        }
    }

    /**
     * Store 'contents' as a shard, returns an object handle. Note that 'contents' can be
     * anything, and is always packaged as a payload before storing.
     */
    async storeData(
        contents: any,
        budgetSource: ChannelHandle | Channel | SBStorageToken
    ): Promise<ObjectHandle> {
        StorageApi.#uploadBacklog++
        try {
            const buf = assemblePayload(contents)!
            if (!buf) throw new SBError("[storeData] failed to assemble payload")
            const hash = arrayBufferToBase62(await crypto.subtle.digest('SHA-256', buf)).slice(0, 12);

            // const bufSize = (buf as ArrayBuffer).byteLength // before padding
            const paddedBuf = StorageApi.padBuf(buf)
            const fullHash = await sbCrypto.generateIdKey(paddedBuf)

            // 'phase 1': get salt and iv from storage server for this object
            const storageServer = await this.getStorageServer()
            const idForKeyLookup = arrayBufferToBase62(fullHash.idBinary)
            const requestQuery = storageServer + '/api/v2/storeRequest?id=' + idForKeyLookup
            const keyInfo = await SBApiFetch(requestQuery) as { salt: SALT_TYPE, iv: NONCE_TYPE }
            if (!keyInfo.salt || !keyInfo.iv)
                throw new SBError('[storeData] Failed to get key info (salt, nonce) from storage server')

            const key = await getObjectKey(fullHash.keyMaterial, keyInfo.salt)
            const encryptedData = await sbCrypto.encrypt(paddedBuf, key, { iv: keyInfo.iv })

            let storageToken: SBStorageToken
            if (budgetSource instanceof Channel) {
                storageToken = await budgetSource.getStorageToken(encryptedData.byteLength)
            } else if (_check_ChannelHandle(budgetSource as ChannelHandle)) {
                storageToken = await (await new Channel(budgetSource as ChannelHandle).ready).getStorageToken(encryptedData.byteLength)
            } else if (_check_SBStorageToken(budgetSource as SBStorageToken)) {
                storageToken = validate_SBStorageToken(budgetSource as SBStorageToken)
            } else {
                throw new SBError("[storeData] invalid budget source (needs to be a channel, channel handle, or storage token)")
            }

            // 'phase 1B': object id is created by hashing the encryptedData with the iv and salt
            const id = await StorageApi.getObjectId(keyInfo.iv, keyInfo.salt, encryptedData)

            // 'phase 2': we store the object
            const storeQuery = storageServer + '/api/v2/storeData?id=' + id
            const init: RequestInit = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream"',
                },
                body: assemblePayload({
                    id: id,
                    iv: keyInfo.iv,
                    salt: keyInfo.salt,
                    storageToken: storageToken,
                    data: encryptedData
                })
            }

            if (DBG2) console.log("5555 5555 [storeData] storeQuery:", SEP, storeQuery, SEP)

            const result = await SBApiFetch(storeQuery, init)

            const r: ObjectHandle = {
                [SB_OBJECT_HANDLE_SYMBOL]: true,
                version: currentSBOHVersion,
                id: id,
                key: arrayBufferToBase62(fullHash.keyMaterial),
                iv: keyInfo.iv,
                salt: keyInfo.salt,
                // actualSize: bufSize,
                hash: hash,
                verification: result.verification,
                storageServer: storageServer,
            }
            if (DBG0) console.log("storeData() - success, handle:", r, encryptedData)
            return (r)
        } catch (error) {
            console.error("[storeData] failed:", error)
            if (error instanceof SBError) {
                // check if 'Not enough storage budget' is in the message
                if (error.message.includes('Not enough storage budget'))
                    throw new SBError('Not enough storage budget')
                else
                    throw error
            }
            throw new SBError(`[storeData] failed to store data: ${error}`)
        } finally {
            StorageApi.#uploadBacklog--
        }
    }

    /**
     * Fetches the data for a given object handle. Result will be referenced by
     * the 'payload' property in the returned handle. This is the main 'read'
     * workhorse. Note it will result in a call to core.fetchDataFromHandle().
     *
     * This will work if you have sufficient information in the passed
     * ObjectHandle. fetchData() will flesh out everything it can, and throw if
     * it's not able to. It will return the same handle, with whatever additional
     * parts it was able to fill in.
     *
     * Note that fetchData will prioritize checking with the storageServer in the
     * handle, if present. Next, it will always check localhost at port 3841 if a
     * local mirror is running. After that, it may or may not check one or several
     * possible servers. And it might throw if there are inconsisencies.
     *
     * Note that 'storageServer' in the returned object might have changed, it
     * will be whichever server fetchData() was able to fetch from (so could be
     * local mirror for example, so be a bit careful with overwriting the original
     * handle that was used).
     *
     * The contents of the shard are decrypted and extracted into 'payload', and
     * 'data' will contain the raw data prior to decryption and extraction, in
     * case callee is interested. Note that to avoid unnecessary duplication of
     * space, it is stored as a 'weakref' - use getData() to safely retrieve.
     * 
     * Note that as a side effect, ChannelApi.knownShards is updated.
     */
    async fetchData(handle: ObjectHandle): Promise<ObjectHandle> {
        if (!handle)
            throw new SBError('[fetchData] No handle provided (cannot accept null or undefined)')
        const s = await this.getStorageServer()
        if (!handle.storageServer)
            handle.storageServer = s
        else if (handle.storageServer !== s)
            console.warn(`[fetchData] handle has different storage server than current server (possibly an error). Handle has '${handle.storageServer}', StorageApi server is '${s}'`)
        const h = validate_ObjectHandle(handle)
        if (ChannelApi.shardBreakpoints.has(h.id)) debugger;
        return fetchDataFromHandle(h)
    }

    /**
     * Convenience wrapper for object handles: returns the 'data' if it's present,
     * returns undefined if it's not, and throws an error if the handle is
     * invalid. Accepts 'undefined' for easier chaining. Note that this is a
     * low-level operation, you probably want to use fetchPayload() instead.
     */
    static getData(handle: ObjectHandle | undefined): ArrayBuffer | undefined {
        if (typeof handle === 'undefined') return undefined
        const h = validate_ObjectHandle(handle)
        return getDataFromHandle(h)
    }


    /**
     * Convenience wrapper for object handles: returns the payload (eg contents of
     * the shard). It can parse out if the payload is already present. If not, it
     * will fetch the data and extract the payload. 
     *
     * Note: this cannot take an undefined parameter, since it cannot return
     * 'undefined' as a non-throwing response (because 'undefined' by itself is a
     * permitted shard content).
     *
     * For the same reason, we can't have a non-throwing 'fetchPayload()' method,
     * that would be analogous to 'getData()'. 
     */
    async fetchPayload(h: ObjectHandle): Promise<any> {
        if (!h) throw new SBError('[fetchPayload] No handle provided (cannot accept null or undefined)')
        if (!h.payload && !h.data)
            h = await this.fetchData(h)
        if (h.payload)
            return h.payload
        if (h.data)
            return StorageApi.getData(h)
        throw new SBError('[fetchPayload] Failed to fetch data or payload')
    }
    

} /* class StorageApi */
