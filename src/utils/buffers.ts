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
const bs2dv = (bs: BufferSource) => bs instanceof ArrayBuffer
    ? new DataView(bs)
    : new DataView(bs.buffer, bs.byteOffset, bs.byteLength)


/**
 * Simple comparison of buffers
 * @internal
 */
export function compareBuffers(a: Uint8Array | ArrayBuffer | null, b: Uint8Array | ArrayBuffer | null): boolean {
    if (typeof a !== typeof b) return false
    if ((a == null) || (b == null)) return false
    const av = bs2dv(a)
    const bv = bs2dv(b)
    if (av.byteLength !== bv.byteLength) return false
    for (let i = 0; i < av.byteLength; i++)  if (av.getUint8(i) !== bv.getUint8(i)) return false
    return true
}

/**
* Appends an array of buffers and returns a new buffer
* @internal
*/
export function _appendBuffers(buffers: (Uint8Array | ArrayBuffer)[]): ArrayBuffer {
    let totalLength = 0;
    for (const buffer of buffers)
        totalLength += buffer.byteLength;
    const tmp = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
        tmp.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }
    return tmp.buffer;
}

