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
const SB_CHANNEL_MESSAGE_SYMBOL = Symbol('SB_CHANNEL_MESSAGE_SYMBOL')

import {
    _sb_assert, ChannelId, SBUserId,
    SBError, DBG2,
    isSBUserId,
} from 'src/common'

import { SBProtocol } from './Protocol'
import { _check_ChannelHandle } from './ChannelHandle'
import { _check_SBChannelData } from './Channel'
import { MessageTtl } from './Message'

import { NONCE_TYPE, SALT_TYPE } from '../types'

/**
 * SB standard wrapped encrypted messages. This is largely 'internal', normal
 * usage of the library will work at a higher level, see @link{Message}.
 *
 * Encryption is done with AES-GCM, 16 bytes of salt.
 *
 * Timestamp prefix is twenty six (26) [0-3] characters. It encodes epoch
 * milliseconds * 4^4 (last four are '0000').
 *
 * "Everything is optional" as this is used in multiple contexts.
 *
 * Note that channel server doesn't need userPublicKey on every channel message
 * since it's provided on websocket setup.
 *
 * Complete channel "\_id" is channelId + '\_' + subChannel + '\_' +
 * timestampPrefix This allows (prefix) searches within time spans on a per
 * channel (and if applicable, subchannel) basis. Special subchannel 'blank'
 * (represented as '____') is the default channel and generally the only one
 * that visitors have access to.
 *
 * A core exception is that all messages with a TTL in the range 1-7 (eg range
 * of 1 minute to 72 hours) are duplicated onto subchannels matching the TTLs,
 * namely '___1', '___2', '___3', etc. Thus an oldMessages fetch can for example
 * request '___4' to get all messages that were sent with TTL 4 (eg 1 hour).
 * Which also means that as Owner, if you set TTL on a message then you can't
 * use the fourth character (if you try to while setting a TTL, channel server
 * will reject it).
 *
 * Properties that are generally retained or communicated inside payload
 * packaging have short names (apologies for lack of readability).
 * 'unencryptedContents' has a long and cumbersome name for obvious reasons.
 *
 * There are a couple of semantics that are enforced by the channel server;
 * since this is partly a policy issue of the channel server, anything in this
 * documentation might be incomplete. For example, baseline channel server
 * does not allow messages to both be 'infinite ttl' and addressed (eg have a
 * 'to' field value). 
 *
 * If any protocol wants to do additional or different encryption, it would need
 * to wrap: the core binary format is defined to have room for iv and salt, and
 * prescribes sizes 12 and 16 respectively. Strictly speaking, the protocol can
 * use these 28 bytes for whatever it wants. A protocol that wants to do
 * something completely different can simply modify the 'c' (contents) buffer
 * and append any binary data it needs.
 * 
 * Validator is {@link validate_ChannelMessage}.
 *
 * @public
 */
export interface ChannelMessage {
    [SB_CHANNEL_MESSAGE_SYMBOL]?: boolean,
  
    // the following is minimum when *sending*. see also stripChannelMessage()
  
    /** 'from': public (hash) of sender, matches publicKey of sender, verified by channel server */
    f?: SBUserId, 
    /** encrypted contents, or an unencrypted 'string message' if 'stringMessage' is true */
    c?: ArrayBuffer | string, 
    /** nonce, always present whether needed by protocol or not (12 bytes) */
    iv?: NONCE_TYPE, 
    /** salt, always present whether needed by protocol or not (16 bytes) */
    salt?: SALT_TYPE, 
    /** sender signature */
    s?: ArrayBuffer, // ToDo: list here exactly what is signed
    /** timestamp at point of encryption, by client, verified along with encrypt/decrypt */
    ts?: number, 
    /** channel server, if present, clarifies where message was processed */
    cs?: string, 
  
    // the remainder are either optional (with default values), internally used,
    // server provided, or can be reconstructed
  
    /** (optional) channelId base62 x 43 */
    channelId?: ChannelId, 
    /** (optional) subchannel; default is '____', can be any 4xbase62; only owner can read/write subchannels */
    i2?: string, 
    /**  timestamp from server */
    sts?: number,
    /** string/base4 encoding of timestamp (see timestampToBase4String) */
    timestampPrefix?: string, 
    /** '_id' format is: channelId + '\_' + subChannel + '\_' + timestampPrefix */
    _id?: string, 
    /** if present, hash of previous message from this sender */
    p?: string; // ToDo: need to make sure lib384 tries to use this consistently
  
    /** whatever is being sent; should (must) be stripped when sent. when
        encrypted, this is packaged as payload first (signing is done on the
        payload version) */
    unencryptedContents?: any,
    /** internal, if true then do not package (special 'string' message type) */
    stringMessage?: boolean,
  
