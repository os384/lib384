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
import { ObjectHandle } from 'src/storage/ObjectHandle'

const SB_FILE_SYMBOL = Symbol('SBFile');
const DBG0 = false;

/**
 * A 'file' in os384. Reminder that we do not have 'directories' or
 * 'hierarchical' structure, since they are inherently spatial and 'physical'
 * (eg ordering on a disk). In os384, the primitive is a set: an 'empty
 * directory' would be represented as an empty set which has a path, for
 * example. Any single file is just a singleton set. A 'directory' will be seen
 * as a set of multiple files, where properties such as 'path' and 'fullPath'
 * are retained such that, if ever desired, a 'directory' can be reconstructed.
 * 
 * It should also be noted that SBFile works 'behind the curtain', meaning,
 * it assumes that things are decrypted and verified etc. For example, the
 * handles will contain keys, eg, SBFile objects themselves assume that they
 * are always stored or communicated within encrypted contexts. 
 * 
 * The 'generic/typical' pattern in os384 is that meta data like SBFile would
 * be shared as messages, either individually or as part of a set. Thus, SBFile
 * combines the challenges of key management and meta data, about data.
 * 
 * Whenever an SBFile object is 'entering' lib384, pass the object through
 * the constructor.
 * 
 * @public 
 */
export class SBFile {
    _SBFSVersion = '2024-02-01-0002';
    [SB_FILE_SYMBOL] = true;

    public static appServer?: string;

    /** storage server generally allows larger than this (eg 16 or 32 MiB). however, in various situations,
        it's problematic to juggle lots of these 'in flight' (eg, in edge worker memory). thus, we currently
        limit to 4 MiB, which gives most of the theoretical performance on the client reading side, and appears
        to be tolerated by various other 'things'. */
    public static MAX_SBFILE_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB

    sb384app?: boolean;
    sb384appType?: string;
    sb384appVersion?: number;

    /** must be _universally unique_, can be constructed in different ways */
    hash?: string;

    /** typically the name on the file system */
    name?: string;

    /** path to where the file is, eg '/' */
    path?: string;
    /** full path from root including file, eg 'canonical' file name and path */
    fullPath?: string; 

    /** MIME type, eg "application/pdf";
        we use 'application/vnd.384.sb384app' to signal our own 'set' format
        (not yet registered at https://www.iana.org/form/media-types) */
    type?: string;

    /** size as reported when file was read by browser */
    size?: number; 
    /** size it takes up on a shard server (padded, encrypted, etc.) */
    actualFileSize?: number; 

    lastModified?: string; // refers to the file's last modified date (according to the browser)

    /**
     * 'fullName' constructed by sbfs to be _globally_ unique for a file:
     * name of file ('on disk'), last modified date, size, and sha256 hash of (unencrypted) contents
     */
    fullName?: string; // eg "/[0] Lecture 0 point 9 (v06).pdf [5/7/2021, 4:06:43 PM] [6853441 bytes] [6PNWGTx34llE]",

    // subset of 'fullName', excluding file name, eg only particulars 'inherent' in file
    metaDataString?: string // eg " [5/7/2021, 4:06:43 PM] [6853441 bytes] [6PNWGTx34llE]"

    timeStamp?: number; // this is when SBFile object was created/uploaded

    // an SBFile is it's own organizer
    fileMetaDataMap?: Map<string, SBFile>;

    // uniqueShardId?: string; // the shardId (regardless if it's inline or not)
    // uniqueId?: string;      // unique identifier, might be same as uniqueShardId

    /** if 'inline', contents is in 'file' */
    fileLocation?: string; // 'inline' means 'file' has contents

    /** actual file contents (if present); raw contents */
    file?: ArrayBuffer;

    /** historically we only supported up to chunk sizes files; to remain backwards compatible,
        a 'singleton' file (eg a file with contents smaller than chunk size) can either be
        directly as property 'handle', or as a singleton array '[handle]' */
    handle?: ObjectHandle;

    /** file contents are one or more shards. if there are more than one, then all except
        for the last one will be of size 'MAX_SBFILE_CHUNK_SIZE', the last one might be smaller. */
    handleArray?: ObjectHandle[];

    /** if present, a temporary hash array (eg for a set of files); if this is present,
        but 'handleArray' is not, then this is a large file and upload is in progress */
    hashArray?: string[];

    /** if present, link to the file/set on an app server
        eg: `${configuration.sb384appServer}/#${res.id}_${res.verification}_${res.key}_auto` */
    link?: string;

