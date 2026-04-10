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
import { ObjectHandle } from 'src/storage/ObjectHandle';
import { SBFileSystem } from 'src/file/SBFileSystem';
import { Retry } from 'src/utils/timeout';

// import { SBFile } from 'src/file/SBFile';
// import { SWDB } from 'src/service-worker/db';
// import { fetchPayload } from '../storage/core'

const DBG0 = false;
const DBG2 = false;

const sb384CacheName = 'sb384cache';

// make sure this is the same as in the service worker
// const urlDB = new SWDB('__shard_map', 'urlToSBFile');

// const currentOrigin: string = self.origin;

const navigatorObject = ('serviceWorker' in navigator) ? navigator : null;
// if (DBG2) console.log("[SBServiceWorker] navigatorObject: ", navigatorObject);

// let serviceWorkerFunctional = false;
// (globalThis as any).serviceWorkerFunctional = serviceWorkerFunctional;

let serverPrefix: string = "<unknown>"
if (globalThis.location) {
    serverPrefix = globalThis.location.protocol + "//" + globalThis.location.host
    if (DBG2) console.log("[SBServiceWorker] serverPrefix: ", serverPrefix);
}

// here is how we might prime it:

// // note that the actual data is in globalBufferMap.get(uniqueShardId)
// for (const key of this.finalFileList.keys()) {
//     let entry = this.finalFileList.get(key);
//     if (entry.type !== "directory") {
//         if (DBG2) console.log(`... kicking off cacheResource for ${key} (${entry.path + entry.name})`)
//         cacheResource(entry.path + entry.name, entry.uniqueShardId, entry.type, this.globalBufferMap);
//     }
// }

// console.log(navigator.serviceWorker);

/** @internal */
export class SBServiceWorker {
    // sb384cachePromise: Promise<Cache | undefined>;
    #sb384cache: Cache | undefined;
    #sbfs: SBFileSystem;
    #scope: string | undefined;
    #cacheName: string;
    // serviceWorkerReadyPromise: Promise<void>;
    ready: Promise<boolean>;

