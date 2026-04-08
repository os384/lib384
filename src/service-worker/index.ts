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
const version = `20260402.4`;
const SWDB_VERSION = 41; // always increase this (sigh); used for all DBs

/*!
 * Copyright 2023-2024 384, Inc.
 * "384" and "os384" are registered trademarks.
 * https://384.co
 */

import { SBFile } from '../file/SBFile'
import { fetchPayload } from '../storage/core'

// import { SBFile, fetchPayload } from '../os384/384.esm'

import { SWDB } from './db'

// minimalist generic service worker

// * sometimes main (mother) page preloads 'sb384cache'
// * will return 404 on anything NOT in the cache that's from
//   the same origin (eg 'app' origin)
// * anything else will be deferred to browser policy

// default context is Worker (WorkerGlobalScope) and we need to be the more
// specific Service Worker
declare var self: ServiceWorkerGlobalScope

const DBG0 = false;
declare var DBG2: boolean;

const SERVICE_WORKER_V4 = false
const SERVICE_WORKER_V5 = true

const prefix = `[OS384 Service Worker] [${version}] `;
console.log(prefix + `loaded (version ${version}, DB ${SWDB_VERSION}, origin ${self.origin})`);

const settingsDB = new SWDB('__service_worker', 'settings', SWDB_VERSION);

// this is how service worker keeps track of app id. it's a 12-character hash of the appId
// that the OS Loader provides (using hashString12).
// var myAppId: string | null = null;

// simple mechanism to hash any complex appId to a 12 character string
async function hashString12(input: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 12);
}


class PromiseFactory<T> {
    done = false
    private resolve!: (value: T | PromiseLike<T>) => void;
    private reject!: (reason?: any) => void;
    public promise: Promise<T>;
    constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
    public fulfill(value: T) {
        this.done = true;
        this.resolve(value);
    }
    public fail(reason?: any) {
        this.reject(reason);
    }
}

// this allows us to juggle race conditions; 
let dbName = new PromiseFactory<string>();
let urlDB = new SWDB(dbName.promise, 'url', SWDB_VERSION);

const currentOrigin: string = self.origin;

self.addEventListener('install', async function (_event) {
    console.warn(prefix + `[install] [INFO] Service worker installed (version ${version}) (DB ${SWDB_VERSION})`); // warn just to be visible
    if (DBG0) console.log(prefix + "[install] Opening our settings database")
    await settingsDB.openDB();
    if (dbName.done) throw new Error(prefix + "[activate] dbName already done (?). Fatal. (L78)");
    const savedAppId = await settingsDB.get("APP_ID");
    if(DBG0) console.log(prefix + `[install] ... found AppID from DB: ${savedAppId}. Creating urlDB ...`, savedAppId)
    if (savedAppId && (typeof savedAppId === 'string')) {
        // usually we're just picking up where we left off
        if (DBG0) console.log(prefix + `[activate] ... found AppID from DB: ${savedAppId}. Creating urlDB ...`)
        dbName.fulfill(savedAppId); // propagates to urlDB
        urlDB.openDB() // no need to block
    }
    self.skipWaiting(); // activates the new service worker immediately (needed?)
});


// For future reference, some of these we will want to leverage:
// 1. Install: Triggered on service worker registration. Ideal for initial caching.
// 2. Activate: Occurs when the service worker becomes active. Used for cleaning up
//    resources from previous versions.
// 3. Fetch: Fired for every network request. Can modify or bypass network requests.
// 4. Message: Enables communication between the service worker and its controlled
//    pages.
// 5. Push: Triggered when a push message is received.
// 6. Sync: Fired when a background sync is triggered. Useful for offline actions
//    until a stable network is available.
// 7. Notificationclick: Occurs when a notification is clicked.
// 8. Notificationclose: Fired when a notification is dismissed.
// 9. Periodicsync: Similar to Sync, but for periodic background tasks.
// 10. Backgroundfetchsuccess: Triggered when a background fetch completes
//     successfully.
// 11. Backgroundfetchfail: Triggered when a background fetch fails.
// 12. Backgroundfetchclick: Fired when a background fetch UI is interacted with.
// 13. Backgroundfetchabort: Occurs when a background fetch is aborted.
// 14. Foreignfetch: (Deprecated) Fired for fetches in scopes controlled by another
//     service worker.
// 15. Statechange: Fired when the state of the service worker changes.
// 16. Updatefound: Triggered when a new version of the service worker is found.
// 17. Controllerchange: Occurs when a new service worker takes control of the page.


