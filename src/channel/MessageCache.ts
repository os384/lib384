// (c) 2024 384 (tm)

import { ChannelId, SBError } from '../common';

const DBG0 = false
const DBG2 = false
export const DEBUG0 = true;  // when not used, set to = DBG2

const SEP = '\n' + '+'.repeat(76) + '\n'

function _assert(val: unknown, msg: string) {
    if (!(val)) {
        const m = ` <<<<[_sb_assert] assertion failed: '${msg}'>>>> `;
        if (DBG0) console.trace(m)
        throw new SBError(m);
    }
}

/** @internal */
export class MessageCache {
    readyPromise: Promise<MessageCache>;
    db?: IDBDatabase;
    dbName = "MessageCache";
    dbVersion = 6;
    #workInMemory = false;
    #inMemoryDB: Map<string, ArrayBuffer>;

    // quick lookup of everything that has been *seen* for this instance (eg
    // there may be more in the local storage, but it does meant that if the key
    // is 'known' that it and it's value is in the cache)
    knownMessageKeys: Set<IDBValidKey> = new Set();

    constructor() {
        this.#inMemoryDB = new Map();
        this.readyPromise = new Promise((resolve, reject) => {
            if ('indexedDB' in globalThis) {
                const request = indexedDB.open(this.dbName, this.dbVersion);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(this.dbName)) {
                        db.createObjectStore(this.dbName, { keyPath: "key" });
                        if (DBG0) console.log("++++ onupgradeneeded called, created object store");
                    }
                };
                request.onsuccess = () => { this.db = request.result; if (DBG2) console.log("++++ SUCCESS in opening"); resolve(this); };
                request.onerror = () => { reject(`**** Database error ('${this.dbName}): ` + request.error); };
            } else {
                this.#workInMemory = true;
                resolve(this);
            }
        });
    }

    async getObjStore(mode: IDBTransactionMode = "readonly"): Promise<IDBObjectStore | Map<string, any>> {
        await this.readyPromise;
        if (this.#workInMemory) {
            return this.#inMemoryDB;
        } else {
            _assert(this.db, "Internal Error [L0032]");
            const transaction = this.db!.transaction(this.dbName, mode);
            const objectStore = transaction.objectStore(this.dbName);
            _assert(objectStore, "Internal Error [L0035]");
            if (DBG2) console.log("++++ getObjStore done", objectStore);
            return objectStore;
        }
    }

    async add(key: string, value: ArrayBuffer): Promise<void> {
        if (!(value instanceof ArrayBuffer)) throw new SBError("Value not an ArrayBuffer. Internal Error [L0190]")
        if (this.#workInMemory) {
            this.#inMemoryDB.set(key, value);
            this.knownMessageKeys.add(key);
            if (DBG2) console.log("Success in storing with key", key);
            return;
        } else {
            return new Promise(async (resolve, reject) => {
                const objectStore = await this.getObjStore("readwrite") as IDBObjectStore;
                const request = objectStore.put({ key: key, value: value }); // overwrites if present
                request.onsuccess = () => { if (DBG2) console.log("Success in storing with key", key); resolve(); };
                request.onerror = () => { reject('[add] Received error accessing keys'); };
                this.knownMessageKeys.add(key);
            });
        }
    }

    async get(key: string): Promise<ArrayBuffer | undefined> {
        if (this.#workInMemory) {
            return this.#inMemoryDB.get(key);
        } else {
            return new Promise(async (resolve, reject) => {
                const objectStore = await this.getObjStore()
                const request = objectStore.get(key);
                request.onsuccess = () => { resolve(request.result?.value); };
                request.onerror = () => { reject('[get] Received error accessing keys'); };
            });
        }
    }

    async getKnownMessageKeys(channelId: ChannelId, timestampPrefix: string, i2?: string): Promise<Set<string>> {
        if (this.#workInMemory) {
            const [lower, upper] = this.getLowerUpper(channelId, timestampPrefix, i2);
            const result = new Set<string>();
            for (let key of this.#inMemoryDB.keys()) {
                if (key >= lower && key <= upper) {
                    result.add(key);
                    this.knownMessageKeys.add(key);
                }
            }
            return result;
        } else {
            return new Promise(async (resolve, reject) => {
                const objectStore = await this.getObjStore() as IDBObjectStore;
                const [lower, upper] = this.getLowerUpper(channelId, timestampPrefix, i2)
                const keyRange = IDBKeyRange.bound(lower, upper, false, false);
                const getAllKeysRequest = objectStore?.getAllKeys(keyRange);
                if (!getAllKeysRequest) resolve(new Set()); // unable to set up query
                // getAllKeysRequest!.onsuccess = () => { resolve(new Set(getAllKeysRequest!.result) as Set<ChannelMessage>); }; // IDBValidKey can be string
                getAllKeysRequest!.onsuccess = () => {
                    const result = new Set(getAllKeysRequest!.result);
                    this.knownMessageKeys = new Set([...this.knownMessageKeys, ...result]);
                    resolve(new Set(result) as Set<string>);
                };
                getAllKeysRequest!.onerror = () => { reject('[getKnownMessageKeys] Received error accessing keys'); };
            });
        }
    }

    async getKnownMessages(channelId: ChannelId, timestampPrefix: string, i2?: string): Promise<Map<string, ArrayBuffer>> {
        if (this.#workInMemory) {
            const [lower, upper] = this.getLowerUpper(channelId, timestampPrefix, i2);
            const result = new Map<string, any>();
            for (let [key, value] of this.#inMemoryDB) {
                if (key >= lower && key <= upper) {
                    result.set(key, value);
                    this.knownMessageKeys.add(key);
                }
            }
            return result;
        } else {
            return new Promise(async (resolve, reject) => {
                const objectStore = await this.getObjStore() as IDBObjectStore;
                const [lower, upper] = this.getLowerUpper(channelId, timestampPrefix, i2)
                const keyRange = IDBKeyRange.bound(lower, upper, false, false);
                const getAllRequest = objectStore?.getAll(keyRange);
                if (!getAllRequest) {
                    if (DBG2) console.log("++++ [getKnownMessages] unable to set up query (returning empty map")
                    resolve(new Map()); // unable to set up query
                }
                // getAllRequest!.onsuccess = () => { resolve(new Map(getAllRequest!.result) as Map<string, any>); };
                getAllRequest!.onsuccess = () => {
                    const result = getAllRequest!.result
                    if (DBG2) console.log(SEP, "++++ [getKnownMessages] result:", SEP, result, SEP)
                    this.knownMessageKeys = new Set([...this.knownMessageKeys, ...result.keys()]);
                    resolve(new Map<string, any>(result.map((item: { key: string; value: any }) => [item.key, item.value])));
                };
                getAllRequest!.onerror = () => { reject('[getKnownMessages] Received error accessing keys'); };
            });
        }
    }

    getLowerUpper(channelId: ChannelId, timestampPrefix: string, i2?: string): [string, string] {
        const sep = i2 ? `_${i2}_` : '______';
        const lowerBound = channelId + sep + timestampPrefix.padEnd(26, '0');
        const upperBound = channelId + sep + timestampPrefix.padEnd(26, '3');
        return [lowerBound, upperBound];
    }
}



