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
    Channel, ChannelApi, ChannelHandle,
    ObjectHandle, Protocol_AES_GCM_256, Protocol_KeyInfo,
    SBUserId, SBUserPublicKey,
    arrayBufferToBase62, assemblePayload, SBProtocol,
    Message,
} from '../index';

import {
    _check_ObjectHandle,
} from '../storage/ObjectHandle';

import { ChannelStream } from '../channel/ChannelStream';
import { MessageType } from '../channel/MessageType';
import { SBFile } from './SBFile';

var DBG0 = true;
var DBG2 = false;

export const SEP = '\n' + '='.repeat(76) + '\n';

/**
 * Meta data on each FileSet, included in ledger. Sort of a 'meta-meta' set of
 * data, this tracks when/where the set came from on the ledger. 
 * @public
 */
export interface FileSetMeta {
    _id: string, // uncommented to fix issue with multiple file sets not showing; ToDo, finalize
    senderUserId: SBUserId,
    senderPublicKey: SBUserPublicKey,
    serverTimestamp: number,
    fileSet: Map<string, SBFile>,
    fileSetShard: ObjectHandle,
    // optional:
    count?: number,
    totalBytes?: number
}

type SBFSPersistedStateOptions = boolean | {
    key?: string,
    debounceMs?: number,
}

interface SBFSPersistedFileSetMeta {
    _id: string,
    senderUserId: SBUserId,
    senderPublicKey: SBUserPublicKey,
    serverTimestamp: number,
    fileSetShard: ObjectHandle,
    count?: number,
    totalBytes?: number,
    fileSetEntries: Array<[string, Record<string, any>]>,
}

interface SBFSPersistedState {
    version: 1,
    updatedAt: number,
    lastServerTimestamp: number,
    fileSets: Array<SBFSPersistedFileSetMeta>,
}

/**
 * This is the core class for SBFS. Different versions of SBFS extend this.
 */
export class SBFS {
    SB: ChannelApi;

    budget?: Channel;
    ledger?: Channel;
    ledgerHandle?: ChannelHandle;
    ledgerProtocol?: Protocol_AES_GCM_256;

    initialized = false;

    fileSetMap: Map<string, FileSetMeta> = new Map();

    // ToDo: currently we can only handle one set being uploaded at a time (per SBFileSystem instance)
    newFileMap: Map<string, SBFile> = new Map()
    toUpload: Array<string> = []
    uploaded: Array<string> = []
    protected _doneUploadingCalled = false // guard against double-fire
    lastServerTimestamp: number = 0
    private persistTimer: ReturnType<typeof setTimeout> | undefined

    /** Minimal option is the channelServer, everything else is more advanced */
    constructor(
        public options: {
            // at minimum, we need a channel server
            channelServer: string,
            // core for full functionality
            ledgerHandle?: ChannelHandle,
            ledgerPassPhrase?: string,
            budgetHandle?: ChannelHandle,
            // optional
            username?: string,
            // advanced, for most cases we can use default fixed value (below)
            ledgerKey?: Protocol_KeyInfo
            // optional state persistence (browser)
            persistedState?: SBFSPersistedStateOptions
            // appServer?: string,
        },
        public callbacks: {
            /** Called for all sets of files encountered on a stream */
            newFileSet?: (meta: FileSetMeta) => void, // previously 'processNewTable'
            /** UI callback for any long-running tasks */
            setProgressBarWidth?: (width: number) => void,
        }
    ) {
        // console.log("SBFileSystem constructor");
        this.SB = new ChannelApi(this.options.channelServer)

        if (!this.options.ledgerKey)
            // if not provided, we use a fixed value. good enough in many cases.
            // note, this will NOT change, it is fixed for SBFileSystem 
            this.options.ledgerKey = {
                salt1: new Uint8Array([236, 15, 149, 57, 16, 61, 101, 82, 24, 206, 80, 70, 162, 38, 253, 33]),
                iterations1: 100000,
                iterations2: 10000,
                hash1: "SHA-256",
                summary: "PBKDF2 - SHA-256 - AES-GCM"
            }

        if (options.budgetHandle)
            this.budget = this.SB.connect(options.budgetHandle) // we won't be messaging on this

        if (options.ledgerHandle) {
            options.ledgerHandle.channelServer = options.channelServer // in case it's not set
            this.ledgerHandle = options.ledgerHandle
        }

        if (options.ledgerHandle && options.ledgerPassPhrase) {
            this.ledgerProtocol = new Protocol_AES_GCM_256(options.ledgerPassPhrase, this.options.ledgerKey!)
            this.ledger = new Channel(options.ledgerHandle, this.ledgerProtocol) // we _will_ be messaging on this
        }
    }