self.addEventListener('activate', (event: ExtendableEvent) => {
    console.warn(prefix + `activated (version ${version})`); // warn just to be visible
    event.waitUntil(
        (async () => {
            if (DBG0) console.log(prefix + `[activate] Activated (from service worker side) (currentOrigin: ${currentOrigin})`)
            await self.clients.claim(); // take control of the clients
            if (!dbName.done) {
                if (DBG0) console.log(prefix + "[activate] ... AppID NOT found in DB. We will need NEW_APP message.");

                // // we pick somebody to talk to, and ask for app info
                // const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
                // if (!clientList || clientList.length === 0) throw new Error(prefix + "[activate] No clients found. Fatal. (L89)");
                // let client = clientList.find(client => client.focused);
                // if (!client) client = clientList.find(client => client.visibilityState === 'visible');
                // if (!client) client = clientList[0];
                // if (client) {
                //     client.postMessage({
                //         type: 'REQUEST_NEW_APP',
                //         time: new Date().toISOString(),
                //     });
                // }

                // update: nah we send to all clients
                (await self.clients.matchAll()).forEach(c => c.postMessage({ type: 'REQUEST_NEW_APP' }));

                // the waiting for the file info will be done in fetches
            }
        })()
    );
});

async function debugOutput() {
    console.log(prefix + "***************************************** LIST CACHE *****************************************")
    await listCacheContents(sb384cachePromise); // done at some point
    if (urlDB) {
        console.log(prefix + "*****************************************  LIST DB   *****************************************")
        console.log(await urlDB.list())
    }
    console.log(prefix + "**********************************************************************************************")
}

// Define the debugging function to list the contents of a specific cache
async function listCacheContents(cache: Promise<Cache>): Promise<void> {
    const c = await cache;
    const requests = await c.keys();
    if (requests.length === 0) {
        console.log(prefix + "Cache is empty.");
    } else {
        console.log(prefix, `Contents of cache "${c}":`);
        requests.forEach(request => console.log(prefix, request.url));
    }
}

async function clearCache() {
    const cacheNames = await caches.keys();
    if (DBG0) console.log(prefix + 'Clearing cache:', cacheNames)
    await Promise.all(cacheNames.map(name => caches.delete(name)));
}

