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
/*
 * SELECTIVE things from server workers; ToDo: merge to identical
*/

import { ServerDeepHistory } from "../index";

import { MAX_SB_BODY_SIZE as _MAX_SB_BODY_SIZE } from "../channel/config";

const _STORAGE_SIZE_UNIT = 4096 // 4KB

export const serverConstants = {
    // minimum unt of storage
    STORAGE_SIZE_UNIT: _STORAGE_SIZE_UNIT,

    // Currently minimum (raw) storage is set to 32KB. This will not
    // be LOWERED, but future design changes may RAISE that. 
    STORAGE_SIZE_MIN: 8 * _STORAGE_SIZE_UNIT,

    // Current maximum (raw) storage is set to 16MB. This may change.
    // Note that this is for SHARDS not CHANNEL
    STORAGE_SIZE_MAX: 4096 * _STORAGE_SIZE_UNIT,

    // // new channel budget (bootstrap) is 3 GB (about $1)
    // NEW_CHANNEL_BUDGET: 3 * 1024 * 1024 * 1024, // 3 GB

    // sanity check - set a max at one petabyte (2^50) .. at a time
    MAX_BUDGET_TRANSFER: 1024 * 1024 * 1024 * 1024 * 1024, // 1 PB

    // see discussion elsewhere
    MAX_SB_BODY_SIZE: _MAX_SB_BODY_SIZE,

    // maximum number of (perma) messages kept in KV format; beyond this,
    // messages are shardified. note that current CF hard limit is 1000.
    MAX_MESSAGE_SET_SIZE: ServerDeepHistory.MAX_MESSAGE_SET_SIZE,
    MESSAGE_HISTORY_BRANCH_FACTOR: ServerDeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR,
}

export const serverApiCosts = {
    // multiplier of cost of storage on channel vs. storage server
    // (this includes Pages)
    CHANNEL_STORAGE_MULTIPLIER: 8.0,
    CHANNEL_STORAGE_MULTIPLIER_TTL_ZERO: 1.0/8.0 // upwards 1/100th cost of storing
}

// internal - handle assertions
export function _sb_assert(val: unknown, msg: string) {
    if (!(val)) {
        const m = `<< SB assertion error: ${msg} >>`;
        throw new Error(m);
    }
}

// appends one to the other
export function _appendBuffer(buffer1: Uint8Array | ArrayBuffer, buffer2: Uint8Array | ArrayBuffer): ArrayBuffer {
    const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
}

// list of MIME types that are considered "text-like", which a Page retrieval
// will attempt to decode as text
export const textLikeMimeTypes: Set<string> = new Set([
    // Textual Data
    "text/plain",
    "text/html",
    "text/css",
    "text/javascript", // Note: application/javascript is more correct for JS
    "text/xml",
    "text/csv",

    // Application Data (often textual in nature)
    "application/json",
    "application/javascript", // More correct MIME type for JavaScript
    "application/xml",
    "application/xhtml+xml",
    "application/rss+xml",
    "application/atom+xml",

    // Markup Languages
    "image/svg+xml",
]);

// Example function to check if a MIME type is considered "text-like"
export function isTextLikeMimeType(mimeType: string): boolean {
    return textLikeMimeTypes.has(mimeType);
}

// // Example usage
// console.log(isTextLikeMimeType("text/html")); // true
// console.log(isTextLikeMimeType("application/json")); // true
// console.log(isTextLikeMimeType("image/jpeg")); // false


// Reminder of response codes we use:
//
// 101: Switching Protocols (downgrade error)
// 200: OK
// 400: Bad Request
// 401: Unauthorized
// 403: Forbidden
// 404: Not Found
// 405: Method Not Allowed
// 413: Payload Too Large
// 418: I'm a teapot
// 429: Too Many Requests
// 500: Internal Server Error
// 501: Not Implemented
// 507: Insufficient Storage (WebDAV/RFC4918)
//
export type ResponseCode = 101 | 200 | 400 | 401 | 403 | 404 | 405 | 413 | 418 | 429 | 500 | 501 | 507;
export interface ReturnOptions {
    status?: ResponseCode,
    delay?: number,
    headers?: HeadersInit,
    type?: string // MIME type, if omitted defaults to 'sb384payloadV3' eg payload/octet-stream
}
