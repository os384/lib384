// (c) 2024 384 (tm)

const DBG0 = true;
const DBG2 = true;
const TIMEOUT = 12000; // yes, it can take a while in certain cases

import { Timeout } from '../utils/timeout';

/**
 * Wrapper for IndexedDB in a Service Worker. Note that the name of the database
 * is a Promise, so that it can be resolved lazily depending on conditions in
 * the service worker.
 */
export class SWDB {
    prefix: Promise<string>
    protected dbPromise: Promise<IDBDatabase> = null as any;

    constructor(public dbName: Promise<string> | string, public storeName: string, public version = 5) {
        // resolvedPrefix = `[SWDB ${dbName}/${storeName}] `;
        this.prefix = (async () => {
            try {
                const resolvedName = typeof dbName === 'string' ? dbName : await dbName;
                return `[SWDB ${resolvedName}/${storeName}] `;
            } catch (err) {
                console.error(`Failed to resolve dbName:`, err);
                return `[SWDB unknown/${storeName}] `;
            }
        })();
        if ('indexedDB' in globalThis)
            this.dbPromise = this.dbPromiseFactory();
        else
            console.error(`[openDB] indexedDB not supported`);
    }

    protected dbPromiseFactory(): Promise<IDBDatabase> {
        return new Promise(async (resolve, reject) => {
            const resolvedPrefix = await this.prefix;
            if (!('indexedDB' in globalThis)) {
                console.error(resolvedPrefix + `[openDB] indexedDB not supported`);
                reject(new Error('We are not in a browser. No SWDB support.'));
                return;
            }
            const theName = await this.dbName;
            if (DBG0) console.log(resolvedPrefix + `[openDB] Resolved the dbname: '${theName}' proceeding to open ...`);
            const request = indexedDB.open(await this.dbName, this.version);
            request.onupgradeneeded = (event) => {
                console.info(resolvedPrefix + `[openDB] ***** openDB upgrade needed *****`);
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
            request.onsuccess = (_event) => {
                if (DBG0) console.log(resolvedPrefix + resolvedPrefix + `[openDB] success`);
                resolve(request.result as IDBDatabase);
            };
            request.onerror = () => {
                console.error(`[openDB] error: ${request.error}`)
                this.dbPromise = null as any;
                reject(request.error);
            };
            request.onblocked = () => {
                console.warn(`[openDB] openDB blocked`);
                this.dbPromise = null as any;
                reject(new Error('Database blocked'));
            };
        });
    }

    @Timeout((TIMEOUT / 4), 3) // three attempts
    openDB(): Promise<IDBDatabase> {
        // if (DBG2) console.log(resolvedPrefix + `[openDB] opening db ... (might be retried)`);
        if (!this.dbPromise)
            this.dbPromise = this.dbPromiseFactory();
        return this.dbPromise;
    };

    @Timeout(TIMEOUT)
    async put(key: string, value: any): Promise<void> {
        const resolvedPrefix = await this.prefix;
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, 'readwrite');
            if (DBG2) {
                // transaction.oncomplete = () => console.log(resolvedPrefix + "[SWDB.save] [DEBUG] Transaction complete");
                transaction.onerror = () => console.log(resolvedPrefix + "[SWDB.save] [DEBUG] Transaction error:", transaction.error);
                transaction.onabort = () => console.log(resolvedPrefix + "[SWDB.save] [DEBUG] Transaction aborted");
            }

            const store = transaction.objectStore(this.storeName);
            const putRequest = store.put({ id: key, value });

            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
        });
    };

    @Timeout(TIMEOUT)
    async get(key: string): Promise<any> {
        const resolvedPrefix = await this.prefix;
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, 'readonly');
            if (DBG2) {
                // transaction.oncomplete = () => console.log(resolvedPrefix + "[SBDB.get] [DEBUG] Transaction complete");
                transaction.onerror = () => console.log(resolvedPrefix + "[SBDB.get] [DEBUG] Transaction error:", transaction.error);
                transaction.onabort = () => console.log(resolvedPrefix + "[SBDB.get] [DEBUG] Transaction aborted");
            }
            const store = transaction.objectStore(this.storeName);
            const getRequest = store.get(key);

            getRequest.onsuccess = () => resolve(getRequest.result?.value);
            getRequest.onerror = () => reject(getRequest.error);
        });
    };

    @Timeout(TIMEOUT)
    async list(): Promise<any[]> {
        const resolvedPrefix = await this.prefix;
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, 'readonly');
            if (DBG2) {
                transaction.oncomplete = () => console.log(resolvedPrefix + "[SBDB.list] [DEBUG] Transaction complete");
                transaction.onerror = () => console.log(resolvedPrefix + "[SBDB.list] [DEBUG] Transaction error:", transaction.error);
                transaction.onabort = () => console.log(resolvedPrefix + "[SBDB.list] [DEBUG] Transaction aborted");
            }
            const store = transaction.objectStore(this.storeName);
            const getAllRequest = store.getAll();

            getAllRequest.onsuccess = () => resolve(getAllRequest.result.map(item => item.value));
            getAllRequest.onerror = () => reject(getAllRequest.error);
        });
    };

    // deleting a database is a bit less reliable, since other connections might be open.
    // clearing the store is a bit less private and secure. so we first do the latter,
    // and then attempt the former.
    @Timeout(TIMEOUT)
    async clearAndDeleteDatabase(): Promise<void> {
        const resolvedPrefix = await this.prefix;
        if (DBG0) console.log(resolvedPrefix + "[SWDB.clearAndDeleteDatabase] Clearing store and deleting database");
        const db = await this.openDB(); // Ensure the database is open

        // First, clear the store
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(this.storeName, 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const clearRequest = store.clear();

            clearRequest.onsuccess = () => {
                if (DBG0) console.log(resolvedPrefix + "[SWDB.clear] Store cleared");
                resolve();
            };
            clearRequest.onerror = () => {
                console.error("[SWDB.clear] Clear operation error:", clearRequest.error);
                reject(clearRequest.error);
            };
        });

        // Then attempt to delete the database
        return new Promise<void>(async (resolve, reject) => {
            // Close any open connection before attempting to delete
            db.close();

            const deleteRequest = indexedDB.deleteDatabase(await this.dbName);
            deleteRequest.onsuccess = () => {
                if (DBG0) console.log(resolvedPrefix + `[SWDB.deleteDatabase] Database ${this.dbName} successfully deleted.`);
                this.dbPromise = null as any;
                resolve();
            };
            deleteRequest.onerror = () => {
                console.error(resolvedPrefix + `[SWDB.deleteDatabase] Failed to delete database ${this.dbName}:`, deleteRequest.error);
                this.dbPromise = null as any;
                reject(deleteRequest.error);
            };
            deleteRequest.onblocked = () => {
                console.warn(resolvedPrefix + `[SWDB.deleteDatabase] Delete operation for ${this.dbName} was blocked (but hopefully cleared).`);
                this.dbPromise = null as any;
                // reject(new Error('Delete operation blocked'));
                resolve(); // we can still resolve, since the store was cleared
            };
        });
    }


}
