// (c) 2023-2024 384 (tm)

// 384 SBFS - support for Deno ('v2' hence 'SBFileSystem2'), eg command line, server-side, etc.

import {
    ChannelHandle,
    Protocol_KeyInfo,
    SBError,
    arrayBufferToBase62,
    ChannelApi,
} from '../index';

import { SBFile } from './SBFile';
import { MessageType } from '../channel/MessageType';

import { _check_ObjectHandle } from '../storage/ObjectHandle';

var DBG0 = true;
// var DBG2 = false;

import { SBFS, FileSetMeta } from './SBFS';


/**
 * 'SBFS': See 'SBFileSystem' in 'src/file/SBFileSystem.ts' for more details.
 * This implements same fs as far as channels and shards are concerned, but
 * operates locally (Deno).
 */
export class SBFileSystem2 extends SBFS {
    toUpload: Array<string> = []
    uploaded: Array<string> = []

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

    /** Convenience, uploads just a buffer */
    async uploadBuffer(buffer: ArrayBuffer, hash?: string) {
        if (!this.initialized) throw new Error("[SBFileSystem] Not initialized (L406).")
        if (!this.ledger || !this.options.budgetHandle)
            throw new Error("[SBFileSystem] Ledger or budget handle not set up, cannot upload files. (L395")
        const verifyHash = arrayBufferToBase62(await crypto.subtle.digest('SHA-256', buffer)).slice(0, 12);
        if (!hash)
            hash = verifyHash
        else if (hash !== verifyHash)
            throw new Error(`[uploadBuffer] Hash mismatch: ${hash} !== ${verifyHash}`)

        if (ChannelApi.knownShards.has(hash)) {
            console.info(`[uploadBuffer] Shard already known: ${hash}`)
            return ChannelApi.knownShards.get(hash)
        }

        this.toUpload.push(hash)
        const handle = await this.SB.storage.storeData(buffer, this.options.budgetHandle)
        await handle.verification
        console.log("WE GOT BACK HANDLE:", handle)

        // now we add it to the set of known hash->handle mappings
        ChannelApi.knownShards.set(hash, handle)
        ChannelApi.knownShards.set(hash.slice(0, 12), handle) // find on prefix

        // add knowledge on the ledger; ToDo possibly batch for large sets?
        const obj = { messageType: MessageType.MSG_NEW_SHARD, hash: hash, handle: handle, senderUsername: this.options.username }
        await this.ledger.send(obj)

        return handle
    }

    /** Main workhorse, uploads a file. */
    async uploadFile (_file: SBFile) {
        throw new SBError("Not implemented")
        // if (!this.initialized) throw new Error("[SBFileSystem] Not initialized (L522).")
        // if (!this.ledger || !this.options.budgetHandle)
        //     throw new Error("[SBFileSystem] Ledger or budget handle not set up, cannot upload files. (L395")

        // await StorageApi.paceUploads()
        // console.log("[uploadFile] file:", file)
        // if (!file.hash) throw new SBError("file.hash is missing")

        // const buffer = BrowserFileHelper.knownBuffers.get(file.hash)
        // if (!buffer)
        //     throw new SBError(`**** failed to find buffer for ${file.hash}`)

        // console.log(SEP, `For file hash '${file.hash}', uploading buffer:`, buffer, SEP);

        // const handle = await this.uploadBuffer(buffer, file.hash)

        // console.log(`++++ File shard has been sent on channel:`, handle);
    }


}


if (DBG0) console.warn("==== SBFileSystem2.ts (Deno) loaded ====")