    /** if present, signals other side is ready to receive messages (rest of message ignored) */
    ready?: boolean, 
    /** if present, signals error (and rest of message ignored) */
    error?: string,
    /** 'to': public (hash) of recipient; note that Owner sees all messages; if omitted usually means broadcast */
    t?: SBUserId,
    /** Value 0-15; if it's missing it's 15/0xF (infinite); if it's 1-7 it's duplicated to subchannels */
    ttl?: MessageTtl, 
    /** protocol to be used for message */
    protocol?: SBProtocol,
  }
  
  /**
   * Validates 'ChannelMessage', throws if there's an issue. Checks for a lot
   * of things. It does not explain itself. Don't count on it to catch everything.
   * Note that you should use the returned value, as this function might fix
   * some minor things (like converting iv from ArrayBuffer to Uint8Array).
   * @public
   */
  export function validate_ChannelMessage(body: ChannelMessage): ChannelMessage {
    // we 'fix' body.iv, if it's an ArrayBuffer we convert to Uint8Array
    if (body && body.iv && body.iv instanceof ArrayBuffer) body.iv = new Uint8Array(body.iv)
    if (!body) throw new SBError(`invalid ChannelMessage (null or undefined)`)
    else if (body[SB_CHANNEL_MESSAGE_SYMBOL]) return body as ChannelMessage
    else if (
      // these are minimally required
      (body.f && isSBUserId(body.f))
      && ((body.c && !body.stringMessage && body.c instanceof ArrayBuffer) 
        || (body.c && body.stringMessage && typeof body.c === 'string'))
      && (body.ts && Number.isInteger(body.ts))
      && (body.iv && body.iv instanceof Uint8Array && body.iv.length === 12)
      
      // salt might be absent at early phases, but, i don't think we call
      // validate_ChannelMessage at those points? anyway, making this more strict
      && (body.salt && body.salt instanceof ArrayBuffer && body.salt.byteLength === 16)
      // && (!body.salt || body.salt instanceof ArrayBuffer && body.salt.byteLength === 16)

      && (body.s && body.s instanceof ArrayBuffer)
      && (body.cs === undefined || typeof body.cs === 'string')
  
      && (!body.sts || Number.isInteger(body.sts)) // if present came from server
  
      // todo: might as well add regexes to some of these
      && (!body._id || (typeof body._id === 'string' && body._id.length === 86)) // that's resulting length
      && (!body.ready || typeof body.ready === 'boolean')
      && (!body.timestampPrefix || (typeof body.timestampPrefix === 'string' && body.timestampPrefix.length === 26))
      && (!body.channelId || (typeof body.channelId === 'string' && body.channelId.length === 43))
      // 'subChannel': 'i2' is a bit more complicated, it must be 4xbase62 (plus boundary '_'), so we regex against [a-zA-Z0-9_]
      && (!body.i2 || (typeof body.i2 === 'string' && /^[a-zA-Z0-9_]{4}$/.test(body.i2)))
      // body.ttl must be 0-15 (4 bits)
      && (body.ttl === undefined || (Number.isInteger(body.ttl) && body.ttl >= 0 && body.ttl <= 15))
      && (!body.t || isSBUserId(body.t))  // Validates format if present
    ) {
      return { ...body, [SB_CHANNEL_MESSAGE_SYMBOL]: true } as ChannelMessage
    } else {
      if (DBG2) console.error('invalid ChannelMessage ... trying to ingest:\n', body)
      throw new SBError(`invalid ChannelMessage`)
    }
  }
  
  /**
   * Complements validate_ChannelMessage. This is used to strip out the parts that
   * are not strictly needed. Addresses privacy, security, and message size
   * issues. Note that 'ChannelMessage' is a 'public' interface, in the sense that
   * this is what is actually stored (as payload ArrayBuffers) at rest, both on
   * servers and clients.
   * 
   * 'serverMode' is slightly more strict and used by server-side code.
   * 
   * @internal
   */
  export function stripChannelMessage(msg: ChannelMessage, serverMode: boolean = false): ChannelMessage {
    if (DBG2) console.log('stripping message:\n', msg)
    const ret: ChannelMessage = {}
    if (msg.f !== undefined) ret.f = msg.f; else throw new SBError("ERROR: missing 'f' ('from') in message")
    if (msg.c !== undefined) ret.c = msg.c; else throw new SBError("ERROR: missing 'c' ('encrypted contents') in message")
    // if it's a 'string' type message, it's not encrypted, so no nonce
    if (msg.iv !== undefined) ret.iv = msg.iv; else if (!(msg.stringMessage) === true) throw new SBError("ERROR: missing 'iv' ('nonce') in message")
    if (msg.salt !== undefined) ret.salt = msg.salt; else throw new SBError("ERROR: missing 'salt' in message")
    if (msg.s !== undefined) ret.s = msg.s; else if (!(msg.stringMessage) === true) throw new SBError("ERROR: missing 's' ('signature') in message")
    if (msg.ts !== undefined) ret.ts = msg.ts; else throw new SBError("ERROR: missing 'ts' ('timestamp') in message")
    if (msg.sts !== undefined) ret.sts = msg.sts; else if (serverMode) throw new SBError("ERROR: missing 'sts' ('servertimestamp') in message")
    if (msg.ttl !== undefined && msg.ttl !== 0xF) ret.ttl = msg.ttl; // optional, and we strip if set to default value
    if (msg.t !== undefined) ret.t = msg.t; // 'to', optional but if present is kept
    if (msg.i2 !== undefined && msg.i2 !== '____') ret.i2 = msg.i2; // optional, also we strip out default value
    if (msg.cs !== undefined) ret.cs = msg.cs; // optional
    return ret
  }
  