self.addEventListener('message', async event => {
    console.log(prefix + '[message] Received message:', event);
    try {
        const { data } = event;
        // await firstFetchDebugOutput();
        if (data) {
            const { type, payload } = data;
            if (!type) { console.error(prefix + '[message] Received message without type'); return; }
            switch (type) {
                case "INIT": {
                    console.log(prefix + '[INIT] Received init message from page.');
                } break;
                case "NEW_APP": {
                    if (!payload || !payload.appId)
                        throw new Error(prefix + '[NEW_APP] Received message without appId');

                    // initially we only block on verifying the new and any old app id ('[A]' and '[B]' below)
                    const newAppId = await hashString12(payload.appId); // [A]
                    if (!newAppId || newAppId.length < 12) throw new Error(prefix + '[NEW_APP] Invalid new app id')
                    const oldAppId = dbName.done ? await dbName.promise : null; // [B]

                    if (DBG0)  console.log(prefix + `[NEW_APP] Received new app id '${newAppId}' (old: '${oldAppId}')`);
                    if (newAppId !== oldAppId) {
                        console.warn(prefix + '[NEW_APP] [INFO] Received APP_ID message. Clearing state. New app id:', newAppId, " Old app id:", oldAppId);
                        // first app we get, or we are changing app
                        if (dbName.done) {
                            // something else was running, so we clear that out
                            const oldUrlDB = urlDB;
                            dbName = new PromiseFactory<string>(); // kill old name
                            urlDB = new SWDB(dbName.promise, 'url', SWDB_VERSION); // reset the urlDB
                            // block especially since this might be same DB, and we don't want a race
                            // condition where we might be deleting it after we (below) create it
                            await oldUrlDB.clearAndDeleteDatabase()
                            await clearCache()
                            // sb384cachePromise = caches.open('sb384cache'); // reset the cache
                        }
                        console.log(prefix + '[NEW_APP] Setting new app id:', newAppId);
                        if (newAppId !== oldAppId) await settingsDB.put("APP_ID", newAppId)
                    }

                    // regardless, we make sure urlDB can move forward. if a DB
                    // didn't exist, this will propagate to create it.
                    if (!dbName.done) dbName.fulfill(newAppId)

                    if (payload.fileMetaDataMap) {
                        const fileMetaDataMap: Map<string, SBFile> = payload.fileMetaDataMap;
                        console.log(prefix + `[NEW_APP] processing ${fileMetaDataMap.size} file entries`);
                        await urlDB.openDB(); // needs to be operational to process the map
                        for (const [key, value] of fileMetaDataMap) {
                            const entryName = currentOrigin + value.path + value.name;
                            if (DBG0) console.log(prefix + `[NEW_APP] Setting entry for '${entryName}'`);
                            await urlDB.put(entryName, value);
                            // [20260402] Map directory paths to their index.html so that
                            // e.g. "/" serves "/index.html", "/guide/" serves "/guide/index.html", etc.
                            // Check both the SBFile's fullPath property and the map key.
                            const fullPath = value.fullPath || key;
                            if (value.name === "index.html" || fullPath.endsWith("/index.html")) {
                                const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/") + 1);
                                const dirUrl = currentOrigin + dirPath;
                                console.log(prefix + `[NEW_APP] directory mapping: '${dirUrl}' -> index.html (key='${key}', name='${value.name}', path='${value.path}', fullPath='${value.fullPath}')`);
                                await urlDB.put(dirUrl, value);
                            }
                        }
                        // need to reply back to release 'semapore' in 'OS384Loader.ts'
                        if (event.source && 'id' in event.source) {
                            event.source.postMessage({
                                type: 'FILE_META_DATA_MAP_DONE'
                            });
                            if (DBG0) console.log(prefix + '[NEW_APP] Replied to FILE_META_DATA_MAP message (done loading files)');
                            if (DBG0) await debugOutput();
                        } else {
                            console.error(prefix + '[NEW_APP] Received FILE_META_DATA_MAP message, but no source (event.source.id) so cannot respond');
                        }
                    }



                    // // const oldAppId = myAppId;
                    // // const oldUrlDB = urlDB; // set aside for cleanup
                    // // we fire this off right away, before our even processing gets descheduled, to avoid race conditions
                    // urlDB = new SWDB(hashString12(payload.appId), 'url', SWDB_VERSION) 
                    // urlDB.openDB(); // and we kick it off. we might unnecessarily be re-opening, but, that's for another day
                    // myAppId = await hashString12(payload.appId); // here we block
                    // if (myAppId !== oldAppId) {
                    //     console.warn(prefix + '[APP_ID] [INFO] Received APP_ID message. Clearing state. New app id:', myAppId, " Old app id:", oldAppId);
                    //     // Responding to the sender
                    //     if (event.source && 'id' in event.source) {
                    //         event.source.postMessage({ type: 'RESET' }); // confirming
                    //     } else {
                    //         console.error(prefix + '[APP_ID] Received APP_ID message, but no source (event.source.id) so cannot respond');
                    //     }
                    //     // if we are changing app id, we set new APP_ID, clear all state as best we can
                    //     await Promise.all([
                    //         // ToDo: obscure race conditions around changing app id? have a closer look.
                    //         settingsDB.put("APP_ID", myAppId),
                    //         // note that we have a slight risk of race condition on clearing cache, but that should
                    //         // just lead to a few extra fetches, so we're not too worried about it
                    //         clearCache(), 
                    //         () => { if (oldUrlDB) return oldUrlDB.clearAndDeleteDatabase(); else return Promise.resolve(); }
                    //     ]);
                    // } else {
                    //     if (DBG0) console.log(prefix + "[APP_ID] Received APP_ID message, already MATCHES what we have: ", myAppId);
                    // }
                } break;
                case "SHARD_INFO": {
                    if (!SERVICE_WORKER_V4 && !SERVICE_WORKER_V5) throw new Error("SHARD_INFO message received but SERVICE_WORKER_V4/V5 is not set");
                    // if (DBG0) console.log(prefix + `Received SHARD_INFO message\n`);
                    if (!payload) { console.error(prefix + '[message] Received SHARD_INFO message without payload'); return; }
                    if (!payload.sbFile) { console.error(prefix + '[message] Received SHARD_INFO message without sbFile'); return; }
                    // if (DBG0) console.log(prefix + `Received SHARD_INFO message for '${payload.sbFile.fullPath}'`);
                    // const entry: SBFile = payload.sbFile;
                    const entry: SBFile = new SBFile(payload.sbFile);
                    const entryName = currentOrigin + entry.path + entry.name;
                    if (DBG0) console.log(prefix + `[SHARD_INFO] Setting entry for '${entryName}'`);
                    if (!urlDB) throw new Error(prefix + "urlDB not set. Fatal. (L231)");
                    await urlDB.put(entryName, entry);
                    if (entry.fullPath === "/index.html") {
                        if (DBG0) console.log(prefix + `[SHARD_INFO] Setting entry for '${currentOrigin}/'`);
                        // await saveToDB(currentOrigin + "/", entry.to JSON());
                        await urlDB.put(currentOrigin + "/", entry);
                    }
                } break;
                case "FILE_META_DATA_MAP": {
                    throw new Error("old code");
                    // if (!payload) { console.error(prefix + '[message] Received FILE_META_DATA_MAP message without payload'); return; }
                    // if (!payload.map) { console.error(prefix + '[message] Received FILE_META_DATA_MAP message without map'); return; }
                    // const fileMetaDataMap: Map<string, SBFile> = payload.map;
                    // if (DBG0) console.log(prefix + `[FILE_META_DATA_MAP] message for ${fileMetaDataMap.size} entries`);
                    // // iterate through the set
                    // for (const [_key, value] of fileMetaDataMap) {
                    //     const entryName = currentOrigin + value.path + value.name;
                    //     if (DBG0) console.log(prefix + `[FILE_META_DATA_MAP] Setting entry for '${entryName}'`);
                    //     if (!urlDB) throw new Error(prefix + "urlDB not set. Fatal. (L250)");
                    //     await urlDB.put(entryName, value);
                    //     if (value.fullPath === "/index.html") {
                    //         if (DBG0) console.log(prefix + `[FILE_META_DATA_MAP] Setting entry for '${currentOrigin}/'`);
                    //         await urlDB.put(currentOrigin + "/", value);
                    //     }
                    // }
                    // // need to reply back to release 'semapore' in 'OS384Loader.ts'
                    // if (event.source && 'id' in event.source) {
                    //     event.source.postMessage({
                    //         type: 'FILE_META_DATA_MAP_DONE'
                    //     });
                    //     if (DBG0) console.log(prefix + '[message] Replied to FILE_META_DATA_MAP message (done loading files)');
                    //     if (DBG0) await debugOutput();
                    // } else {
                    //     console.error(prefix + '[message] Received FILE_META_DATA_MAP message, but no source (event.source.id) so cannot respond');
                    // }
                } break;
                case "PING": {
                    if (DBG0) console.log(prefix + '[message] Received PING message');
                } break;
                default: {
                    console.warn(prefix + '[message] Received message with unknown type:', type);
                } return
            }
        } else {
            console.error(prefix + '[message] Received message with no data');
        }
    } catch (error) {
        console.error(prefix + '[message] Error processing message:', error);
    }
});