    private get persistedStateOptions() {
        return this.options.persistedState
    }

    private get persistenceEnabled() {
        return !!this.persistedStateOptions
    }

    private get persistenceDebounceMs() {
        if (typeof this.persistedStateOptions === 'object' && this.persistedStateOptions?.debounceMs !== undefined) {
            return this.persistedStateOptions.debounceMs
        }
        return 200
    }

    private get persistenceKey() {
        if (typeof this.persistedStateOptions === 'object' && this.persistedStateOptions?.key) {
            return this.persistedStateOptions.key
        }
        const channelId = this.options.ledgerHandle?.channelId || 'unknown-ledger'
        return `sbfs:${channelId}:v1`
    }

    private _idb: IDBDatabase | null = null
    private _idbReady: Promise<IDBDatabase | null> | null = null

    /**
     * Opens (or returns cached) IndexedDB for SBFS state persistence.
     * Falls back to null if IndexedDB is unavailable.
     */
    private openIDB(): Promise<IDBDatabase | null> {
        if (this._idbReady) return this._idbReady
        this._idbReady = new Promise<IDBDatabase | null>((resolve) => {
            if (typeof globalThis === 'undefined' || !('indexedDB' in globalThis)) {
                resolve(null)
                return
            }
            const dbName = 'sbfs-state'
            const request = indexedDB.open(dbName, 1)
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result
                if (!db.objectStoreNames.contains('state')) {
                    db.createObjectStore('state')
                }
            }
            request.onsuccess = () => {
                this._idb = request.result
                resolve(this._idb)
            }
            request.onerror = () => {
                console.warn('[SBFS:state] Failed to open IndexedDB:', request.error)
                resolve(null)
            }
        })
        return this._idbReady
    }

    private async idbGet(key: string): Promise<unknown> {
        const db = await this.openIDB()
        if (!db) return null
        return new Promise((resolve) => {
            try {
                const tx = db.transaction('state', 'readonly')
                const req = tx.objectStore('state').get(key)
                req.onsuccess = () => resolve(req.result ?? null)
                req.onerror = () => { console.warn('[SBFS:state] idbGet error:', req.error); resolve(null) }
            } catch { resolve(null) }
        })
    }

    private async idbPut(key: string, value: unknown): Promise<boolean> {
        const db = await this.openIDB()
        if (!db) return false
        return new Promise((resolve) => {
            try {
                const tx = db.transaction('state', 'readwrite')
                const req = tx.objectStore('state').put(value, key)
                req.onsuccess = () => resolve(true)
                req.onerror = () => { console.warn('[SBFS:state] idbPut error:', req.error); resolve(false) }
            } catch { resolve(false) }
        })
    }

    private serializeFileSetMeta(fileSetMeta: FileSetMeta): SBFSPersistedFileSetMeta {
        const fileSetEntries = Array.from(fileSetMeta.fileSet.entries()).map(([k, v]) => {
            const payload = (typeof (v as any).toJSON === 'function') ? (v as any).toJSON() : { ...v }
            return [k, payload] as [string, Record<string, any>]
        })
        return {
            _id: fileSetMeta._id,
            senderUserId: fileSetMeta.senderUserId,
            senderPublicKey: fileSetMeta.senderPublicKey,
            serverTimestamp: fileSetMeta.serverTimestamp,
            fileSetShard: fileSetMeta.fileSetShard,
            count: fileSetMeta.count,
            totalBytes: fileSetMeta.totalBytes,
            fileSetEntries,
        }
    }

    private serializeState(): SBFSPersistedState {
        return {
            version: 1,
            updatedAt: Date.now(),
            lastServerTimestamp: this.lastServerTimestamp,
            fileSets: Array.from(this.fileSetMap.values()).map((m) => this.serializeFileSetMeta(m)),
        }
    }

    private deserializeState(raw: unknown): SBFSPersistedState | null {
        if (!raw || typeof raw !== 'object') return null
        const state = raw as Partial<SBFSPersistedState>
        if (state.version !== 1 || !Array.isArray(state.fileSets)) return null
        if (typeof state.lastServerTimestamp !== 'number') return null
        return state as SBFSPersistedState
    }

    private deserializeFileSetMeta(raw: SBFSPersistedFileSetMeta): FileSetMeta | null {
        // IDB structured clone preserves types — no revival needed.
        const maybeHandle = { ...(raw.fileSetShard as any) } as ObjectHandle
        if (!_check_ObjectHandle(maybeHandle)) return null
        const fileSet = new Map<string, SBFile>()
        for (const [k, v] of raw.fileSetEntries || []) {
            fileSet.set(k, new SBFile(v))
        }
        return {
            _id: raw._id,
            senderUserId: raw.senderUserId,
            senderPublicKey: raw.senderPublicKey,
            serverTimestamp: raw.serverTimestamp,
            fileSet,
            fileSetShard: maybeHandle,
            count: raw.count,
            totalBytes: raw.totalBytes,
        }
    }

    private persistStateSoon() {
        if (!this.persistenceEnabled) return
        if (this.persistenceEnabled) {
            console.warn(`[SBFS:state] scheduling persist key='${this.persistenceKey}' in ${this.persistenceDebounceMs}ms`)
        }
        if (this.persistTimer) clearTimeout(this.persistTimer)
        this.persistTimer = setTimeout(async () => {
            this.persistTimer = undefined
            try {
                const serialized = this.serializeState()
                const ok = await this.idbPut(this.persistenceKey, serialized)
                if (ok) {
                    console.warn(`[SBFS:state] persisted ${serialized.fileSets.length} sets to IndexedDB`)
                } else {
                    console.warn("[SBFS:state] IndexedDB write failed, state not persisted")
                }
            } catch (e) {
                console.warn("[SBFS] Could not persist SBFS state:", e)
            }
        }, this.persistenceDebounceMs)
    }

    private async hydrateFromPersistence() {
        if (!this.persistenceEnabled) return
        try {
            const raw = await this.idbGet(this.persistenceKey)
            if (!raw) {
                console.warn(`[SBFS:state] no cached state for key='${this.persistenceKey}'`)
                return
            }
            const state = this.deserializeState(raw)
            if (!state) {
                console.warn(`[SBFS:state] cached state present but invalid, key='${this.persistenceKey}'`)
                return
            }
            console.warn(`[SBFS:state] loaded cached state key='${this.persistenceKey}' sets=${state.fileSets.length} lastServerTimestamp=${state.lastServerTimestamp}`)
            this.lastServerTimestamp = Math.max(0, state.lastServerTimestamp || 0)
            let hydratedShards = 0
            for (const persisted of state.fileSets) {
                const meta = this.deserializeFileSetMeta(persisted)
                if (!meta) continue
                this.applyFileSetMeta(meta, true, false)
                // Populate knownShards from persisted file handles.
                // IDB structured clone preserves types — no revival needed.
                for (const sbFile of meta.fileSet.values()) {
                    if (sbFile.handle && sbFile.hash) {
                        if (_check_ObjectHandle(sbFile.handle)) {
                            ChannelApi.knownShards.set(sbFile.hash, sbFile.handle)
                            if (sbFile.hash.length > 12)
                                ChannelApi.knownShards.set(sbFile.hash.slice(0, 12), sbFile.handle)
                            hydratedShards++
                        }
                    } else if (sbFile.handleArray && sbFile.handleArray.length > 0 && sbFile.hash) {
                        for (const chunkHandle of sbFile.handleArray) {
                            if (chunkHandle?.id && _check_ObjectHandle(chunkHandle)) {
                                ChannelApi.knownShards.set(sbFile.hash, chunkHandle)
                                hydratedShards++
                            }
                        }
                    }
                }
                // Register the fileSetShard itself (already revived in deserializeFileSetMeta)
                if (meta.fileSetShard && meta.fileSetShard.id) {
                    ChannelApi.knownShards.set(meta.fileSetShard.id, meta.fileSetShard)
                }
            }
            console.warn(`[SBFS:state] hydrated ${this.fileSetMap.size} file sets, ${hydratedShards} shard handles from local persistence`)
        } catch (e) {
            console.warn("[SBFS] Failed to hydrate persisted state:", e)
        }
    }

    private applyFileSetMeta(fileSetMeta: FileSetMeta, emitCallback: boolean, persist: boolean): boolean {
        const setId = fileSetMeta.fileSetShard.id
        const existing = this.fileSetMap.get(setId)
        if (existing && existing._id === fileSetMeta._id) return false
        this.fileSetMap.set(setId, fileSetMeta)
        this.lastServerTimestamp = Math.max(this.lastServerTimestamp, fileSetMeta.serverTimestamp || 0)
        if (this.persistenceEnabled) {
            console.warn(`[SBFS:state] applyFileSetMeta id=${setId} serverTimestamp=${fileSetMeta.serverTimestamp} emit=${emitCallback} persist=${persist}`)
        }
        if (DBG0) console.log("---- File set (meta) contents added:\n", fileSetMeta)
        if (DBG2) console.log("---- ... fileSetMap is now:\n", this.fileSetMap)
        let count = 0;
        let totalBytes = 0;
        let lastDate = new Date(0); // Initialize with Epoch Time
        for (let value of fileSetMeta.fileSet.values()) {
            count++;
            totalBytes += value.size || 0;
            if (value.lastModified && typeof value.lastModified === 'string') {
                const currentLastModified = new Date(value.lastModified);
                if (currentLastModified > lastDate)
                    lastDate = currentLastModified;
            }
        }
        if (DBG2)
            console.log(
                SEP,
                'File Set Meta:', '\n',
                `Count: ${count}`, '\n',
                `Total Bytes: ${totalBytes}`, '\n',
                `Last Modified: ${lastDate}`, '\n',
                'Sender UserID: ', fileSetMeta.senderUserId,
                SEP)

        fileSetMeta.count = count;
        fileSetMeta.totalBytes = totalBytes;
        if (emitCallback && this.callbacks.newFileSet) {
            this.callbacks.newFileSet(fileSetMeta)
        }
        if (persist) this.persistStateSoon()
        return true
    }

    /**
     * This takes a 'finished' file set, and stores it on the ledger; computes
     * some stats. Upon completion, callback is given updated FileSetMeta.
     */
    addFileSet = async (fileSetMeta: FileSetMeta) => {
        if (!this.initialized) throw new Error("[SBFileSystem] Not initialized (L291).")
        if (!fileSetMeta.fileSetShard || !fileSetMeta.fileSetShard.id) {
            console.warn("---- File set (meta) does not have a shard ID, skipping whole set")
            return
        }
        if (!fileSetMeta.fileSet || !(fileSetMeta.fileSet instanceof Map)) {
            console.warn("---- File set (meta) does not have any files ('fileSet' missing or is not a Map), skipping whole set: \n", fileSetMeta)
            return
        }
        this.applyFileSetMeta(fileSetMeta, true, true)
    }


    /**
 * Processes incoming messages. Returns the message 'type', if it was understood
 * and acted upon, otherwise returns null.
 */
    receiveMessage = async (msg: Message | string): Promise<string | null> => {
        if (typeof msg === 'string') {
            if (DBG2) console.log(SEP, "[SBFileSystem] ++++ Received message (string), ignoring: '", msg, "'", SEP)
            return null;
        }
        const body = msg.body
        if (DBG2) console.log(SEP, "[SBFileSystem] ++++ Received message:\n  ", body, SEP)
        switch (body.messageType) {
            case MessageType.MSG_FILE_SET:
                if (DBG2) console.log("==== File Set Message received")

                let fileSet: Map<string, SBFile>

                // first we get the file set from the shard in body.fileSetShard
                if (body.fileSetShard) {
                    // const fileSetObject = await this.downloadFile(body.fileSetShard) as SBFile
                    const fileSetObject = new SBFile(await this.downloadFile(body.fileSetShard));
                    fileSet = fileSetObject.fileMetaDataMap!
                } else if (body.fileSet) {
                    fileSet = body.fileSet
                } else {
                    console.error("No file set or file set shard in message")
                    break;
                }
                // const fileSetObject = body.fileSet as SBFile

                // const receivedFileList = new Map()
                // for (const [key, value] of fileSetObject.fileMetaDataMap!.entries()) {
                //     receivedFileList.set(key, value)
                // }

                if (!(fileSet instanceof Map)) {
                    console.warn("[SBFileSystem] Received file set, but it doesn't contain a file set (ignoring)")
                    break;
                }

                const fs: FileSetMeta = {
                    _id: msg._id,
                    senderUserId: msg.sender,
                    senderPublicKey: msg.senderPublicKey,
                    serverTimestamp: msg.serverTimestamp,
                    fileSet: fileSet, // fileSetObject.fileMetaDataMap!,
                    fileSetShard: body.fileSetShard,
                }

                await this.addFileSet(fs)

                if (DBG0) console.log("---- Received MSG_FILE_SET: ", fs);
                break;
            case MessageType.MSG_NEW_SHARD:
                // console.log("==== New Shard Message received")
                // const obj = JSON.parse(message.contents)
                // Tracks progress
                if (this.toUpload.length > 0) {
                    if (this.toUpload.includes(body.hash)) {
                        this.uploaded.push(body.hash)
                        if (this.callbacks.setProgressBarWidth)
                            this.callbacks.setProgressBarWidth(Math.ceil(this.uploaded.length / this.toUpload.length * 100));
                        if (this.uploaded.length === this.toUpload.length) {
                            console.log("++++ all files uploaded")
                            this.doneUploadingSet()
                            // ready for new sets:
                            this.toUpload = []
                            this.uploaded = []
                        }
                    }

                }
                ChannelApi.knownShards.set(body.hash, body.handle)
                ChannelApi.knownShards.set(body.hash.slice(0, 12), body.handle)
                break;
            case 'PING':
                console.info("[SBFileSystem] PING message received")
                break;
            default:
                if (DBG2) console.info('---- Ignoring unknown message type:', body.messageType);
                return null
        }
        return (body.messageType)
    }


    /** Starts up a SBFileSystem against a stream */
    async spinUpStream(handle: ChannelHandle, protocol: SBProtocol, startTimestamp?: number) {
        const channelStream = await (new ChannelStream(handle, protocol)).ready
        if (this.persistenceEnabled) {
            console.warn(`[SBFS:state] spinUpStream startTimestamp=${startTimestamp ?? 'full-replay'}`)
        }
        const stream = (startTimestamp !== undefined && Number.isFinite(startTimestamp) && startTimestamp > 0)
            ? await channelStream.spawn({ start: startTimestamp, end: Infinity, live: true })
            : channelStream.start({ prefix: '0' }) // '0' means full history of messages
        if (DBG0) console.log(SEP, "[spinUpStream] Stream started", SEP)
        for await (const message of stream) {
            if (DBG2) console.log("[spinUpStream] Message: ", message.body)
            await this.receiveMessage(message)
        }
        if (DBG0) console.log(SEP, "[spinUpStream] DONE")
    }

    // USE_CHANNEL_STREAMS
    /** FileSystems need to be initialized (which might spin up stream) */
    init = async () => {
        // we process old sets on the ledger
        this.initialized = true;
        if (this.persistenceEnabled) {
            console.warn(`[SBFS:state] init begin key='${this.persistenceKey}'`)
        }
        await this.hydrateFromPersistence()
        if (this.options.ledgerHandle && this.ledger && this.ledgerProtocol) {
            const startTimestamp = (this.persistenceEnabled && this.lastServerTimestamp > 0)
                ? this.lastServerTimestamp + 1
                : undefined
            if (startTimestamp) console.warn(`[SBFS:state] stream resume from timestamp >= ${startTimestamp}`)
            else console.warn("[SBFS:state] stream full replay from beginning")
            this.spinUpStream(this.options.ledgerHandle, this.ledgerProtocol, startTimestamp) // ToDo: mechanism for shutting down
        } else {
            console.error("[SBFileSystem] No ledger handle or protocol, cannot initialize.")
        }
    }

    // called when we know all the parts (shards) of the set have been uploaded
    async doneUploadingSet(){
        if (this._doneUploadingCalled) {
            console.warn("[doneUploadingSet] Already called for this upload cycle, skipping duplicate.")
            return
        }
        this._doneUploadingCalled = true
        if (!this.ledger || !this.options.budgetHandle)
            throw new Error("[SBFileSystem] Ledger or budget handle not set up, cannot upload sets.")
        console.log("++++ done uploading set")
        if (this.newFileMap.size === 0) {
            throw new Error("Internal Error (L149)")
        }

        // first we update all file metadata with handles
        this.newFileMap.forEach((value, key) => {
            if (!value.hash) throw new Error("Internal Error (L154)")
            if (value.size && value.size > SBFile.MAX_SBFILE_CHUNK_SIZE) {
                if (value.hashArray) {
                    value.handleArray = value.hashArray.map(hash => ChannelApi.knownShards.get(hash)!);
                } else {
                    console.warn("[doneUploadingSet] Large file but 'hashArray' already cleared? Internal Warning (L193)")
                }
                value.hashArray = undefined; // we don't need this anymore
            } else {
                // common case, single shard per file
                const handle = ChannelApi.knownShards.get(value.hash)
                if (!handle) throw new Error("Internal Error (L199)")
                this.newFileMap.get(key)!.handleArray = [handle!]
            }
        });

        // we create a hash off the fileMetaDataMap
        const b = assemblePayload(this.newFileMap)!;
        const hash = arrayBufferToBase62(await globalThis.crypto.subtle.digest('SHA-256', b)).slice(0, 12);

        const sbFile: SBFile = new SBFile({
            hash: hash,
            sb384app: true,
            sb384appType: 'fileSetV03',
            name: `FileSet ${Date.now()}`,
            type: 'application/vnd.384.sb384app',
            fileMetaDataMap: this.newFileMap
        })
        // const fileSetObject = await this.uploadFile(sbFile)
        const fileSetObject: ObjectHandle = await this.SB.storage.storeData(sbFile, this.options.budgetHandle)
        this.ledger.send({
            messageType: MessageType.MSG_FILE_SET,
            fileSetShard: fileSetObject,
            // fileSet: sbFile
        })
        // This is a bit of a hack, but we're done uploading, so we send 100% to the progress bar
        // Helps cover cases where files are already known, an app dev would expect this to be 100%
        if (this.callbacks.setProgressBarWidth)
            this.callbacks.setProgressBarWidth(100);

        if (DBG0) console.log("++++ file set shard info has been sent as message on ledger")
    }

    /**
     * Convenience wrapper around ChannelApi's fetchData.
     */
    async fetchData(handle: ObjectHandle): Promise<ObjectHandle> {
        return this.SB.storage.fetchData(handle);
    }

    /** Download an SBFile */
    async downloadFile(handle: ObjectHandle): Promise<SBFile> {
        handle = await this.fetchData(handle);
        // const sbFile = await this.SB.storage.fetchPayload(handle) as SBFile;
        const sbFile = new SBFile(await this.SB.storage.fetchPayload(handle))
        // for now, this is our only sanity check that this is actually an SBFile
        if (sbFile._SBFSVersion !== '2024-02-01-0002') {
            console.warn("[SBFS] File version not supported, or is not an SBFile. Will try to process anyway.")
        }
        // sbFile.uniqueShardId = handle.id;
        return sbFile;
    }

}
