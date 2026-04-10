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
    arrayBufferToBase62, ChannelApi, ChannelHandle,
    Protocol_KeyInfo, SBError, 
    StorageApi,
} from '../index';

import {
    _check_ObjectHandle,
} from '../storage/ObjectHandle';

import {
    fetchPayload
} from '../storage/core'

import { SBFile } from './SBFile';

import { BrowserFileHelper } from '../browser/BrowserFileHelper';
import { MessageType } from '../channel/MessageType';

// import { preview File } from '../browser/preview';

var DBG0 = false;
// var DBG2 = false;

import { SBFS, FileSetMeta, SEP } from './SBFS';


/**
 * 'SBFS': Creates a file system abstraction given server information and
 * channel handles. Ledger handle is used for all file system meta data, and
 * budget handle is used as funding source for any uploads.
 *
 * You could use the same channel for both functions, but then you get the
 * classic problem that when you're out of funds, everything freezes. This is
 * analogous to how a traditional operating system, which will reserve both
 * in-memory and on-disk space for it's own critical functions.
 *
 * Upon creation, SBFS will fetch all previous file sets from the ledger. It
 * will call 'newFileSet' callback for each one, if a UI wants to dynamically be
 * made aware of them.
 * 
 * @public
 */
export class SBFileSystem extends SBFS {