// const sb384cachePromise = caches.open('sb384cache'); @psm - changed this to a variable so we can reset it on L210
let sb384cachePromise = caches.open('sb384cache');

// async function fetchAndCache(request: Request) {
//     let response: Response;
//     if (DBG0) console.log(prefix + `fetchAndCache(): '${request.url.slice(0, 200) + (request.url.length > 200 ? '...' : '')}'`)
//     try {
//         const url = request.url;
//         switch (LOCAL_POLICY) {
//             case 0:
//                 // 0 = no local files (cache only)
//                 if (DBG2) console.log(prefix + "fetchAndCache - MISS (LOCAL_POLICY=0): ", url);
//                 return new Response('Not Found', { status: 404, statusText: 'Not Found (BLOCKED, LOCAL_POLICY=0)' });
//             case 1:
//                 // 1 = local files
//                 // current web384app default: local cache are served from cache only
//                 if (DBG2) console.log(prefix + "fetchAndCache - MISS (LOCAL_POLICY=1): ", url);
//                 return fetch(request);
//             case 2:
//                 // 2 = local files + cache
//                 response = await fetch(request);
//                 (await sb384cachePromise).put(request, response.clone()) // clone because response body is read-once
//                 if (DBG2) console.log(prefix + "fetchAndCache - MISS (LOCAL_POLICY=2) - will fetch and update cache", url);
//                 return response;
//         }
//     } catch (error) {
//         if (DBG0) console.log("**** [Service Worker] fetchAndCache, getting error on asset: ", error);
//         return new Response('Not Found', { status: 404, statusText: 'Not Found' });
//     }
// }


