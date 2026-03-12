// (c) 2023 384 (tm)

import { ObjectHandle } from '../storage/ObjectHandle';
import { base62ToArrayBuffer } from '../utils/b62';
import { extractPayload } from '../utils/payloads';
import { base64ToBase62 } from '../utils/index';
import { StorageApi } from '../storage/StorageApi';

/** @internal */
function deCryptShard(data: ObjectHandle): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        crypto.subtle.importKey("raw", base62ToArrayBuffer(data.key!), "PBKDF2", false, ['deriveBits', 'deriveKey'])
            .then((keyMaterial) => {
                crypto.subtle.deriveKey({
                    'name': 'PBKDF2',
                    'salt': data.salt as ArrayBuffer,
                    'iterations': 100000,
                    'hash': 'SHA-256'
                }, keyMaterial, { 'name': 'AES-GCM', 'length': 256 }, true, ['encrypt', 'decrypt'])
                    .then((key) => {
                        crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.iv as Uint8Array }, key, StorageApi.getData(data)!)
                            .then((padded) => {
                                let actualSize = new DataView(padded.slice(-4)).getUint32(0)
                                resolve(padded.slice(0, actualSize));
                            }).catch(() => { reject('error decrypting shard'); })
                    }).catch(() => { reject('unable to derive key'); })
            })
            .catch(() => { reject('unable to import key') })
    })
}

/** @internal */
export function loadShard(shard: ObjectHandle, storageServer: string = 'http://localhost:3841') {
    console.log("[loadShard] ++++ Using the following shard to load the library: ", shard);
    return new Promise<ArrayBuffer>((resolve, reject) => {
        const codeShardFetch = `${storageServer!}/api/v2/fetchData?id=${shard.id}&verification=${shard.verification}`
        fetch(codeShardFetch)
            .then((res) => res.arrayBuffer())
            .then((payload) => {
                let data: ObjectHandle = extractPayload(payload).payload
                console.log('[loadShard] payload: ', payload)
                console.log('[loadShard] data: ', data)
                if (shard.version == '1') {
                    data.key = base64ToBase62(shard.key!)
                } else if (shard.version == '2' || shard.version == '3') {
                    data.key = shard.key!
                } else {
                    reject(`unknown or missing shard version: ${shard}`)
                }
                deCryptShard(data).then((decrypted) => {
                    resolve(decrypted);
                }).catch(() => { reject('unable to decrypt'); })
            })
            .catch((err) => {
                if (`${err}`.match('"ror":"cann"')) reject('shard not found')
                else reject(`failed to fetch or process shard: ${err}`)
            })
    })
}

/** @internal */
export function loadLibraryCode(shard: ObjectHandle) {
    return new Promise<void>((resolve, reject) => {
        loadShard(shard)
            .then((decrypted) => {
                let jslibText = new TextDecoder("utf-8").decode(decrypted);
                const script = document.createElement('script');
                script.textContent = jslibText;
                document.head.append(script);
                console.log("'globalThis.SB' object (library loaded) should be available in the console.")
                resolve()
            })
            .catch(() => { reject('unable to fetch shard'); })
    })
}

// ToDo: these shards are VERY outdated
/** @internal */
export function bootstrapJsLib() {
    const jsLib = (
        (globalThis as any).configuration 
        && (globalThis as any).configuration.jslibShardHandle)
        ? (globalThis as any).configuration.jslibShardHandle
        : {

            // '2.0.0 (pre) build 03'
            version: "2",
            type: "p",
            id: "6bpz2xOwq9eCG9ZZzF4P0LMoydo89lgJg2TkJFvZvKx",
            key: "GxQ6at56Lv1p8V8AFZqQZur4MEKyiZzEMFpiyPnZYv0",
            actualSize: 247612,
            verification: "8117233191337661625",
            fileName: "384.iife.js",
            shardServer: "https://shard.3.8.4.land",
            lastModified: 1701294057573,

        }

    console.log("[boot.loadshard] ++++ Using the following shard to load the library: ", jsLib);

    return loadLibraryCode(jsLib);
}
