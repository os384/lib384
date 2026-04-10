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
import { jsonParseWrapper } from 'src/utils/json';
import { _appendBuffers } from './buffers';
import { SBError } from 'src/utils/error';
import { SEP } from 'src/utils/sep';

const DBG0 = false;

/**
 * Payloads
 * 
 * To serialize/deserialize various javascript (data) structures into
 * binary and back, we define a 'payload' format. This is 'v003', for
 * the next version we should consider aligning with CBOR (RFC 8949).
 */

// support for our internal type 'i' (32 bit signed integer)
function is32BitSignedInteger(number: number) {
  const MIN32 = -2147483648, MAX32 = 2147483647;
  return (typeof number === 'number' && number >= MIN32 && number <= MAX32 && number % 1 === 0);
}

/**
 * Our internal type letters:
 * 
 * a - Array
 * 8 - Uint8Array
 * b - Boolean
 * d - Date
 * i - Integer (32 bit signed)
 * j - JSON (stringify)
 * m - Map
 * 0 - Null
 * n - Number (JS internal)
 * o - Object
 * s - String
 * t - Set
 * u - Undefined
 * v - Dataview
 * x - ArrayBuffer
 * 
 * @internal
 */
function getType(value: any) {
  if (value === null) return '0';
  if (value === undefined) return 'u';
  if (Array.isArray(value)) return 'a';
  if (value instanceof ArrayBuffer) return 'x';
  if (value instanceof Uint8Array) return '8';
  if (typeof value === 'boolean') return 'b';
  if (value instanceof DataView) return 'v';
  if (value instanceof Date) return 'd';
  if (value instanceof Map) return 'm';
  if (typeof value === 'number') return is32BitSignedInteger(value) ? 'i' : 'n';
  if (value !== null && typeof value === 'object' && value.constructor === Object) return 'o';
  if (value instanceof Set) return 't';
  if (typeof value === 'string') return 's';
  if (value instanceof WeakRef)
    throw new SBError("[assemblePayload] WeakRef cannot be serialized — caller must resolve or strip it before serialization");

  // if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
  //   // it's a typed array; currently we're only supporting Uint8Array
  //   if (value.constructor.name === 'Uint8Array') return '8';
  //   console.error(`[getType] Only supported typed array is Uint8Array (got '${value.constructor.name}')`);
  //   return '<unsupported>';
  // }
  if (typeof value === 'object' && typeof value.then === 'function')
    console.error("[getType] Trying to serialize a Promise - did you forget an 'await'?");
  else if (typeof value === 'object' && typeof value.toJSON === 'function')
    return 'j'; // JSON.stringify(value) will be used
  else
    console.error('[getType] Unsupported for object:', value);
  throw new SBError('Unsupported type');
}