// NOTE: in our current implementation here, we don't 'await' anything, meaning,
// we don't catch (and report) any errors that might occur during the fetch,
// instead we just let them bubble up and be handled by the browser. a bit unclear
// what is the best approach, so [todo] we might want to revisit.
self.addEventListener('fetch', function (event) {
    const url = event.request.url;
    if (DBG0 || DBG2) console.log(prefix + `[fetch] ${event.request.method} request: '${url.slice(0, 200) + (url.length > 200 ? '...' : '')}'`);
    if ((new URL(event.request.url)).origin !== currentOrigin) {
        // we don't have opinions on requests outside the os384 app origin
        if (DBG0) console.log(prefix + `[fetch] ${event.request.method} request outside currentOrigin, passing on to browser: `, url);
        event.respondWith(fetch(event.request));
    }
    // certain files are 'magical' and cannot be overriden by cache contents (see comments in appDevLoader.ts)
    else if (url.startsWith(currentOrigin + "/web384load.html")) {
        if (DBG0) console.log(prefix + "[fetch]  web384load.html, returning server-side (loader) index.html");
        event.respondWith(fetch(currentOrigin + "/index.html"));
    } else if (url.startsWith(currentOrigin + "/web384reset.html")) {
        if (DBG0) console.log(prefix + "[fetch] web384reset.html, returning server-side reset page");
        event.respondWith(fetch(currentOrigin + "/web384reset.html"));
    } else if (url.startsWith(currentOrigin + "/service-worker.js")) {
        if (DBG0) console.log(prefix + "[fetch] service-worker.js, returning server-side service-worker.js");
        event.respondWith(fetch(currentOrigin + "/service-worker.js"));
    } else {
        if (DBG0) console.log(prefix + `fetch - ${event.request.method} request: `, url);
        // optionally we could have an approach where only certain scopes/domains are looked at
        event.respondWith((async () => {
            // first we try unmodified URL
            const ourCache = await sb384cachePromise;
            let response = await ourCache.match(url);
            if (!response) {
                // if full URL doesn't match we try with skipping '?' etc
                response = await ourCache.match(url, { ignoreSearch: true });
                if (DBG0 && response) console.log(prefix + "[fetch] HIT (with ignoring search): ", url);
            }
            if (response) {
                if (DBG0) console.log(prefix + "[fetch] HIT: ", url, response);
                return response;
            } else {
                if (DBG0) console.log(prefix + "[fetch]MISS (not in cache, local origin): ", url);
                // [20260402] If no APP_ID has been set yet, the urlDB's database name
                // is an unresolved promise — any .get() call would hang until the
                // @timeout decorator fires (12s). Skip the DB lookup entirely and
                // pass through to network immediately.
                if (!dbName.done) {
                    if (DBG0) console.log(prefix + "[fetch] no APP_ID yet, passing through to network:", url);
                    return fetch(event.request);
                }
                if (SERVICE_WORKER_V4 || SERVICE_WORKER_V5) {
                    if (!urlDB) throw new Error(prefix + "urlDB not set. Fatal. (L362)");
                    if (DBG0) console.log(prefix + "[fetch] checking DB for: ", url);
                    let entryName = url;
                    let x = await urlDB.get(entryName);
                    // todo: more homework on how servers/browsers handle matches with/without search yada yada
                    //       for now a pretty naive approach (which might lead to duplicates in the cache for example)
                    if (!x) {
                        const entryNoSearch = url.split('?')[0];
                        if (entryNoSearch !== entryName) {
                            if (DBG0) console.log(prefix + "[fetch] ... not found, checking without search: ", entryNoSearch);
                            x = await urlDB.get(entryNoSearch);
                            if (DBG0) console.log(prefix + "[fetch] ... read from DB found: ", x);
                        }
                    }
                    const entry = x ? new SBFile(x) : null;
                    if (entry) {
                        if (DBG0) console.log(prefix + `[fetch]MISS (not in cache, local origin), but found in DB: '${entryName}'`, '\n', entry);
                        const contents = await fetchPayload(entry); // read the contents (from SBFile entry, this handles large files too)
                        const newResponse = new Response(contents, { headers: { "Content-Type": entry.type! } });
                        await ourCache.put(url, newResponse); // add it to the cache, using original URL

                        // Refetch the response from cache after adding it (presumably more memory efficient)
                        response = await ourCache.match(entryName, { ignoreSearch: true }); // todo: sort out the search thing
                        if (response) {
                            if (DBG0) console.log(prefix + "[fetch]REFETCHED from cache after add from DB: ", entryName);
                            return response;
                        } else {
                            if (DBG0) console.log(prefix + "[fetch]ERROR refetching after add (from DB): ", entryName);
                        }
                    }
                }

                // [20260402] Once an app is loaded, the service worker is the
                // authority for this subdomain. Missing files are genuinely
                // missing — return 404 so the app gets a clean error instead
                // of leaking through to whatever server happens to be on this port.
                if (DBG0) console.log(prefix + `[fetch] not found anywhere, returning 404:`, url);
                return new Response('Not Found', { status: 404, statusText: `Not Found '${url}'` });
            }
        })());
    }
});