    fetchPayload = fetchPayload; // convenience / compatibility

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
            persistedState?: boolean | { key?: string, debounceMs?: number }
            // appServer?: string,
        },
        public callbacks: {
            /** Called for all sets of files encountered on a stream */
            newFileSet?: (meta: FileSetMeta) => void, // previously 'processNewTable'
            /** UI callback for any long-running tasks */
            setProgressBarWidth?: (width: number) => void,
        }
    ) {
        super(options, callbacks)
    }

    /**
     * Given a file list, creates and uploads the set; makes sure all shards are
     * uploaded. If everything went fine, returns 'null', otherwise an error string.
     */
    uploadNewSet = async (fileList: Array<SBFile>): Promise<string | null> => {
        let error: string | null = null;
        if (!this.initialized) throw new Error("[SBFileSystem] Not initialized (L189).")
        if (!fileList || fileList.length === 0) throw new Error("No files to upload")
        console.log("[uploadNewSet] new set:", fileList)

        try {
            this.newFileMap = new Map()
            for (const f of fileList) {
                if (!f.hash) throw new Error("Internal Error (L195)")
                let key = f.fullName
                if (!key) {
                    console.warn(`[uploadNewSet] SBFile missing fullName, falling back to hash as map key:`, f.name, f.hash)
                    key = f.hash
                }
                this.newFileMap.set(key, f)
            }

            // ToDo: currently code only allows one set at a time, we need to allow multiple.
            if (this.toUpload.length > 0) {
                // toUpload and uploaded will be reset by message handler
                console.error("++++ already uploading files, please wait ...")
                return "[uploadNewSet] Already uploading a set of files, cannot (yet) upload sets in parallel."
            }
            // We reset these arrays and the guard flag
            this.toUpload = []
            this.uploaded = []
            this._doneUploadingCalled = false

            // we make sure all shards are uploaded first before sending 'set' info;
            // iterate over all Map() entries and upload them

            // Signal upload start via callback (if provided)
            this.callbacks.setProgressBarWidth?.(0);

            const uploadPromises = []
            for (const f of fileList) {
                if (error) {
                    console.error("[uploadNewSet] Error in previous file, aborting (L279):", error)
                    return error;
                }
                // const fileHash = value.uniqueShardId!;
                if (!f.hash) throw new Error("Internal Error (L225)")
                if (!f.size) f.size = 0 // throw new Error("Internal Error (L226)")
                if (f.size > SBFile.MAX_SBFILE_CHUNK_SIZE) {
                    if (!f.browserFile) throw new Error("Large file but no 'browserFile' to work with. Internal Error (L238)")
                    if (DBG0) console.log(`---- uploading LARGE file:`, f)
                    f.hashArray = []
                    // we first load the whole file into memory
                    const buffer = await f.browserFile.arrayBuffer()
                    const chunkSize = SBFile.MAX_SBFILE_CHUNK_SIZE
                    const chunks = Math.ceil(f.size / chunkSize)
                    for (let i = 0; i < chunks; i++) {
                        await StorageApi.paceUploads()
                        if (error) {
                            console.error("[uploadNewSet] Error in previous file, aborting (L296):", error)
                            return error;
                        }
                        const start = i * chunkSize
                        const end = Math.min(f.size, (i + 1) * chunkSize)
                        const chunk = buffer.slice(start, end)
                        const hash = arrayBufferToBase62(await crypto.subtle.digest('SHA-256', chunk)).slice(0, 12);
                        f.hashArray.push(hash)
                        uploadPromises.push(
                            this.uploadBuffer(chunk)
                                .catch((e) => {
                                    console.error("[uploadNewSet] Error uploading chunk (L307), will throw:", e)
                                    error = e.message
                                    throw(e)
                                }));
                    }
                    const joinedHashes = f.hashArray.join('')
                    f.hash = arrayBufferToBase62(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(joinedHashes))).slice(0, 12);
                    // debugger;
                } else {
                    if (ChannelApi.knownShards.has(f.hash) && !this.missingShards.has(f.hash)) {
                        if (DBG0) console.log(`---- skipping ${f.hash} shard (already known / published)`);
                        continue;
                    }
                    if (this.missingShards.has(f.hash)) {
                        if (DBG0) console.log(`[uploadNewSet] Shard ${f.hash} marked missing, forcing re-upload`)
                        ChannelApi.knownShards.delete(f.hash)
                        ChannelApi.knownShards.delete(f.hash.slice(0, 12))
                    }
                    await StorageApi.paceUploads()
                    if (error) return error;
                    if (DBG0) console.log(`---- uploading file:`, f)
                    // uploadPromises.push(this.uploadSetEntry(fileHash))
                    uploadPromises.push(this.uploadFile(f))
                }
            }
            // wait for all of them to be done
            await Promise.all(uploadPromises).catch((e) => {
                console.error("[uploadNewSet] Error in uploadPromises, propagated to 'all' (L329):", e)
                error = e.message;
            })
            console.log("++++ all files have been sent to be uploaded")

            // special case is if the set contains only known shards, in which case set can be sent right away
            // (because we won't get a 'callback' that we're done from returning messages)
            if (this.toUpload.length === 0) {
                console.log("++++ all files already uploaded")
                this.doneUploadingSet()
            }
            return error; // will be 'null' if all went well
        } catch (e: any) {
            console.error("[uploadNewSet] Interrupted uploads (L342):", e)
            return e.message
        }
    }

    /** 
     * Returns buffer contents matching a known buffer (hash); throws if not
     * actually known. Note that if the corresponding shard (handle) is known
     * but not downloaded, it will be downloaded, and that returned.
     */
    getFileBuffer = async (hash: string): Promise<ArrayBuffer> => {
        if (BrowserFileHelper.knownBuffers.has(hash)) {
            return BrowserFileHelper.knownBuffers.get(hash)!
        } else if (ChannelApi.knownShards.has(hash)) {
            // const handle = await this.sbfs.fetchData(BrowserFileHelper.knownShards.get(hash)!)
            const buffer = await this.fetchPayload(ChannelApi.knownShards.get(hash)!)
            if (buffer instanceof ArrayBuffer) {
                // BrowserFileHelper.knownShards.set(hash, handle) // update
                return buffer
            } else {
                throw new Error("Could not fetch buffer for hash: " + hash)
            }
        } else {
            throw new Error("Cannot find contents of file (neither in globalBufferMap nor in knownShards)")
        }


        // let handle = BrowserFileHelper.knownShards.get(hash)
        // if (handle) {
        //     if (!handle.data) {
        //         handle = await this.sbfs.fetchData(handle)
        //         BrowserFileHelper.knownShards.set(hash, handle)
        //     }
        //     if (!handle.payload) throw new Error("handle.payload is missing")
        //     // data = StorageApi.getData(BrowserFileHelper.knownShards.get(hash))!
        //     data = handle.payload
        // } else {
        //     data = BrowserFileHelper.knownBuffers.get(hash)!
        // }
        // if (data) {
        //     console.log(SEP, `For file hash '${hash}', previewing buffer:`, SEP, data, SEP)
        //     await preview File(data, mimeType, {}) // actually in browser/preview.ts
        // } else {
        //     throw new Error("Cannot find contents of file (neither in globalBufferMap nor in knownShards)")
        // }
    }

    /** Convenience, uploads just a buffer */
    uploadBuffer = async (buffer: ArrayBuffer, hash?: string) => {
        if (!this.initialized) throw new Error("[SBFileSystem] Not initialized (L406).")
        if (!this.ledger || !this.options.budgetHandle)
            throw new Error("[SBFileSystem] Ledger or budget handle not set up, cannot upload files. (L395")
        const verifyHash = arrayBufferToBase62(await crypto.subtle.digest('SHA-256', buffer)).slice(0, 12);
        if (!hash)
            hash = verifyHash
        else if (hash !== verifyHash)
            throw new Error(`[uploadBuffer] Hash mismatch: ${hash} !== ${verifyHash}`)

        if (ChannelApi.knownShards.has(hash) && !this.missingShards.has(hash)) {
            console.info(`[uploadBuffer] Shard already known: ${hash}`)
            return ChannelApi.knownShards.get(hash)
        }

        this.toUpload.push(hash)
        const handle = await this.SB.storage.storeData(buffer, this.options.budgetHandle)
        await handle.verification
        if (DBG0) console.log("WE GOT BACK HANDLE:", handle)

        // now we add it to the set of known hash->handle mappings
        ChannelApi.knownShards.set(hash, handle)
        ChannelApi.knownShards.set(hash.slice(0, 12), handle) // find on prefix

        // clear it from 'knownBuffers' (it's now shardifed), in case it's there (it might not be)
        BrowserFileHelper.knownBuffers.delete(hash)

        // add knowledge on the ledger; ToDo possibly batch for large sets?
        const obj = { messageType: MessageType.MSG_NEW_SHARD, hash: hash, handle: handle, senderUsername: this.options.username }
        await this.ledger.send(obj)

        return handle
    }

    /** Uploads a small file. */
    uploadFile = async (file: SBFile) => {
        if (!this.initialized) throw new Error("[SBFileSystem] Not initialized (L522).")
        if (!this.ledger || !this.options.budgetHandle)
            throw new Error("[SBFileSystem] Ledger or budget handle not set up, cannot upload files. (L395")
        if (file.size && file.size > SBFile.MAX_SBFILE_CHUNK_SIZE) throw new Error("File too large for uploadFile()")
        // TODO: another bit of confusion, this actually only uploads a file when
        //       working in the BrowserFileHelper 'context'. refactor?
        await StorageApi.paceUploads()
        console.log("[uploadFile] file:", file)
        if (!file.hash) throw new SBError("file.hash is missing")
        let buffer = BrowserFileHelper.knownBuffers.get(file.hash)
        if (!buffer && file.browserFile) {
            // Buffer may have been GC'd between attempts; recover from the original browser File
            try {
                buffer = await file.browserFile.arrayBuffer()
                BrowserFileHelper.knownBuffers.set(file.hash, buffer)
                if (DBG0) console.log(`[uploadFile] Recovered buffer for ${file.hash} from browserFile`)
            } catch (e) {
                console.warn(`[uploadFile] Failed to recover buffer for ${file.hash}:`, e)
            }
        }
        if (!buffer)
            throw new SBError(`**** failed to find buffer for ${file.hash}`)

        console.log(SEP, `For file hash '${file.hash}', uploading buffer:`, buffer, SEP);

        // this.toUpload.push(file.hash)
        // const handle = await this.SB.storage.storeData(buffer, this.options.budgetHandle)
        // await handle.verification
        // console.log("WE GOT BACK HANDLE:", handle)

        // // now we add it to the set of known hash->handle mappings
        // ChannelApi.knownShards.set(file.hash, handle)
        // ChannelApi.knownShards.set(file.hash.slice(0, 12), handle) // find on prefix

        // // clear it from 'knownBuffers' (it's now sharidifed)
        // BrowserFileHelper.knownBuffers.delete(file.hash)

        // // our mapping object
        // const obj = { messageType: MessageType.MSG_NEW_SHARD, hash: file.hash, handle: handle, senderUsername: this.options.username }
        // const response = await this.ledger.send(obj)

        const handle = await this.uploadBuffer(buffer, file.hash)

        console.log(`++++ File shard has been sent on channel:`, handle);
    }

    // async fetchPayload(fileOrHandle: SBFile | ObjectHandle): Promise<any> {
    //     // ToDo: we probably need to refactor some confusion between the role of
    //     // "SBFile" and "ObjectHandle" in the API; in the meantime, we'll use
    //     // this wrapper function to paper over some cracks
    //     if (!fileOrHandle) throw new SBError("[SBFS] No file or handle provided");
    //     let handle: ObjectHandle = fileOrHandle as ObjectHandle;
    //     if (!_check_ObjectHandle(handle)) {
    //         const file = fileOrHandle as SBFile;
    //         if (file.file) throw new SBError("[SBFS] Type handling for inline files not yet implemented");
    //         if (!file.handle) throw new SBError("[SBFS] No handle in SBFile, cannot fetch file contents");
    //         handle = file.handle;
    //         if (!_check_ObjectHandle(handle)) throw new SBError("[SBFS] Invalid handle in SBFile");
    //     }
    //     const downloadedFile = await this.fetchData(handle);
    //     if (!downloadedFile.payload) throw new SBError("[SBFS] No payload in downloaded file");
    //     return downloadedFile.payload;
    // }



    // // older/simpler interface, just gives you the buffer; note that it
    // // hard-codes the assumption that 'payload' is an ArrayBuffer
    // async downloadBuffer(handle: ObjectHandle) {
    //     handle = await this.SB.storage.fetchData(handle);
    //     return handle.payload as ArrayBuffer;
    // }

}