function _assemblePayload(data: any): ArrayBuffer | null {
  try {
    const metadata: any = {};
    let keyCount = 0;
    let startIndex = 0;
    let BufferList: Array<ArrayBuffer> = [];
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        const value = data[key];
        const type = getType(value);
        // if (DBG2) console.log(`[assemblePayload] key: ${key}, type: ${type}`)
        switch (type) {
          case 'o': // Object (eg structure)
            const payload = _assemblePayload(value);
            if (!payload) throw new SBError(`Failed to assemble payload for ${key}`);
            BufferList.push(payload);
            break;
          case 'j': // JSON
            // const jsonValue = new TextEncoder().encode(JSON.stringify(value));
            // 20240408 update: actually, it's the same as 'o' except we first call toJSON
            // BufferList.push(jsonValue.buffer);
            const toJSONvalue = _assemblePayload(value.toJSON(""));
            if (!toJSONvalue) throw new SBError(`Failed to process toJSON for ${key}`);
            BufferList.push(toJSONvalue);
            break;
          case 'n': // Number (IEEE 754 double precision)
            const numberValue = new Uint8Array(8);
            new DataView(numberValue.buffer).setFloat64(0, value);
            BufferList.push(numberValue.buffer);
            break;
          case 'i': // Integer (32 bit signed)
            const intValue = new Uint8Array(4);
            new DataView(intValue.buffer).setInt32(0, value);
            BufferList.push(intValue.buffer);
            break;
          case 'd': // Date
            const dateValue = new Uint8Array(8);
            new DataView(dateValue.buffer).setFloat64(0, value.getTime());
            BufferList.push(dateValue.buffer);
            break;
          case 'b': // Boolean
            const boolValue = new Uint8Array(1);
            boolValue[0] = value ? 1 : 0;
            BufferList.push(boolValue.buffer);
            break;
          case 's': // String
            const stringValue = new TextEncoder().encode(value);
            BufferList.push(stringValue);
            break;
          case 'x': // ArrayBuffer
            BufferList.push(value);
            break;
          case '8': // Uint8Array
            BufferList.push(value.buffer);
            break;
          case 'm': // Map
            const mapValue = new Array();
            value.forEach((v: any, k: any) => {
              mapValue.push([k, v]);
            });
            const mapPayload = _assemblePayload(mapValue);
            if (!mapPayload) throw new SBError(`Failed to assemble payload for ${key}`);
            BufferList.push(mapPayload);
            break;
          case 'a': // Array
            const arrayValue = new Array();
            value.forEach((v: any) => {
              arrayValue.push(v);
            });
            const arrayPayload = _assemblePayload(arrayValue);
            if (!arrayPayload) throw new SBError(`Failed to assemble payload for ${key}`);
            BufferList.push(arrayPayload);
            break;
          case 't': // Set
            const setValue = new Array();
            value.forEach((v: any) => {
              setValue.push(v);
            });
            const setPayload = _assemblePayload(setValue);
            if (!setPayload) throw new SBError(`Failed to assemble payload for ${key}`);
            BufferList.push(setPayload);
            break;
          case '0': // Null
            BufferList.push(new ArrayBuffer(0));
            break;
          case 'u': // Undefined
            BufferList.push(new ArrayBuffer(0));
            break;
          case 'v': // Dataview, not supporting for now
          default:
            console.error(`[assemblePayload] Unsupported type: ${type}`);
            throw new SBError(`Unsupported type: ${type}`);
        }
        const size = BufferList[BufferList.length - 1].byteLength;
        keyCount++;
        metadata[keyCount.toString()] = { n: key, s: startIndex, z: size, t: type };
        startIndex += size;
      }
    }

    const metadataBuffer = new TextEncoder().encode(JSON.stringify(metadata));
    const metadataSize = new Uint32Array([metadataBuffer.byteLength]);

    let payload = _appendBuffers([metadataSize.buffer, metadataBuffer, ...BufferList]);

    return payload;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Assemble payload. This creates a single binary (wire) format
 * of an arbitrary set of (named) binary objects. os384 payloads
 * are always ArrayBuffer objects, and always start with a 4-byte
 * identifier 0xAABBBBAA (which is easy to spot in a hex editor).
 * @public
 */
export function assemblePayload(data: any): ArrayBuffer | null {
  if (DBG0 && data instanceof ArrayBuffer) console.warn('[assemblePayload] Warning: data is already an ArrayBuffer, make sure you are not double-encoding');
  const mainPayload = _assemblePayload({ ver003: true, payload: data })
  if (!mainPayload) return null;
  return _appendBuffers([new Uint8Array([0xAA, 0xBB, 0xBB, 0xAA]), mainPayload]);
}

function deserializeValue(buffer: ArrayBuffer, type: string): any {
  switch (type) {
    case 'o':
      return _extractPayload(buffer);
    case 'j': // JSON
      // if it can be extracted as a JSON, then it was stored by JSON.stringify
      try {
        return JSON.parse(new TextDecoder().decode(buffer));
      } catch (e) {
        // otherwise treat it as 'o'
        return _extractPayload(buffer);
      }
    // return jsonParseWrapper(new TextDecoder().decode(buffer), "L1322");
    case 'n': // Number
      return new DataView(buffer).getFloat64(0);
    case 'i': // Integer (32 bit signed)
      return new DataView(buffer).getInt32(0);
    case 'd': // Date
      return new Date(new DataView(buffer).getFloat64(0));
    case 'b': // Boolean
      return new Uint8Array(buffer)[0] === 1;
    case 's': // String
      return new TextDecoder().decode(buffer);
    case 'a': // Array
      const arrayPayload = _extractPayload(buffer);
      if (!arrayPayload) throw new SBError(`Failed to assemble payload for ${type}`);
      return Object.values(arrayPayload);
    case 'm': // Map
      const mapPayload = _extractPayload(buffer);
      if (!mapPayload) throw new SBError(`Failed to assemble payload for ${type}`);
      const map = new Map();
      for (const key in mapPayload) {
        map.set(mapPayload[key][0], mapPayload[key][1]);
      }
      return map;
    case 't': // Set
      const setPayload = _extractPayload(buffer);
      if (!setPayload) throw new SBError(`Failed to assemble payload for ${type}`);
      const set = new Set();
      for (const key in setPayload) {
        set.add(setPayload[key]);
      }
      return set;
    case 'x': // ArrayBuffer
      return buffer;
    case '8': // Uint8Array
      return new Uint8Array(buffer);
    case '0': // Null
      return null;
    case 'w': // WeakRef was serialized — this means data was lost (GC race during serialization)
      console.warn("[extractPayload] encountered type 'w' (WeakRef) — data at this field was lost during serialization");
      return null;
    case 'u': // Undefined
      return undefined;
    case 'v':
    case '<unsupported>':
    default:
      throw new SBError(`Unsupported type: ${type}`);
  }
}