// // todo: add default favicon response
// const favIcon = `
//     %3Csvg%20version%3D%221.1%22%20id%3D%22_x33_84%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20xmlns%3Axlink%
//     3D%22http%3A%2F%2Fwww.w3.org%2F1999%2Fxlink%22%20x%3D%220px%22%20y%3D%220px%22%0A%09%20viewBox%3D%220%200%20460%20460%2
//     2%20style%3D%22enable-background%3Anew%200%200%20460%20460%3B%22%20xml%3Aspace%3D%22preserve%22%3E%0A%3Cstyle%20type%3D
//     %22text%2Fcss%22%3E%0A%09.st0%7Bfill%3A%23FF5C42%3B%20fill-rule%3Aevenodd%3B%7D%0A%3C%2Fstyle%3E%0A%3Cpath%20id%3D%22Th
//     ree%22%20class%3D%22st0%22%20d%3D%22M81.3%2C123C56.4%2C158.8-34.5%2C240.1%2C47%2C249.9C150%2C301%2C45.6%2C331.7%2C0%2C3
//     29.3c1%2C24.1%2C2.1%2C47.9%2C2.9%2C72.3%0A%09c33.7-4.1%2C69.3-8.3%2C99.8-36c63-54.8%2C23.5-157.3-34.2-165.1c19.1-29.3%2
//     C47-50.1%2C61.8-83.7c-3-18.8%2C1.7-50.8-5.7-63.3%0A%09c-39.3%2C0-78.6%2C0-118%2C0c-6.9%2C14.8-0.7%2C48.4-2.6%2C69.4L81.
//     3%2C123L81.3%2C123z%22%2F%3E%0A%3Cpath%20id%3D%22Eight%22%20class%3D%22st0%22%20d%3D%22M254.2%2C214.8c69.9-56.7%2C27-18
//     7.3-41.2-167.8c-63%2C3.6-88.6%2C127.1-28.4%2C178.4%0A%09c-62.9%2C48.7-40.8%2C179.2%2C26.9%2C175.7C285.7%2C414.2%2C331.7
//     %2C277.4%2C254.2%2C214.8L254.2%2C214.8z%0A%09M221.1%2C341.9c-24%2C2.9-38.6-38.3-25-71.4c3.4-7.6%2C7.7-19.7%2C13.4-21.5C
//     238.4%2C269.3%2C276.3%2C333.8%2C221.1%2C341.9L221.1%2C341.9z%0A%09M229.6%2C192.1c-23-12.9-56.5-72.5-15.7-85.9C249.1%2C9
//     3.4%2C257.2%2C165.9%2C229.6%2C192.1z%22%2F%3E%0A%3Cpath%20id%3D%22Four%22%20class%3D%22st0%22%20d%3D%22M377.8%2C55.8c-1
//     6.2%2C1.5-37.6-11.2-51-0.9c-10.5%2C89.3-26.6%2C194.5-16.6%2C281.3c26.6%2C4.1%2C60.8-8%2C83.9%2C4.4%0A%09c-3.4%2C75.9%2C
//     3.4%2C45.5%2C39.2%2C53.3c9.9-2.2%2C1.7-42.8%2C4.3-57.5c5.5-2.4%2C17.1%2C5.6%2C19-4.1c-0.5-21.7%2C2.7-42.3%2C3.4-64h-22.
//     5V153.9%0A%09c-65.3%2C2.4-38.3%2C22.9-43.4%2C110.1c-11.6%2C11.9-34.7%2C0.5-49.9%2C4.4C355.4%2C197%2C366.6%2C126.7%2C377
//     .8%2C55.8L377.8%2C55.8z%22%2F%3E%0A%3C%2Fsvg%3E`;