if (DBG0) console.warn("==== SBFileSystem.ts loaded ====")


// deprecated
// uploadBuffer() 
// return new Promise((resolve) => {
//     if (!this.SB.storage) {
//         console.log("'this.server': ", this.SB);
//         throw new SBError("storage not initialized")
//     }
//     this.SB.storage.storeData(data, this.budgetChannel).then((res) => {
//         // res.fileName = name
//         res.dateAndTime = new Date().toISOString()
//         Promise.resolve(res.verification).then((v) => {
//             res.verification = v as string;
//             resolve(res)
//         })
//     })
// })

// async uploadFile(file: SBFile): Promise<ObjectHandle> {
//     if (!this.budgetChannel) throw new SBError("[SBFS] No budgetchannel provided, cannot upload file.");
//     if (file._SBFSVersion) throw new SBError("file._SBFSVersion already defined, reserved for SBFS");
//     file._SBFSVersion = '2024-02-01-0002';
//     file.timeStamp = Date.now();
//     if (file.file) file.actualFileSize = file.file.byteLength
//     const res = await this.SB.storage.storeData(file, this.budgetChannel);
//     res.verification = await res.verification
//     return res;
// }

// UPDATE ... no longer relevant, i think?  (was part of "sbfs")
// uploadBrowserFileList(myChannelId: ChannelId, fileMap: Map<any, any>, bufferMap: Map<any, any>) {
//     console.info('uploadBrowserFileList() not implemented yet')
//     console.log(myChannelId, fileMap, bufferMap)
//     // ToDo: take from multi-file demo
//     // return new Promise((resolve) => {
//     //     let promises: Promise<Interfaces.ObjectHandle>[] = [];
//     //     for (let i = 0; i < fileList.length; i++) {
//     //         promises.push(this.uploadBuffer(myChannelId, fileList[i], fileList[i].name));
//     //     }
//     //     Promise.all(promises).then((res) => {
//     //         resolve(res);
//     //     });
//     // });
// }




