// (c) 2023-2024 384 (tm)

import { Base62Encoded, arrayBufferToBase62 } from '../utils/b62'

import { NONCE_CONSTRUCTOR, NONCE_TYPE, SALT_TYPE, SALT_CONSTRUCTOR } from '../types'

// export type SALT_TYPE = ArrayBuffer;
// export const SALT_CONSTRUCTOR = ArrayBuffer;
// export type NONCE_TYPE = Uint8Array; // iv
// export const NONCE_CONSTRUCTOR = Uint8Array;

const DBG0 = false;

// this library only supports '3'
/** @internal */ export type ObjectHandleVersions = '1' | '2' | '3'
export const currentSBOHVersion: ObjectHandleVersions = '3'

/**
 * This is the lowest-level format of shard information that's presented across
 * an API. Internally, the storage server uses slightly different interfaces.
 * @public
 */
export interface ShardInfo {
  version?: ObjectHandleVersions,
  id: Base62Encoded, // strictly speaking, only id is needed
  iv?: NONCE_TYPE | Base62Encoded,
  salt?: SALT_TYPE | Base62Encoded,
  actualSize?: number, // actual size of underlying (packaged, padded, and encrypted) contents
  verification?: Promise<string> | string,
  data?: WeakRef<ArrayBuffer> | ArrayBuffer, // if present, the raw data (packaged, encrypted)
}

export const SB_OBJECT_HANDLE_SYMBOL = Symbol.for('ObjectHandle')

/**
 * ObjectHandle  (extends ShardInfo)
 *
 * ObjectHandle encodes necessary information for a shard, as well as some
 * conveniences for making contents available after it's loaded.
 *
 * - id is a 43 character base62 string that identifies the object. It is used
 *   to retrieve the object from the storage server.
 *
 * - version is a single character string that indicates the version of the
 *   object handle. '1' and '2' are legacy, '3' is current.
 * 
 * - key is a 43 character base62
 *
 * - verification is a random (server specific) string that is used to verify
 *   that you're allowed to access the object (specifically, that somebody,
 *   perhaps you, has paid for the object).
 *
 * - iv and salt are optional, but provide some safeguards. Object server
 *   will provide these for an object.
 * 
 * - hash can be slightly confusing: it hashes the packaged (but not encrypted,
 *   nor padded) contents. It needs to hash the packaged contents since 'payload'
 *   can be any object, and the hashing needs to operate against an array buffer.
 *   If the object per se is an arraybuffer (eg a chunk of a large file), then
 *   it will nevertheless be hashed in the 'payload' format. This is the hash
 *   that the global 'ChannelApi.knownShards' uses as index.
 * 
 * Validator is {@link validate_ObjectHandle}.
 *
 * @public
 */
export interface ObjectHandle extends ShardInfo {
  [SB_OBJECT_HANDLE_SYMBOL]?: boolean,
  key?: Base62Encoded, // decryption key
  /** if present, clarifies where to get it (or where it was found) */
  storageServer?: string,

  // ToDo: might want to transition to weakref
  payload?: any // if present, decrypted and extracted data

  // for some backwards compatibility. slowly being deprecated.
  type?: string,

  /** hash of the object (hashed in payload format) */
  hash?: string,

  /**
   * Signature is a base62 encoded string that is used to verify the integrity
   * of a 'publisher' and the object. It can be used in different ways, but
   * the corresponding public key is always inside the object. This allows
   * composite objects (such as os384 applications) to internally define
   * publisher, and the resulting ObjectHandle can then be signed.
   * The object will "work" just fine without it, but some other services
   * (such as the os384 app launcher) will check it. 
   */
  signature?: string,

  // // various additional properties are optional. note that core SB lib does not
  // // have a concept of a 'file'
  // fileName?: string, // by convention will be "PAYLOAD" if it's a set of objects
  // dateAndTime?: string, // time of shard creation
  // fileType?: string, // file type (mime)
  // lastModified?: number, // last modified time (of underlying file, if any)
  // savedSize?: number, // size of shard (may be different from actualSize)
}

export function _check_ObjectHandle(h: ObjectHandle) {
  return (
    Object.getPrototypeOf(h) === Object.prototype
    && (!h.version || h.version === currentSBOHVersion) // anything 'this' code sees needs to be v3
    && h.id && typeof h.id === 'string' && h.id.length === 43
    && (!h.key || (typeof h.key === 'string' && h.key.length === 43))
    && (!h.verification || typeof h.verification === 'string' || typeof h.verification === 'object')
    && (!h.iv || typeof h.iv === 'string' || h.iv instanceof NONCE_CONSTRUCTOR)
    && (!h.salt || typeof h.salt === 'string' || h.salt instanceof SALT_CONSTRUCTOR)
  )
}

/**
 * Validate ObjectHandle, throws if there's an issue
 * @public
 */
export function validate_ObjectHandle(h: ObjectHandle) {
  if (!h) throw new Error(`invalid ObjectHandle (null or undefined)`)
  else if (h[SB_OBJECT_HANDLE_SYMBOL]) return h as ObjectHandle
  else if (_check_ObjectHandle(h)) {
    return { ...h, [SB_OBJECT_HANDLE_SYMBOL]: true } as ObjectHandle
  } else {
    if (DBG0) console.error('invalid ObjectHandle ... trying to ingest:\n', h)
    throw new Error(`invalid ObjectHandle`)
  }
}

/**
 * In some circumstances we need to make sure we have a JSON serializable
 * version of the object handle, eg that iv and salt are base62 strings,
 * and that the verification has been resolved
 * @public
 */
export async function stringify_ObjectHandle(h: ObjectHandle) {
  if (h.iv) h.iv = typeof h.iv === 'string' ? h.iv : arrayBufferToBase62(h.iv)
  if (h.salt) h.salt = typeof h.salt === 'string' ? h.salt : arrayBufferToBase62(h.salt)
  h.verification = await h.verification
  return validate_ObjectHandle(h)
}
