// (c) 2023-2024 384 (tm)

import { ChannelId } from '../index'
import { arrayBufferToBase62 } from '../utils/b62'

import { SBError } from '../common'
const DBG0 = false;

const SBStorageTokenPrefix = 'LM2r' // random prefix

export const SB_STORAGE_TOKEN_SYMBOL = Symbol.for('SBStorageToken')

/**
 * Verbose format of a storage token. In most circumstances, you'll only need
 * the 'hash' field (string).
 * 
 * Validator is {@link validate_SBStorageToken}.
 * @public
 * */
export interface SBStorageToken {
  [SB_STORAGE_TOKEN_SYMBOL]?: boolean,
  hash: string, // random base62 string
  size?: number,
  motherChannel?: ChannelId,
  created?: number,
  used?: boolean,
  success?: boolean // when returned from server API
}

export function _check_SBStorageToken(data: SBStorageToken) {
  return (
    Object.getPrototypeOf(data) === Object.prototype
    && data.hash && typeof data.hash === 'string' && data.hash.length > 0
    && (!data.size || Number.isInteger(data.size) && data.size > 0)
    && (!data.motherChannel || typeof data.motherChannel === 'string')
    && (!data.created || Number.isInteger(data.created))
    && (!data.used || typeof data.used === 'boolean')
  )
}

/**
 * Validates @link{SBStorageToken}, throws if there's an issue.
 * @public
 * */
export function validate_SBStorageToken(data: SBStorageToken): SBStorageToken {
  if (!data) throw new SBError(`invalid SBStorageToken (null or undefined)`)
  else if (data[SB_STORAGE_TOKEN_SYMBOL]) return data as SBStorageToken
  else if (typeof data === 'string' && (data as string).slice(0, 4) === SBStorageTokenPrefix)
    // if at runtime we get just the hash, we 'upgrade' the type to help caller
    return { [SB_STORAGE_TOKEN_SYMBOL]: true, hash: data as string } as SBStorageToken
  else if (_check_SBStorageToken(data)) {
    return { ...data, [SB_STORAGE_TOKEN_SYMBOL]: true } as SBStorageToken
  } else {
    if (DBG0) console.error('invalid SBStorageToken ... trying to ingest:\n', data)
    throw new SBError(`invalid SBStorageToken`)
  }
}


/**
 * This is whatever token system the channel server uses.
 * 
 * For example with 'channel-server', you could command-line bootstrap with
 * something like:
 * 
 * '''bash
 *   wrangler kv:key put --preview false --binding=LEDGER_NAMESPACE "zzR5Ljv8LlYjgOnO5yOr4Gtgr9yVS7dTAQkJeVQ4I7w" '{"used":false,"size":33554432}'
 * 
 * This is available in the cli.
 * 
 * @public
 * 
 */
export type SBStorageTokenHash = string

/**
 * Generates a new (random) storage token hash in the correct format. Note,
 * this doesn't 'authorize' the token anywhere or associate it with 
 * a storage amount.
 */
export function generateStorageToken(): SBStorageTokenHash {
  return SBStorageTokenPrefix + arrayBufferToBase62(crypto.getRandomValues(new Uint8Array(32)).buffer)
}