// // async uploadCurrentFiles(myChannelId: ChannelId, callback: (res: ObjectHandle) => void) {
// //   if (DBG0) console.log("==== uploadCurrentFiles() ====");
// //   let directory: { [key: string]: string } = {};
// //   console.log("Current file list: ")
// //   console.log(this.currentFileList);
// //   this.currentFileList.forEach((value: { [key: string]: any }, key: string) => {
// //     if (DBG0) console.log("File: " + value.name);
// //     let dirEntry = getProperties(value, ["name", "type", "size", "lastModified", "webkitRelativePath"]);
// //     directory[key] = dirEntry as unknown as string;
// //   });
// //   console.log("Directory: ");
// //   console.log(directory);
// // }

// /**
//  * SBFile
//  * @class
//  * @constructor
//  * @public
//  */
// export class SBFile extends SBMessage {
//   // encrypted = false
//   // contents: string = ''
//   // senderPubKey: CryptoKey
//   // sign: Promise<string>

//   data: Dictionary<string> = {
//     previewImage: '',
//     fullImage: ''
//   }
//   // (now extending SBMessage)
//   image = '';
//   image_sign = '';
//   // imageMetaData: ImageMetaData = {}

//   // file is an instance of File
//   constructor(channel: Channel, file: File /* signKey: CryptoKey, key: CryptoKey */) {
//     super(channel, '')
//     console.warn('working on SBFile()!')
//     console.log('file: ', file)