    /** if the file was read from a browser, this is the browser file object */
    browserFile?: File;

    constructor(
        fileInfo: {
            [key: string]: any;
        } = {}
    ) {
        const properties = [
            'actualFileSize', 'browserFile', 'file', 'fileLocation', 'fileMetaDataMap',
            'fullName', 'fullPath', 'handle', 'handleArray', 'hash', 'hashArray', 'lastModified', 'link',
            'metaDataString', 'name', 'path', 'sb384app', 'sb384appType', 'sb384appVersion',
            'size', 'timeStamp', 'type'
        ];
        for (const property of properties) {
            const prop = property as keyof typeof this;
            if (fileInfo[property] !== undefined) this[prop] = fileInfo[property];
            else delete this[prop];
        }
        if (DBG0) console.log("SBFile constructor:\n", this)
    }

    /** we use serialization as a forcing point to ensure that the object is complete
        and consistent. our principal use of serialization is in fact not JSON.stringify
        but our own packaging and unpackaging of objects for transmission. See 'getType()'. */
    toJSON(_key?: string) {
        if (_key && _key !== '') console.log("SBFile toJSON key: ", _key)
        if (this.size && this.size > SBFile.MAX_SBFILE_CHUNK_SIZE) {
            // it's a large file, so we do some separate consistency checking
            if (this.hashArray && this.hashArray.length > 0)
                throw new Error("[SBFile object] Large file, and it has not yet been fully uploaded")
            if (!this.handleArray) throw new Error("[SBFile object] Large file must have handleArray")
            if (Math.ceil(this.size! / SBFile.MAX_SBFILE_CHUNK_SIZE) !== this.handleArray.length)
                throw new Error("[SBFile object] Large file size does not match number of expected shards")
        } else if (this.fileMetaDataMap && this.fileMetaDataMap.size > 0 && !this.handleArray) {
            // SBFile is a set, all SBFile components are in the map
        } else if (this.handle) {
            // singleton
            if (!this.handleArray)
                // future-proofing
                this.handleArray = [this.handle];
        } else {
            if (this.fileLocation === 'inline')
                throw new Error("[SBFile object] Inline files cannot be serialized")
            if (!this.handleArray || this.handleArray.length === 0)
                throw new Error("[SBFile object] No handle nor handleArray, this is probably an error.")
            if (this.handleArray && this.handleArray.length !== 1)
                throw new Error("[SBFile object] Internal Error (L146)")
            if (this.handleArray && this.handleArray[0].verification) {
                // we need to check that it has been resolved
                const handleVerificationPromiseOrString = this.handleArray[0].verification;
                if (typeof handleVerificationPromiseOrString === 'string')
                    this.handleArray[0].verification = handleVerificationPromiseOrString; // make sure
                else
                    throw new Error("[SBFile object] Cannot serialize unresolved handle yet (verification not resolved)")
                this.handle = this.handleArray[0]; // backwards compatibility
            } else {
                throw new Error("[SBFile object] Singleton shard, handle has no verification value, this is probably an error.")
            }
        }

        // for future reference, this is full list of properties
        // const obj = Object.fromEntries(Object.entries(this).filter(([_, v]) => v !== undefined));

        // we only serialize the main properties
        let obj: { [k: string]: any; } = {
            _SBFSVersion: this._SBFSVersion,
            actualFileSize: this.actualFileSize,
            fileLocation: this.fileLocation,
            fileMetaDataMap: this.fileMetaDataMap,
            fullName: this.fullName,
            fullPath: this.fullPath,
            handle: this.handle,
            handleArray: this.handleArray,
            hash: this.hash,
            lastModified: this.lastModified,
            link: this.link,
            metaDataString: this.metaDataString,
            name: this.name,
            path: this.path,
            sb384app: this.sb384app,
            sb384appType: this.sb384appType,
            sb384appVersion: this.sb384appVersion,
            size: this.size,
            timeStamp: this.timeStamp,
            type: this.type,
        }
        // clean up and removed anything 'undefined'
        obj = Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
        return obj;
    }
}

/**
 * Helper function (tolerant) to confirm an object is SBFile
 * @public
 */
export function isSBFile(obj: any): obj is SBFile {
    return ((obj[SB_FILE_SYMBOL] === true) || (obj instanceof SBFile) || (obj._SBFSVersion === '2024-02-01-0002'));
}
