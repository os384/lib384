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
import { _sb_assert } from 'src/utils/error'
import { SBUserPublicKey, isSBUserId } from '../index'
import { Channel } from './Channel'
import { ChannelMessage } from './ChannelMessage'
import { SBUserId, } from '../common'
import { SB384 } from '../sbCrypto/SB384'
import { SALT_TYPE } from '../types'

const DBG0 = false;
// declare var DBG2: boolean;

/**
 * Key exchange protocol. Note 
 * 
 * that SBMessage always includes
 * a reference to the channel. Also note that all this methods
 * are likely to be asynchronous (you'll need await).
 * @public
 */
export interface SBProtocol {

  /** even if not used by the protocol, this is set by the channel once the
      protocol is associated with it; note that if a protocol needs to do
      prelimaries once it knows the channel, it needs to track that itself.
      */
  setChannel(channel: Channel): Promise<void>;

  /** if the protocol doesn't 'apply' to the message, this should throw */
  encryptionKey(msg: ChannelMessage /* SBMessage */): Promise<CryptoKey>;

  /** 'undefined' means it's outside the scope of our protocol, for example
       if we're not a permitted recipient, or keys have expired, etc */
  decryptionKey(msg: ChannelMessage): Promise<CryptoKey | undefined>;

}

/**
 * Superset of what different protocols might need. Their meaning
 * depends on the protocol
 */
export interface Protocol_KeyInfo {
  salt1?: SALT_TYPE,
  salt2?: SALT_TYPE,
  iterations1?: number,
  iterations2?: number,
  hash1?: string,
  hash2?: string,
  summary?: string,
}

/**
 * Basic protocol, just provide entropy and salt, then all messages are
 * encrypted accordingly.
 *
 * Note that the AES protocol does not depend on any per-message information,
 * nor particulars of sender or recipient. Thus, for example, getting a key will
 * never return 'undefined', but instead will throw if something is wrong (such
 * as missing salt).
 */
export class Protocol_AES_GCM_256 implements SBProtocol {
  #masterKey?: Promise<CryptoKey>
  #keyInfo: Protocol_KeyInfo

  constructor(passphrase: string, keyInfo: Protocol_KeyInfo) {
    this.#keyInfo = keyInfo;
    if (!this.#keyInfo || !this.#keyInfo.salt1 || !this.#keyInfo.iterations1 || !this.#keyInfo.hash1)
      throw new Error("Protocol_AES_GCM_256() - insufficient key info (fatal)")
    this.#masterKey = this.initializeMasterKey(passphrase);
  }

  async ready() {
    // only really needed for unit tests (they don't like promises left dangling)
    await this.#masterKey
  }

  async setChannel(_channel: Channel): Promise<void> {
    // this protocol doesn't do anything with it, but we need to have endpoint
    // (channel will always call this method once it has the protocol)
    return (void 0)
  }

  async initializeMasterKey(passphrase: string): Promise<CryptoKey> {
    const salt = this.#keyInfo.salt1!;
    const iterations = this.#keyInfo.iterations1!;
    const hash = this.#keyInfo.hash1!;
    _sb_assert(salt && iterations && hash, "Protocol_AES_GCM_256.initializeMasterKey() - insufficient key info (fatal)")

    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    const masterKeyBuffer = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: hash
      },
      baseKey,
      256
    );

    return crypto.subtle.importKey(
      'raw',
      masterKeyBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
  }

  static async genKey(): Promise<Protocol_KeyInfo> {
    return {
      salt1: crypto.getRandomValues(new Uint8Array(16)).buffer,
      iterations1: 100000,
      iterations2: 10000,
      hash1: 'SHA-256',
      summary: 'PBKDF2 - SHA-256 - AES-GCM',
    }
  }

  // Derive a per-message key (but for AES the message doesn't matter)
  async #getMessageKey(salt: ArrayBuffer): Promise<CryptoKey> {
    if (!salt || !(salt instanceof ArrayBuffer)) throw new Error("Protocol_AES_GCM_256 - salt missing (fatal)")
    const k = await crypto.subtle.deriveKey(
      {
        'name': 'PBKDF2',
        'salt': salt,
        'iterations': this.#keyInfo.iterations2!, // on a per-message basis
        'hash': this.#keyInfo.hash1!
      },
      await this.#masterKey!,
      { 'name': 'AES-GCM', 'length': 256 }, true, ['encrypt', 'decrypt'])
    
    if (DBG0) {
      const v = (await crypto.subtle.exportKey('jwk', k)).k
      if (!v) throw new Error("Internal Error (L136)");
      console.log(`++++ Protocol_AES_GCM_256.#getMessageKey() - key (k):`, v);
    }
    return k
  }

  async encryptionKey(msg: ChannelMessage): Promise<CryptoKey> {
    return this.#getMessageKey(msg.salt!)
  }

  async decryptionKey(msg: ChannelMessage): Promise<CryptoKey> {
    return this.#getMessageKey(msg.salt!)
  }
}