//     // this.senderPubKey = key;
//     // ... done by SBMessage parent?
//     // this.sign = sbCrypto.sign(channel.keys.channelSignKey, this.contents);
//     // if (file.type.match(/^image/i)) {
//     //   this.#asImage(file, signKey)
//     // } else {
//     //   throw new Error('Unsupported file type: ' + file.type);
//     // }
//   }

//   //   async #asImage(image: File, signKey: CryptoKey) {
//   //     throw new Error(`#asImage() needs carryover from SBImage etc (${image}, ${signKey})`)

//   //   this.data.previewImage = this.#padImage(await(await this.#restrictPhoto(image, 4096, 'image/jpeg', 0.92)).arrayBuffer());
//   //   const previewHash: Dictionary = await this.#generateImageHash(this.data.previewImage);
//   //   this.data.fullImage = image.byteLength > 15728640 ? this.#padImage(await(await this.#restrictPhoto(image, 15360, 'image/jpeg', 0.92)).arrayBuffer()) : this.#padImage(image);
//   //   const fullHash: Dictionary = await this.#generateImageHash(this.data.fullImage);
//   //   this.image = await this.#getFileData(await this.#restrictPhoto(image, 15, 'image/jpeg', 0.92), 'url');
//   //   this.image_sign = await sbCrypto.sign(signKey, this.image);
//   //   this.imageMetaData = JSON.stringify({
//   //     imageId: fullHash.id,
//   //     previewId: previewHash.id,
//   //     imageKey: fullHash.key,
//   //     previewKey: previewHash.key
//   //   });
//   //   this.imageMetadata_sign = await sbCrypto.sign(signKey, this.imageMetaData)
//   // }

// } /* class SBFile */


// ToDo: some old code that was intended for SBFile, not factored into it yet

// // saveFile(channel: Channel, sbFile: SBFile) {
// //   console.log("saveFile()")
// //   // const metaData: Dictionary = jsonParseWrapper(sbFile.imageMetaData, 'L1732');
// //   const metaData: ImageMetaData = sbFile.imageMetaData
// //   const fullStorePromise = this.storeImage(sbFile.data.fullImage, metaData.imageId!, metaData.imageKey!, 'f');
// //   const previewStorePromise = this.storeImage(sbFile.data.previewImage, metaData.previewId!, metaData.previewKey!, 'p');
// //   Promise.all([fullStorePromise, previewStorePromise]).then((results) => {
// //     results.forEach((controlData) => {
// //       channel.sendSbObject({ ...controlData, control: true });
// //     });
// //     // psm: need to generalize classes ... sbFile and sbImage descent from sbMessage?
// //     // channel.sendSbObject(sbFile);
// //     channel.send(sbFile)
// //   });
// // }

// // async sendSbObject(file: SBFile) {
// //   return (this.send(file))
// //   // this.ready.then(() => {
// //   //   this.#wrap(file /* , this.#keys!.encryptionKey */).then((payload) => this.send(payload));
// //   // } else {
// //   //   this.#queue.push(file);
// //   // }
// // }