// // DO NOT EDIT the rest here, this is copied from tld.ts
// // (except we use "self.location" instead of "window.location")

// const singleTLDs = new Set([
//     'localhost',
//     'com', 'net', 'org', 'jp', 'de', 'fr', 'br', 'it', 'ru', 'es', 'me', 'gov',
//     'pl', 'ca', 'in', 'nl', 'edu', 'eu', 'ch', 'id', 'at', 'kr', 'cz', 'mx',
//     'be', 'se', 'tr', 'tw', 'al', 'ua', 'ir', 'vn', 'cl', 'sk', 'to', 'no',
//     'fi', 'us', 'pt', 'dk', 'ar', 'hu', 'tk', 'gr', 'il', 'sg', 'ru',
//     'io',
// ]);
// const tldsWithSLDs = {
//     'uk': ['co', 'ac', 'gov', 'org', 'net'],
//     'au': ['com', 'net', 'org', 'edu', 'gov'],
//     'nz': ['co', 'org', 'net', 'edu', 'gov', 'ac', 'gen', 'kiwi', 'maori'],
//     'br': ['com', 'net', 'org', 'gov', 'edu', 'mil'],
//     'jp': ['co', 'ac', 'go', 'or', 'ne'],
//     'kr': ['co', 'go', 'ne', 'or', 're'],
//     'ar': ['com', 'net', 'org', 'gov', 'edu', 'mil'],
//     'il': ['co', 'ac', 'org', 'net', 'gov'],
//     'sg': ['com', 'net', 'org', 'gov', 'edu', 'per'],
// };
// const ipv4Regex = /^\d{1,3}(\.\d{1,3}){3}$/;
// function getDomainDetails(hostname = self.location?.hostname ?? null) {
//     const errorResult = { baseDomain: null, subdomain: null, port: null };
//     if (!hostname) {
//         return errorResult;
//     }
//     const parts = hostname.split('.').reverse();
//     if (parts.length === 0) {
//         return errorResult;
//     }
//     const topLevel = parts[0];
//     const port = self.location?.port ?? null;
//     if (parts.length === 1) {
//         if (topLevel === 'localhost') {
//             return { baseDomain: hostname, subdomain: null, port: port };
//         }
//         else {
//             return errorResult;
//         }
//     }
//     if (ipv4Regex.test(parts.slice(0, 4).reverse().join('.'))) {
//         const baseDomain = parts.slice(0, 4).reverse().join('.');
//         const subdomain = parts.length > 4 ? parts.slice(4).reverse().join('.') : null;
//         return { baseDomain, subdomain, port: port ?? null };
//     }
//     let baseDomain = null;
//     let subdomain = null;
//     if (topLevel === 'localhost') {
//         baseDomain = parts.slice(0, 1).reverse().join('.');
//         subdomain = parts.slice(1).reverse().join('.') || null;
//     }
//     else if (singleTLDs.has(topLevel)) {
//         baseDomain = parts.slice(0, 2).reverse().join('.');
//         subdomain = parts.slice(2).reverse().join('.') || null;
//     }
//     else {
//         if (parts.length < 3) {
//             return { baseDomain: null, subdomain: null, port: port };
//         }
//         const secondLevel = parts[1];
//         const slds = tldsWithSLDs[topLevel];
//         if (slds && slds.includes(secondLevel)) {
//             baseDomain = parts.slice(0, 3).reverse().join('.');
//             subdomain = parts.slice(3).reverse().join('.') || null;
//         }
//         else {
//             return errorResult;
//         }
//     }
//     return { baseDomain, subdomain, port: port };
// }