/* For reference, cache code without in-memory option */
/******************************************************************************************************/
//#region - Non-in-memory Message Caching
// const SB_MESSAGE_CACHE_DB_NAME = "MessageCache"
// class MessageCache {
//     readyPromise: Promise<MessageCache>;
//     db?: IDBDatabase;
//     dbName = SB_MESSAGE_CACHE_DB_NAME
//     dbVersion = 6
//     #workInMemory = false
//     constructor() {
//         // if (!('indexedDB' in globalThis)) throw new SBError("IndexedDB not supported, cannot create MessageCache (nor ChannelStream)")
//         this.readyPromise = new Promise((resolve, reject) => {
//             if ('indexedDB' in globalThis) {
//                 const request = indexedDB.open(this.dbName, this.dbVersion);
//                 request.onupgradeneeded = () => {
//                     const db = request.result;
//                     if (!db.objectStoreNames.contains(this.dbName)) {
//                         db.createObjectStore(this.dbName, { keyPath: "key" });
//                         if (DBG0) console.log("++++ onupgradeneeded called, created object store")
//                     }
//                 };
//                 request.onsuccess = () => { this.db = request.result; if (DBG0) console.log("++++ SUCCESS in opening"); resolve(this); };
//                 request.onerror = () => { reject(`**** Database error ('${this.dbName}): ` + request.error); };
//             } else {
//                 this.#workInMemory = true
//                 resolve(this)
//             }
//         });
//     }
//     async getObjStore(mode: IDBTransactionMode = "readonly"): Promise<IDBObjectStore> {
//         await this.readyPromise
//         _assert(this.db, "Internal Error [L0032]")
//         const transaction = this.db?.transaction(SB_MESSAGE_CACHE_DB_NAME, mode);
//         const objectStore = transaction?.objectStore(SB_MESSAGE_CACHE_DB_NAME);
//         _assert(objectStore, "Internal Error [L0035]")
//         if (DBG0) console.log("++++ getObjStore done", objectStore)
//         return objectStore!
//     }
//     // insert KV entry as { key: key, value: value }
//     async add(key: string, value: any): Promise<void> {
//         return new Promise(async (resolve, reject) => {
//             const objectStore = await this.getObjStore("readwrite")
//             const request = objectStore.put({ key: key, value: value }); // overwrites if present
//             request.onsuccess = () => { if (DBG0) console.log("Success in storing with key", key); resolve(); };
//             request.onerror = () => { reject('[add] Received error accessing keys'); };
//         });
//     }
//     // fetch an entry, returning the value
//     async get(key: string): Promise<ChannelMessage | undefined> {
//         return new Promise(async (resolve, reject) => {
//             const objectStore = await this.getObjStore()
//             const request = objectStore.get(key);
//             request.onsuccess = () => { resolve(request.result?.value); };
//             request.onerror = () => { reject('[get] Received error accessing keys'); };
//         });
//     }
//     getLowerUpper(channelId: ChannelId, timestampPrefix: string, i2?: string): [string, string] {
//         const sep = i2 ? `_${i2}_` : '______'
//         const lowerBound = channelId + sep + timestampPrefix.padEnd(26, '0')
//         const upperBound = channelId + sep + timestampPrefix.padEnd(26, '3');
//         return [lowerBound, upperBound]
//     }
//     async getKnownMessageKeys(channelId: ChannelId, timestampPrefix: string, i2?: string): Promise<Set<string>> {
//         return new Promise(async (resolve, reject) => {
//             const objectStore = await this.getObjStore()
//             const [lower, upper] = this.getLowerUpper(channelId, timestampPrefix, i2)
//             const keyRange = IDBKeyRange.bound(lower, upper, false, false);
//             const getAllKeysRequest = objectStore?.getAllKeys(keyRange);
//             if (!getAllKeysRequest) resolve(new Set()); // unable to set up query
//             // getAllKeysRequest!.onsuccess = () => { resolve(new Set(getAllKeysRequest!.result) as Set<ChannelMessage>); }; // IDBValidKey can be string
//             getAllKeysRequest!.onsuccess = () => { resolve(new Set(getAllKeysRequest!.result) as Set<string>); };
//             getAllKeysRequest!.onerror = () => { reject('[getKnownMessageKeys] Received error accessing keys'); };
//         });
//     }
//     async getKnownMessages(channelId: ChannelId, timestampPrefix: string, i2?: string): Promise<Map<string, any>> {
//         return new Promise(async (resolve, reject) => {
//             const objectStore = await this.getObjStore()
//             const [lower, upper] = this.getLowerUpper(channelId, timestampPrefix, i2)
//             const keyRange = IDBKeyRange.bound(lower, upper, false, false);
//             const getAllRequest = objectStore?.getAll(keyRange);
//             if (!getAllRequest) {
//                 if (DBG0) console.log("++++ [getKnownMessages] unable to set up query (returning empty map")
//                 resolve(new Map()); // unable to set up query
//             }
//             // getAllRequest!.onsuccess = () => { resolve(new Map(getAllRequest!.result) as Map<string, any>); };
//             getAllRequest!.onsuccess = () => {
//                 const result = getAllRequest!.result
//                 if (DBG0) console.log(SEP, "++++ [getKnownMessages] result:", SEP, result, SEP)
//                 resolve(new Map<string, any>(result.map((item: { key: string; value: any }) => [item.key, item.value])));
//             };
//             getAllRequest!.onerror = () => { reject('[getKnownMessages] Received error accessing keys'); };
//         });
//     }
// }
//#endregion - Non-in-memory Message Caching