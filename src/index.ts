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

// export const version = '20250328.0' // this is top lev (lib/os) version
export const version = '20260330.1' // wow it's been exactly a year since the last release ...

export type {
    ChannelId, SBUserId, SBUserPrivateKey, SBUserPublicKey,
} from './common'
export { SBError, SBApiFetch, jsonParseWrapper, isSBUserId } from './common'

export { boot } from './boot/index'
export { SBServiceWorker } from './boot/serviceWorker';
export { loadShard, bootstrapJsLib } from './boot/loadShard'
export { bootstrapLoaderClass } from './boot/loaderLoader'
export { getDomainDetails } from './boot/tld'

export { strongphrase } from './strongphrase/index'
export {
    generatePassPhrase,
    generateStrongKey,
    recreateStrongKey,
} from './strongphrase/strongphrase'

export { utils } from './utils/index'
export {
    base64ToArrayBuffer,
    arrayBufferToBase64url,
} from './utils/b64'
export {
    arrayBufferToBase62,
    base62ToArrayBuffer,
    isBase62Encoded,
    b62regex,
} from './utils/b62'
export type { Base62Encoded } from './utils/b62'
export { Timeout } from './utils/timeout'

export {
    extractPayload,
    assemblePayload,
} from './utils/payloads'
export { _appendBuffers, compareBuffers } from './utils/buffers'
export { MessageQueue } from './utils/MessageQueue'
export { base62ToBase64, base64ToBase62 } from './utils/index'
export { SBEventTarget } from './utils/SBEventTarget'
export { AsyncSequence } from './utils/AsyncSequence'

export { sbCrypto } from './sbCrypto/index'
export {
    generateStrongPin,
    generateStrongPin16,
} from './sbCrypto/strongpin'
export type { } from './sbCrypto/strongpin';
export { SB384 } from './sbCrypto/SB384'
export { SBCrypto, hydrateKey } from './sbCrypto/SBCrypto'

export { file } from './file/index'
export {
    SBFile,
    isSBFile
} from './file/SBFile'

export { browser } from './browser/index'
export { BrowserFileTable } from './browser/BrowserFileTable';
export { browserPreviewFile } from './browser/browserPreviewFile';
export { BrowserFileHelper, getMimeType } from './browser/BrowserFileHelper'
export { clearBrowserState } from './browser/utils'
export { readJpegHeader } from './browser/images'

export { StorageApi } from './storage/StorageApi'
export type { ObjectHandle } from './storage/ObjectHandle';
export { validate_ObjectHandle, stringify_ObjectHandle } from './storage/ObjectHandle';
export type { SBStorageToken } from './storage/StorageToken'
export { validate_SBStorageToken, generateStorageToken } from './storage/StorageToken'
export { DeepHistory, ServerDeepHistory, ClientDeepHistory } from './storage/MessageHistory'
export { HistoryTree, HistoryTreeNode } from './storage/HistoryTree'
export { fetchDataFromHandle, fetchPayload } from './storage/core'

export { channel } from './channel/index'
export type { Message } from './channel/Message'
export { MessageCache } from './channel/MessageCache'
export { MessageType } from './channel/MessageType';
export { ChannelStream } from './channel/ChannelStream'
export { ChannelApi, validate_ChannelApiBody } from './channel/ChannelApi'
export { Channel, validate_SBChannelData } from './channel/Channel'
export { ChannelKeys } from './channel/ChannelKeys'
export type { ChannelHandle } from './channel/ChannelHandle'
export { validate_ChannelHandle } from './channel/ChannelHandle'
export type { SBProtocol, Protocol_KeyInfo } from './channel/Protocol'
export { Protocol_AES_GCM_256, Protocol_ECDH } from './channel/Protocol'
export { stripChannelMessage, validate_ChannelMessage } from './channel/ChannelMessage'
export type { ChannelMessage } from './channel/ChannelMessage'
export { ChannelSocket } from './channel/ChannelSocket'
export { NEW_CHANNEL_MINIMUM_BUDGET } from './channel/config'


export { SBFileSystem } from './file/SBFileSystem'
export { SBFileSystem2 } from './file/SBFileSystem2'
export type { FileSetMeta } from './file/SBFS';

export { AppMain } from './app/AppMain'

export type { StrongphraseParams } from './strongphrase/strongphrase';

export { isTextLikeMimeType, serverApiCosts } from './workers/workers'

// these are typically set in the build process
//
declare var DBG2: boolean;

// general pattern: 'DBG0' is used 'locally' in files, 'DBG2' globally,
// and 'DBG' might be reintroduced as global (lightweight) output
if (typeof DBG2 === 'undefined') (globalThis as any).DBG2 = false

var DBG0 = false // internal, set it to 'true' or 'DBG2'
if (DBG0) console.log("++++ Setting DBG0 to TRUE ++++");


