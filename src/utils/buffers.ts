// (c) 2024 384 (tm)

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