// not using this anymore
// const doNotCacheList = new Set([
//     'channel.384co.workers.dev',
//     'channel.384.dev',
//     'localhost',
//     'localhost:3845',
//     'localhost:3841',
//     'localhost:3843',
//     'localhost:4001',
//     'c.somethingstuff.workers.dev',
//     'c.384co.workers.dev',
//     'shard.3.8.4.land',
//     'storage.384.dev',
//     'storage.384co.workers.dev',
// ]);

// archived for now:

// self.addEventListener('fetch', async function (event) {
//     if (event.request.method === "GET") {
//         const url = event.request.url;
//         if (DBG0) console.log(prefix + "[fetch] GET request: ", url);
//         // const response = (await sb384cachePromise).match(url, { ignoreSearch: true });
//         const response = await (await sb384cachePromise).match(url);
//         if (response) {
//             if (DBG0) console.log(prefix + "[fetch] HIT: ", url, response);
//             event.respondWith(response);
//         } else if (url.startsWith(currentOrigin)) {
//             event.respondWith(fetchAndCache(event.request));
//         }
//     } else {
//         if (DBG2) console.log(prefix + "[fetch] non-GET request, ignoring (no-op?) ", event.request.url);
//     }
// });


// we're not using donotcachelist:
// if (doNotCacheList.has((new URL(url)).hostname)) {
//     if (DBG0) console.log(prefix + "... not caching (on doNotCacheList): ", url);
//     ... fall through to fetch
// }

// self.addEventListener('fetch', function (event) {
//     if (event.request.method === "GET") {
//         event.respondWith(fetchAndCache(event.request));
//     } else {
//         if (DBG0) console.log(prefix + "[fetch] non-GET request, ignoring (no-op?) ", event.request.url);
//     }
// });

// // we need to modify so that it is forcing fetching of "/index.html"
// event.respondWith((async () => {
//     const response = await fetchAndCache(new Request(currentOrigin + "/index.html"));
//     if (response) {
//         if (DBG0) console.log(prefix + "[fetch] HIT: ", url, response);
//         return response;
//     } else {
//         return(new Response('Not Found', { status: 404, statusText: 'Not Found (BLOCKED, LOCAL_POLICY=0)' }));
//     }
// }
// )());


// if (DBG0) {
//     let count = 0;
//     const theInterval = setInterval(() => {
//         debugOutput();
//         if (count++ > 4) {
//             clearInterval(theInterval)
//         }
//     }, 6000);
// }

// async function firstFetchDebugOutput() {
//     if (firstFetch) {
//         firstFetch = false;
//         await debugOutput();
//     }
// }

// self.addEventListener('activate', (event) => {
//     console.log('Service Worker: Activated');
//     event.waitUntil(
//         caches.keys().then((keyList) => {
//             return Promise.all(keyList.map((key) => {
//                 if (key !== 'v1') {
//                     console.log('Service Worker: Removing old cache', key);
//                     return caches.delete(key);
//                 }
//             }));
//         })
//     );
//     return self.clients.claim(); // Takes control of clients immediately
// });


// // previous (working version), the above code is potentially less fragile
// self.addEventListener('activate', function (_event: ExtendableEvent) {
//     if (DBG0) console.log(prefix + `activated (this is from service worker side) (version ${version})`);

//     // archived - we don't do this anymore
//     // const { baseDomain } = getDo2mainDetails();
//     // if (DBG0) console.log(prefix + `adding ${baseDomain} to doNotCacheList (from ${self.location})`);
//     // doNotCacheList.add(baseDomain);

//     self.clients.claim();
//     if (DBG0) console.log(prefix + "currentOrigin: ", currentOrigin)
//     self.clients.matchAll().then(function (clients) {
//         clients.forEach(function (client) {
//             client.postMessage("++++ [Service Worker] activated");
//         });
//     });
// });