// todo: move this to a more general location
export function inspectBinaryData(data: ArrayBuffer | ArrayBufferView) {
  const LINE_WIDTH = 40

  if (!data) return ('******* <empty> ******* (no value provided to inspectBinaryData)')

  let byteArray;
  if (data instanceof ArrayBuffer) {
      byteArray = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
      byteArray = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
      throw new Error('Unsupported data type');
  }
  const hexLine: Array<string> = [];
  const asciiLine: Array<string> = [];
  const lines: Array<string> = [];
  const lineLength = LINE_WIDTH; // You can adjust this as needed
  byteArray.forEach((byte, i) => {
      hexLine.push(byte.toString(16).padStart(2, '0'));
      asciiLine.push(byte >= 32 && byte <= 127 ? String.fromCharCode(byte) : '.');
      if ((i + 1) % lineLength === 0 || i === byteArray.length - 1) {
          // Pad the hex line if it's the last line and not full
          while (hexLine.length < lineLength) {
              hexLine.push('  ');
              asciiLine.push(' ');
          }
          lines.push(hexLine.join(' ') + ' | ' + asciiLine.join(''));
          hexLine.length = 0;
          asciiLine.length = 0;
      }
  });
  return lines.join('\n');
}

function _extractPayload(payload: ArrayBuffer): any {
  const parsingMsgError = 'Cannot parse metadata, this is not a well-formed payload';
  // if (DBG2) console.log(`[extractPayload] payload: ${payload.byteLength} bytes`)
  try {
    const metadataSize = new Uint32Array(payload.slice(0, 4))[0];
    const decoder = new TextDecoder();
    const json = decoder.decode(payload.slice(4, 4 + metadataSize));
    let metadata: any;
    try {
      metadata = jsonParseWrapper(json, "L1290");
    } catch (e) {
      if (DBG0) console.error(SEP, `[extractPayload] Failed to parse metadata: '${json}'`, SEP, "Binary (parent) data:", inspectBinaryData(payload));
      throw new SBError(parsingMsgError);
    }
    const startIndex = 4 + metadataSize;


    const data: any = {};
    for (let i = 1; i <= Object.keys(metadata).length; i++) {
      const index = i.toString();
      if (metadata[index]) {
        const entry = metadata[index];
        const propertyStartIndex = entry['s'];
        const size = entry['z'];
        const type = entry['t'];
        const buffer = payload.slice(startIndex + propertyStartIndex, startIndex + propertyStartIndex + size);
        data[entry['n']] = deserializeValue(buffer, type);
      } else {
        console.log(`found nothing for index ${i}`);
      }
    }
    return data;
  } catch (e) {
    // if it's the exception we threw above, just rethrow it
    if (e instanceof Error && e.message === parsingMsgError) throw e;
    throw new SBError('[extractPayload] exception <<' + e + '>> [/extractPayload]');
  }
}
/**
 * Extract payload - this decodes from our binary (wire) format
 * to a JS object. This supports a wide range of objects.
 * @public
 */
export function extractPayload(value: ArrayBuffer): any {
  const verifySignature = (v: ArrayBuffer) => new Uint32Array(v, 0, 1)[0] === 0xAABBBBAA;
  if (DBG0) console.log(SEP, '[extractPayload] called with ArrayBuffer:', SEP, inspectBinaryData(value), SEP);
  if (!verifySignature(value)) {
    const msg = 'Invalid payload signature (this is not a payload)';
    if (DBG0) console.error('\n', SEP, msg, '\n', value as any, SEP);
    throw new SBError(msg);
  }
  // now i need to strip out the first four bytes
  return _extractPayload(value.slice(4));
}