function _N_id(x: SBUserId | SBUserPublicKey): string { return Protocol_ECDH.keyToName.get(x) || x.slice(0, 6)}
function _N_key(x: SBUserId | SBUserPublicKey): string { return Protocol_ECDH.keyToName.get(x) || x.slice(4, 12) + '...' + x.slice(-4)}


/**
 * Essentially implements 'whisper', eg 1:1 public-key based encryption between
 * sender and receiver. It will use as sender the private key used on the
 * Channel, and you can either provide 'sendTo' in the SBMessage options, or
 * omit it in which case it will use the channel owner's public key.
 *
 * Careful not to be 'reusing' this protocol for different channels and/or
 * different users. It will be particular to the channel that it is (eventually)
 * configured for (using setChannel()).
 */
export class Protocol_ECDH implements SBProtocol {
  #channel?: Channel;
  #keyMap: Map<string, CryptoKey> = new Map();

  /**
   * For debugging support, you can set this map to translate keys to descriptive
   * names. This is not used by the protocol itself, only bug DBG0 output.
   */
  public static keyToName: Map<SBUserId | SBUserPublicKey, string> = new Map();

  constructor() {
    /* this protocol depends on channel (sender) and recipient only */
  }

  async setChannel(ch: Channel): Promise<void> {
    this.#channel = ch;
  }

  // track crypto keys to use for different senders (we are always the recipient)
  async #getKey(privateKey: CryptoKey, otherParty: SBUserId): Promise<CryptoKey> {
    if (!this.#keyMap.has(otherParty)) {
      // if (DBG0) console.log(`[${_N_id(c.userId)}] ++++ Protocol_ECDH.#getKey() - creating key for messages from:`, from)
      const z = await this.#channel!.getVisitorKeyFromID(otherParty);
      if (!z) throw new Error(`Protocol_ECDH.#getKey() - visitor key not found for '${otherParty}'`);
      const p384 = await new SB384(z).ready
      if (p384!.userId !== otherParty) throw new Error("Visitor key not consistent. Internal Error (L176)")
      const newKey = await crypto.subtle.deriveKey(
        {
          name: 'ECDH',
          public: p384.publicKey
        },
        privateKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
      this.#keyMap.set(otherParty, newKey);
    }
    const res = this.#keyMap.get(otherParty);
    if (!res) throw new Error("Internal Error (L205)");
    return res!;
  }

  async encryptionKey(msg: /* SBMessage */ ChannelMessage): Promise<CryptoKey> {
    const c = await this.#channel!.ready

    const f = msg.f
    if (!f || f !== c.userId) {
      if (DBG0) console.error(`[${_N_id(c.userId)}] ERROR. sender missing or it's not us. Sender is:`, f)
      throw new Error("Protocol_ECDH.encryptionKey() - sender is missing or it's not us (error)")
    }
    const t = msg.t ? msg.t : c.channelId!;
    if (!t || !isSBUserId(t)) throw new Error("Protocol_ECDH.encryptionKey() - recipient is missing or it's not a SBUserId (error)");
    const k = await this.#getKey(c.privateKey, t);
    if (DBG0) {
      const v = (await crypto.subtle.exportKey('jwk', k)).k
      if (!v) throw new Error("Internal Error (L175)");
      console.log(`[${_N_id(c.userId)}] ++++ Protocol_ECDH. +EN+ cryptionKey() -  from us and to:`, _N_key(t), "key:", v);
    }
    return k;
  }

  async decryptionKey(msg: ChannelMessage): Promise<CryptoKey | undefined> {
    const c = await this.#channel!.ready
    const t = msg.t ? msg.t : c.channelId;
    const f = msg.f
    if (!f || !isSBUserId(f)) throw new Error("Protocol_ECDH.decryptionKey() - sender is missing or not a valid SBUserId")
    if (t !== c.userId && f !== c.userId) {
      if (DBG0) console.log(`[${_N_id(c.userId)}] ++++ Protocol_ECDH.decryptionKey() - neither to nor from us (from [${_N_id(f)}] to [${_N_id(t)}])`)
      return undefined;
    }
    let k: CryptoKey;
    if (f === c.userId) {
      // if it's from ourselves (reflected), then we swap (it's symmetric)
      k = await this.#getKey(c.privateKey, t);
    } else {
      k = await this.#getKey(c.privateKey, f);
    }
    if (DBG0) {
      const v = (await crypto.subtle.exportKey('jwk', k)).k
      if (!v) throw new Error("Internal Error (L241)");
      console.log(`[${_N_id(c.userId)}] ++++ Protocol_ECDH. -DE- cryptionKey() - from [${_N_id(f)}] to [${_N_id(t)}], key:`, _N_key(v))
    }
    return k;
  }

}