    /**
     * @param sbfs       — the SBFileSystem to use for fetching payloads
     * @param messageHandler — handler for messages from the service worker
     * @param options    — optional configuration
     * @param options.scope — SW registration scope (e.g. '/abcdef12/' for static mode)
     * @param options.cacheName — override the default cache name (for namespace isolation)
     */
    constructor(sbfs: SBFileSystem, messageHandler: (event: MessageEvent) => void, options?: { scope?: string, cacheName?: string }) {
        this.#sbfs = sbfs;
        this.#scope = options?.scope;
        this.#cacheName = options?.cacheName || sb384CacheName;
        if (DBG0) console.warn(`[SBServiceWorker] [constructor] ++++ setting up file helper service worker (${serverPrefix}) `)
        if (DBG2) console.log("[SBServiceWorker] [constructor ++++ SBFS:", this.#sbfs);
        this.ready = new Promise(async (resolve, _reject) => {
            try {
                this.#sb384cache = await caches.open(this.#cacheName)
                resolve(await this.setupServiceWorker(messageHandler))
            } catch (e) {
                console.error("[SBServiceWorker] [constructor] Error setting up service worker: " + e)
                resolve(false);
            }
        });
    }

    @Retry(2)
    async postMessage(message: any) {
        if (await this.ready === false) {
            const msg = "[SBServiceWorker] 'ready' is false (?) ... cannot post any messages"
            console.error(msg)
            throw new Error(msg);
        }
        if (!navigatorObject) {
            const msg = "[SBServiceWorker] 'ready' is null or false (?) or no navigatorObject ... cannot post any messages"
            console.error(msg)
            throw new Error(msg);
        }
        if ((navigatorObject.serviceWorker) && (navigatorObject.serviceWorker.controller)) {
            navigatorObject.serviceWorker.controller.postMessage(message);
        } else {
            const msg = '[SBServiceWorker] ' + (navigatorObject.serviceWorker ? 'No service worker. ' : '') + (navigatorObject.serviceWorker.controller ? 'No controller. ' : '') + 'Cannot post message to service worker.';
            console.error(msg, '\n', "Message that will be dropped:\n", message)
            throw new Error(msg);
        }
    }

    async setupServiceWorker(messageHandler: (event: MessageEvent) => void): Promise<boolean> {
        if (!navigatorObject) {
            console.error("[SBServiceWorker] ERROR: navigator.serviceWorker is not available")
            return Promise.reject("[SBServiceWorker] ERROR: navigator.serviceWorker is not available");
        }
        try {
            // In scoped mode (static.384.dev), register with an explicit
            // scope so the SW only controls /<prefix>/ paths.  The SW file
            // lives at the root, so the server must send
            // `Service-Worker-Allowed: /` for this to work.
            const swRegOpts: RegistrationOptions | undefined = this.#scope
                ? { scope: this.#scope }
                : undefined;
            const swScript = this.#scope
                ? '/service-worker.js'   // absolute path — needed for scoped registration
                : 'service-worker.js';   // relative — original behavior

            const setOfRegistrations = await navigatorObject.serviceWorker.getRegistrations()
            if (setOfRegistrations.length > 1) {
                console.error("[devLoader] ERROR: we should never have MANY service workers registered")
                for (let registration of setOfRegistrations) {
                    console.log("[devLoader] ++++ unregistering service worker: ", registration)
                    await registration.unregister();
                }
                if (DBG0) console.log('[SBServiceWorker] ++++ ... finished unregistering, registering a fresh one');
                await navigatorObject.serviceWorker.register(swScript, swRegOpts);
            } else if (setOfRegistrations.length === 1) {
                if (DBG0) console.log("[devLoader] ++++ we already have a service worker registered")
            } else {
                if (DBG0) console.log('[SBServiceWorker] ++++ Did not have a service worker, registering one');
                await navigatorObject.serviceWorker.register(swScript, swRegOpts);
            }

            if (DBG0) console.log('[SBServiceWorker] ++++ waiting for service worker to be ready then setting up message handler');
            await navigatorObject.serviceWorker.ready;
            navigatorObject.serviceWorker.addEventListener('message', messageHandler);

            if (!navigatorObject.serviceWorker.controller) {
                // First SW registration: clients.claim() hasn't fired yet.
                // Wait for the controllerchange event (fires when the SW
                // calls clients.claim() during activation) instead of
                // the fragile reload-once pattern.
                console.log("[SBServiceWorker] No controller yet, waiting for controllerchange ...");
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error("[SBServiceWorker] Timed out waiting for controllerchange (15s)"));
                    }, 15_000);
                    navigatorObject!.serviceWorker.addEventListener('controllerchange', () => {
                        clearTimeout(timeout);
                        console.log("[SBServiceWorker] controllerchange fired — SW now controls the page.");
                        resolve();
                    }, { once: true });
                });
            }

            // At this point we have a controller
            sessionStorage.removeItem('swReloaded'); // clean up any stale flag from old code
            console.log("[SBServiceWorker] Service worker is ready and controlling the page.");
            navigatorObject.serviceWorker.controller!.postMessage({ type: 'INIT' });
            return true;

            // // verify we have controller, otherwise we probably need to reload
            // if (!navigatorObject.serviceWorker.controller) {
            //     console.warn("[SBServiceWorker] No controller after registration, reloading page.");
            //     globalThis.location.reload(); // ToDo: use session storage to avoid this looping
            //     return false; // we should never get here
            // } else {
            //     console.log("[SBServiceWorker] ++++ service worker is ready .. sending init message to it")
            //     navigatorObject.serviceWorker.controller.postMessage({ type: 'INIT' });
            //     return true;
            // }
        } catch (e) {
            console.error("[SBServiceWorker] Error registering service worker: " + e);
            return false;
        }
    }

    // older approach, now we send handle info
    async cacheResourceFromArrayBuffer(fileName: string, mimeType: string, arrayBuffer: ArrayBuffer): Promise<void> {
        if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
            const msg = `[SBServiceWorker] Got empty or no data or not an array buffer for cacheResource()`
            console.error(msg)
            return Promise.reject(msg);
        }
        await this.ready;
        if ((!this.ready) || (!this.#sb384cache)) {
            const msg = "[SBServiceWorker] 'ready' or 'sb384cache' is null ... cannot cache any resources"
            console.error(msg)
            return Promise.reject(msg);
        }
        if (fileName === "/index.html") {
            if (DBG0) console.log("[SBServiceWorker] **** automatically adding '/' for '/index.html'")
            await this.cacheResourceFromArrayBuffer("/", mimeType, arrayBuffer);
        }
        
        if (DBG0) console.log(`[SBServiceWorker] Got data for ${fileName} cacheResourceFromArrayBuffer()`, arrayBuffer);

        // create Response to the cache using the file name as the key
        const response = new Response(arrayBuffer, { status: 200, headers: { 'Content-Type': mimeType } });
        await this.#sb384cache!.put(fileName, response);

        // Verify that the response is now in the cache - ToDo: can probably optimize and not block
        const cachedResponse = await this.#sb384cache!.match(fileName);
        if (cachedResponse) {
            if (DBG2) console.log('Response successfully cached:', cachedResponse);
        } else {
            console.error(`**** Response was not cached **** '${fileName}'`, response);
        }
    }

    // older api, we now send meta data and handles
    async cacheResourceFromHandle(fileName: string, mimeType: string, handle: ObjectHandle): Promise<void> {
        if (DBG0) console.log(`[SBServiceWorker] Caching resource '${fileName}' mimeType '${mimeType}' from handle:`, handle);
        handle = await this.#sbfs.SB.storage.fetchData(handle) as ObjectHandle; // todo: why can this return void?
        if (!handle || !handle.payload) throw new Error(`[SBServiceWorker] Error fetching data for handle ${handle}`);
        if (DBG0) console.log(`[SBServiceWorker] Caching resource for '${fileName}' from handle, got finalized handle:\n`, handle);
        return this.cacheResourceFromArrayBuffer(fileName, mimeType, handle.payload)
    }

    // async cacheResourceFromDB(f: SBFile) {
    //     await this.ready;
    //     const key = currentOrigin + f.path + f.name;
    //     if (DBG0) console.log(`[SBServiceWorker] Caching resource '${key}' through DB`);
    //     await urlDB.put(key, f);
    //     if (f.fullPath === "/index.html") {
    //         if (DBG0) console.log(`[SBServiceWorker] **** automatically adding '/' for '/index.html'`);
    //         await urlDB.put(currentOrigin + "/", f);

    //     }
    //     if (DBG0) console.log(`[SBServiceWorker] ... done putting resource '${key}' into DB (and possibly '/')`);
    // }

}



        // this.#sbfs.server.storage.fetchData(handle)
        //     .then(async (arrayBuffer) => {
        //         // Create a Response object with the ArrayBuffer and MIME type
        //         const response = new Response(arrayBuffer, {
        //             status: 200, // this part seems to be browser/OS dependent
        //             headers: { 'Content-Type': mimeType },
        //         });
        //         // Add the Response to the cache using the file name as the key
        //         await this.#sb384cache!.put(fileName, response);
        //         // Verify that the response is now in the cache
        //         const cachedResponse = await this.#sb384cache!.match(fileName);
        //         if (cachedResponse) {
        //             if (DBG2) console.log('Response successfully cached:', cachedResponse);
        //         } else {
        //             console.error(`**** Response was not cached **** '${fileName}'`, response);
        //         }
        //     })
        //     .catch((err) => {
        //         console.error(`[SBServiceWorker] Error fetching data for handle ${handle}: ${err}`)
        //     });

        
    // // older approach, when being tested from inside multi file handler (where a globalbuffer map was available)
    // async cacheResource(fileName: string, uniqueShardId: string, mimeType: string, bufferMap: Map<any, any>): Promise<void> {
    //     if (!serviceWorkerFunctional) {
    //         console.error("service worker is not operational")
    //         return Promise.resolve();
    //     }
    //     if (fileName === "/service- worker.js" /* fileName.endsWith("service-worker. js") */) {
    //         console.log("**** special override: self-virtualizing service worker (/service-worker. js)")
    //         return Promise.resolve();
    //     }
    //     if (fileName === "/index.html") {
    //         console.log("**** special override: index.html can also be accessed as '/'")
    //         await this.cacheResource("/", uniqueShardId, mimeType, bufferMap);
    //     }
    //     if (DBG0) console.log(`Caching resource '${fileName}' with uniqueShardId '${uniqueShardId}' and mimeType '${mimeType}'`);
    //     const cache = (await this.sb384cachePromise);
    //     let arrayBuffer = bufferMap.get(uniqueShardId);

    //     // Create a Response object with the ArrayBuffer and MIME type
    //     const response = new Response(arrayBuffer, {
    //         status: 200, // this part seems to be browser/OS dependent
    //         headers: { 'Content-Type': mimeType },
    //     });
    //     // Add the Response to the cache using the file name as the key
    //     await cache!.put(fileName, response);
    // }