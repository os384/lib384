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
import {
    _sb_assert, ChannelId, SBUserId,
    SBUserPrivateKey, SBUserPublicKey, SBError,
    SEP, SEP_, DBG2, Memoize, Ready,
    extractPayload, assemblePayload,
    sbCrypto, isSBUserId, isSet,
} from 'src/common'

import { NONCE_TYPE } from '../types'

import { WrapError } from 'src/utils/error';
import { parseSB384string } from 'src/sbCrypto/SBCrypto';
import { Retry } from 'src/utils/timeout';
import { StorageApi } from 'src/storage/StorageApi';

const DBG0 = false;

import {
    MessageQueue
} from 'src/utils/MessageQueue'

import { MAX_SB_BODY_SIZE } from './config';
import { ChannelMessage, validate_ChannelMessage, stripChannelMessage } from './ChannelMessage'
import { ChannelApi } from './ChannelApi'
import { ChannelKeys } from './ChannelKeys'
import { SBProtocol, Protocol_ECDH } from './Protocol'
import { ChannelHandle, validate_ChannelHandle } from './ChannelHandle'
import { Message, MessageOptions, validate_Message } from 'src/channel/Message'

import { ObjectHandle } from 'src/storage/ObjectHandle'

import { SBStorageToken, validate_SBStorageToken } from 'src/storage/StorageToken'

import { ClientDeepHistory } from 'src/storage/MessageHistory';

import { NEW_CHANNEL_MINIMUM_BUDGET } from './config'
import { getSBFetch } from 'src/utils/fetch'
import { arrayBufferToBase62 } from 'src/utils/b62';

export const SB_CHANNEL_HANDLE_SYMBOL = Symbol('ChannelHandle')

// channel message 'id' format
// ToDo: Note that the client and server sides might have a different opinion about what's allowable here
//       We're allowing subchannels here because they are used on the server side eg for deep history
const messageRegex = /^([a-zA-Z0-9]{43})_[a-zA-Z0-9_]{4}_([0-3]{26})$/;

/**
 * This is what the {term}`Channel` Server knows about the channel.
 * 
 * Note: all of these are (ultimately) strings, and are sent straight-up
 * to/from channel server.
 * 
 * Validator is {@link validate_SBChannelData}.
 * 
 * @public
 */
export interface SBChannelData {
    channelId: ChannelId,
    ownerPublicKey: SBUserPublicKey,
    // used when creating/authorizing a channel
    storageToken?: SBStorageToken,
}

/** @internal */
export function _check_SBChannelData(data: SBChannelData) {
    return (
        Object.getPrototypeOf(data) === Object.prototype
        && data.channelId && data.channelId.length === 43
        && data.ownerPublicKey && typeof data.ownerPublicKey === 'string' && data.ownerPublicKey.length > 0
        && (!data.storageToken || validate_SBStorageToken(data.storageToken))
    )
}

/**
 * Validates 'SBChannelData', throws if there's an issue
 * @public
 */
export function validate_SBChannelData(data: any): SBChannelData {
    if (!data) throw new SBError(`invalid SBChannelData (null or undefined)`)
    else if (_check_SBChannelData(data)) {
        return data as SBChannelData
    } else {
        if (DBG0) console.error('invalid SBChannelData ... trying to ingest:\n', data)
        throw new SBError(`invalid SBChannelData`)
    }
}

/**
 * This corresponds to all important meta-data on a channel that an Owner
 * has access to.
 * 
 * @public
 */
export interface ChannelAdminData {
    channelId: ChannelId,
    channelData: SBChannelData,
    capacity: number,
    locked: boolean,
    accepted: Set<SBUserId>,
    visitors: Map<SBUserId, SBUserPublicKey>,
    storageLimit: number,
    motherChannel: ChannelId,
    latestTimestamp: string, // base4 'x256' format
}


// Decorator
// asserts caller is an owner of the channel for which an api is called
/** @internal */
export function Owner(target: any, propertyKey: string /* ClassGetterDecoratorContext */, descriptor?: PropertyDescriptor) {
    if ((descriptor) && (descriptor.get)) {
        let get = descriptor.get
        descriptor.get = function () {
            const obj = target.constructor.name
            if ('owner' in this) {
                const o = "owner" as keyof PropertyDescriptor
                _sb_assert(this[o] === true, `${propertyKey} getter or method accessed for object ${obj} but callee is not channel owner`)
            }
            return get.call(this) // we don't check return value here
        }
    }
}


// Every channel has a queue of messages to send; entries track not just the
// message per se, but also the 'original' resolve/reject of the 'send()'
// operation, and a binding to the 'actual' sending function (eg restful API,
// socket, whatever))
export interface EnqueuedMessage {
    msg: ChannelMessage,
    resolve: (value: any) => any,
    reject: (reason: any) => any,
    _send: (msg: ChannelMessage) => any,
    retryCount: number, // note, must be 0 or positive
}

/**
 * A "channel" is a core concept in os384, and the Channel class is the
 * primary interface to it. 
 *
 * Protocol is called for every message to get the CryptoKey to use for that
 * message; if provided upon creation, then it's the default for each message
 * through that Channel object. Individual
 * messages can override this.
 * The default protocol is Protocol_ECDH, which does basic sender-receipient
 * public key encryption.
 * 
 * The interface equivalent of a Channel is {@link ChannelHandle}.
 *
 * Note that you don't need to worry about what API calls involve race
 * conditions and which don't, the library will do that for you. Like most
 * classes in SB it follows the "ready" template: objects can be used right
 * away, but they decide for themselves if they're ready or not. The SB384 state
 * is the *user* of the channel, not the channel itself; it has an Owner (also
 * SB384 object), which can be the same as the user/visitor, but that requires
 * finalizing creating the channel to find out (from the channel server).
 * 
 * The channel endpoint on the channel server itself looks as follows, for both visitors and owners
 * (there is a corresponding method for most of these):
 * 
 * ```plaintext
 *     /api/v2/channel/<ID>/getChannelKeys      :     get owner pub key, channel pub key, etc
 *     /api/v2/channel/<ID>/getHistory          :     returns a deep history of messages
 *     /api/v2/channel/<ID>/getLatestTimestamp  :     latest message timestamp, in prefix format
 *     /api/v2/channel/<ID>/getMessages         :     given keys, get messages
 *     /api/v2/channel/<ID>/getMessageKeys      :     get message keys
 *     /api/v2/channel/<ID>/getPubKeys          :     returns Map<userId, pubKey>
 *     /api/v2/channel/<ID>/getStorageLimit     :     returns storage limit
 *     /api/v2/channel/<ID>/getStorageToken     :     mint a storage token
 *     /api/v2/channel/<ID>/send                :     send a message
 *     /api/v2/channel/<ID>/websocket           :     upgrades to websocket protocol
 * ```
 *
 * And the following endpoints are for owners only:
 *
 * ```plaintext
 *     /api/v2/channel/<ID>/acceptVisitor       :     adds a vistor to the channel
 *     /api/v2/channel/<ID>/budd                :     either creates a new channel or transfers storage
 *     /api/v2/channel/<ID>/getAdminData        :     returns all admin data in one struct
 *     /api/v2/channel/<ID>/getCapacity         :     returns max number of visitors
 *     /api/v2/channel/<ID>/getJoinRequests     :     for locked channels, returns pending join requests
 *     /api/v2/channel/<ID>/getMother           :     returns the mother channel
 *     /api/v2/channel/<ID>/lockChannel         :     locks down the channel (must be 'accepted')
 *     /api/v2/channel/<ID>/setCapacity         :     sets max number of visitors
 *     /api/v2/channel/<ID>/setPage             :     sets the page for the channel
 * ```
 *
 * There are also a number of wrapper/convenience methods.
 *
 */
export class Channel extends ChannelKeys {
    channelReady: Promise<Channel>
    static ReadyFlag = Symbol('ChannelReadyFlag'); // see below for '(this as any)[Channel.ReadyFlag] = false;'
    locked?: boolean = false // ToDo: need to make sure we're tracking whenever this has changed
    // #cursor: string = ''; // last (oldest) message key seen

    defaultProtocol: SBProtocol = new Protocol_ECDH() // default
    protocol?: SBProtocol = this.defaultProtocol

    // todo: should this be static (global), eg a global version?
    #visitors: Map<SBUserId, SBUserPublicKey> = new Map()
    #reverseVisitors: Map<SBUserPublicKey, SBUserId> = new Map()

    // all messages come through this queue; that includes 'ChannelSocket'
    // messages, but need not include all objects that inherits from 'Channel'
    sendQueue: MessageQueue<EnqueuedMessage> = new MessageQueue()

    // explicitly tracks if 'close' has been called
    closingDown = false

    // ToDo: add support in channel server
    previous: string | undefined = undefined // previous message hash

    #kvParams: any = undefined
    #initializingKV: Promise<void> | undefined = undefined

    /**
     * Channel supports creation from scratch, from a handle, or from a key.
     * With no parameters, you're creating a channel from scratch, which
     * means in particular it creates the Owner keys. The resulting object
     * can be recreated from `channel.userPrivateKey`. A from-scratch
     * Channel is an "abstract" object, a mathematical construct, it isn't
     * yet hosted anywhere (meaning, no server will acknowledge it).
     * But it's guaranteed to be globally unique.
     */
    constructor() // requesting a new channel, no protocol
    /**
     * In the special case where you want to create a Channel from scratch,
     * and immediately start using it, you can directly pass a protocol and
     * mark absense of a handle with `null`.
     */
    constructor(newChannel: null, protocol: SBProtocol)
    /**
     * If you are re-creating a Channel from the Owner private key, you
     * can so so directly.
     */
    constructor(key: SBUserPrivateKey, protocol?: SBProtocol)
    /**
     * If you have a full (or partial) handle present, you can use that as well;
     * for example it might already contain the name of a specific channel server,
     * the ChannelData from that server for the channel, etc. This is also the
     * quickest way, since bootstrapping from keys requires more crypto.
     * 
     * @param handle - ChannelHandle
     * @param protocol - SBProtocol
     */
    constructor(handle: ChannelHandle, protocol?: SBProtocol)
    constructor(handleOrKey?: ChannelHandle | SBUserPrivateKey | null, protocol?: SBProtocol) {
        if (DBG0) console.log("Channel() constructor called with handleOrKey:\n", handleOrKey)
        if (handleOrKey === null)
            super()
        else
            super(handleOrKey);
        this.protocol = protocol ? protocol : this.defaultProtocol
        if (!this.protocol) throw new SBError("Channel() constructor - no protocol? (internal error)")
        this
            .messageQueueManager() // fire it up
            .then(() => { if (DBG0) console.log("Channel() constructor - messageQueueManager() is DONE") })
            .catch(e => { throw e })
        this.channelReady =
            this.sbChannelKeysReady
                .then(async () => {
                    // owner 'userId' is same as channelId, always added
                    this.#addVisitor(this.channelId!, this.channelData.ownerPublicKey);
                    (this as any)[Channel.ReadyFlag] = true;
                    await this.protocol!.setChannel(this); // if protocol needs to do something 
                    return this;
                })
                .catch(e => { throw e; });
    }

    get ready() {
        _sb_assert(!this.closingDown, "[Channel] Channel is closed, blocking on'ready' will reject")
        return this.channelReady
    }
    get ChannelReadyFlag(): boolean { return (this as any)[Channel.ReadyFlag] }

    @Memoize @Ready get api() { return this } // for compatibility

    /**
     * Returns a map of all known participants - maps SBUserdId to SBUserPublicKey.
     * Note that this will poke the server; if you just want to look up individual
     * visitors, you can use 'getVisitorKeyFromId()' or 'getVisitorIdFromKey()',
     * which will be faster (caching results).
     */
    @Ready async getPubKeys(): Promise<Map<SBUserId, SBUserPublicKey>> {
        const visitorMap = await this.callApi('/getPubKeys')
        if (!visitorMap || !(visitorMap instanceof Map)) throw new SBError("getPubKeys() - no visitor map returned")
        for (const [k, v] of visitorMap) {
            this.#addVisitor(k, v)
        }
        // channelId itself is the owner user id and always points to the owner public key
        this.#addVisitor(this.channelId!, this.channelData.ownerPublicKey)
        return visitorMap
    }

    #addVisitor(userId: SBUserId, publicKey: SBUserPublicKey) {
        this.#visitors.set(userId, publicKey)
        this.#reverseVisitors.set(publicKey, userId)
    }

    /**
     * Translates an SBUserId to an SBUserPublicKey, for this channel. This will
     * be fast, and it will ping server if and when needed. 'undefined' is a 
     * permitted value, it will return the public key of the channel owner.
     */
    @Memoize @Ready async getVisitorKeyFromID(userId: SBUserId | undefined): Promise<SBUserPublicKey | undefined> {
        if (userId === undefined) return this.channelData.ownerPublicKey
        let f = this.#visitors.get(userId)
        if (!f) {
            await this.getPubKeys() // side effect will update #visitors
            f = this.#visitors.get(userId) // try again
        }
        return f
    }

    /**
     * Reverse of 'getVisitorKeyFromID()'. Translates an SBUserPublicKey to an SBUserid.
     * Note, it will return undefined if the public key is not found in the visitor map
     * of this channel. You can always create the ID directly with:
     * 
     * ```typescript
     * 
     *      const id = (await new SB384(publicKey).ready).userId
     * 
     * ```
     * 
     * This function deliberately does not do this, on the assumption that you prefer
     * to find out if this key is not on the channel's visitor list.
     */
    @Memoize @Ready async getVisitorIDFromKey(userId: SBUserPublicKey): Promise<SBUserId | undefined> {
        if (userId === this.channelData.ownerPublicKey) return this.channelId!
        let i = this.#reverseVisitors.get(userId)
        if (!i) {
            await this.getPubKeys() // side effect will update #reverseVisitors
            i = this.#reverseVisitors.get(userId) // try again
        }
        return i
    }

    /**
     * Takes a 'ChannelMessage' format and presents it as a 'Message'. Does a
     * variety of things. If there is any issue, will return 'undefined', and you
     * should probably just ignore that message. Only requirement is you extract
     * payload before calling this (some callees needs to, or wants to, fill in
     * things in ChannelMessage). If 'dbgOn' is set, will print out 
     * debugging information.
     */
    async extractMessage(msgRaw: ChannelMessage | undefined, dbgOn = false): Promise<Message | undefined> {
        if (!msgRaw) return undefined
        if (DBG2) console.log("[extractMessage] Extracting message:", msgRaw)
        else if (dbgOn) console.log("[extractMessage] Will try to extract message ...")
        if (msgRaw instanceof ArrayBuffer) throw new SBError('[Channel.extractMessage] Message is an ArrayBuffer (did you forget extractPayload()?)')
        try {
            msgRaw = validate_ChannelMessage(msgRaw)
            if (!msgRaw) {
                if (DBG0 || dbgOn) console.warn("++++ [extractMessage]: message is not valid (probably an error)", msgRaw)
                return undefined
            }
            const sender = msgRaw.f // protocols may use 'from', so needs to be in channel visitor map
            if (!sender) {
                console.error("++++ [extractMessage]: no sender userId hash in message (probably an error)")
                return undefined
            }
            const senderPublicKey = await this.getVisitorKeyFromID(sender)
            if (!senderPublicKey) throw new SBError(`Cannot find sender userId hash ${sender} in public key map (including asking server)`)

            _sb_assert(this.protocol, "Protocol not set (internal error)")
            const k = await this.protocol?.decryptionKey(msgRaw)
            if (!k) {
                if (DBG2 || dbgOn) console.error("++++ [extractMessage]: no decryption key provided by protocol (perhaps an error)")
                return undefined
            }

            if (dbgOn) {
                console.log("[extractMessage] Decryption key:")
                crypto.subtle.exportKey("raw", k)
                    .then(rawKeyBuffer => {
                        const keyBytes = new Uint8Array(rawKeyBuffer);
                        const hexString = Array.from(keyBytes)
                            .map(b => b.toString(16).padStart(2, '0') + " ")
                            .join('');
                        console.log(hexString);
                    })
                    .catch(err => {
                        console.error('Error exporting key:', err);
                    });
            }

            if (!msgRaw.ts) throw new SBError(`unwrap() - no timestamp in encrypted message`)
            const { c: t, iv: iv } = msgRaw // encryptedContentsMakeBinary(o)
            _sb_assert(t, "[unwrap] No contents in encrypted message (probably an error)")
            const view = new DataView(new ArrayBuffer(8));
            view.setFloat64(0, msgRaw.ts); // ToDo: upgrade our timestamp validation to use the *256 version (which doesn't fit in 'Number')

            // print out the (timestamp) 'view' in hex
            if (dbgOn) {
                const viewBytes = new Uint8Array(view.buffer);
                const hexString = Array.from(viewBytes)
                    .map(b => b.toString(16).padStart(2, '0') + " ")
                    .join('');
                console.log("[extractMessage] Timestamp view (hex):", hexString);
            }

            let bodyBuffer
            try {
                bodyBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv, additionalData: view }, k, t! as ArrayBuffer)
            } catch (e: any) {
                if (DBG0 || dbgOn) console.error("[extractMessage] Could not decrypt message (exception) [L2898]:", e.message)
                return undefined
            }
            if (!msgRaw._id)
                msgRaw._id = Channel.composeMessageKey(this.channelId!, msgRaw.sts!, msgRaw.i2)
            if ((DBG0  || dbgOn) && msgRaw.ttl !== undefined && msgRaw.ttl !== 15) console.warn(`[extractMessage] TTL->EOL missing (TTL set to ${msgRaw.ttl}) [L2762]`)
            // ToDo: verify 'cs' (sender channel server domain) is correct, if present
            const msg: Message = {
                body: extractPayload(bodyBuffer).payload,
                channelId: this.channelId!,
                sender: sender,
                senderPublicKey: senderPublicKey,
                senderTimestamp: msgRaw.ts!,
                serverTimestamp: msgRaw.sts!,
                // eol: <needs to be calculated>, // ToDo: various places for TTL/EOL processing
                _id: msgRaw._id!,
            }
            if (DBG2 || dbgOn) console.log("[Channel.extractMessage] Extracted message (before validation):", msg.body)
            return validate_Message(msg)
        } catch (e: any) {
            if (DBG0 || dbgOn) console.error("[extractMessage] Could not process message (exception) [L2782]:", e.message)
            return undefined
        }
    }

    /**
     * Applies 'extractMessage()' to a map of messages.
     */
    async extractMessageMap(msgMap: Map<string, ChannelMessage>): Promise<Map<string, Message>> {
        const ret = new Map<string, Message>()
        for (const [k, v] of msgMap) {
            const msg = await this.extractMessage(v)
            if (msg) {
                ret.set(k, msg)
            } else {
                if (DBG0) console.warn("[extractMessageMap] - message not valid, skipping:", k, v)

            }
        }
        return ret
    }

    /**
     * Convenience function. Takes either a SBUserId or a SBUserPrivateKey,
     * and will return the SBUserId. Validates along the way. Any issues
     * result in returning 'undefined'.
     */
    sendToToUserId(sendTo: SBUserId | SBUserPrivateKey): SBUserId | undefined {
        if (isSBUserId(sendTo)) {
            if (DBG0) console.log("[sendToToUserId] - sending to a user ID:", sendTo)
            return sendTo
        } else {
            if (DBG0) console.log("[sendToToUserId] - will try to parse string:", sendTo)
            if (!parseSB384string(sendTo)) throw new SBError(`wrapMessage(): invalid 'sendTo' format (not a userid nor a key): '${sendTo}'`)
            let k = this.#reverseVisitors.get(sendTo)
            if (k) return k
            // note: we could create the user ID, but, that would make this async and that propagates up to callees
            console.error("[sendToToUserId] - sending to an ID that is not on the visitor list, probably an error")
            return undefined
        }
    }

    /**
     * when *sending* messages, the processing of a message is divided into a
     * synchronous and an asynchronous part. 'packageMessage()' is the synchronous
     * part, and 'finalizeMessage()' is the asynchronous part. this way we enqueue
     * as fast as possible, whereas dequeueing where for instance sender timestamp
     * semantics are enforced, is done async off a queue.
     * 
     * everything is a 'ChannelMessage' unless it's a low-level message of some
     * sort, which we call 'stringMessage' (eg status, server, etc)
     */
    packageMessage(contents: any, options: MessageOptions = {}): ChannelMessage {
        if (DBG0 || DBG2) console.log(SEP, `[Channel#packageMessage] From '${this.userId}'`, SEP, "contents:\n", contents, SEP, "options:\n", options, SEP)
        let msg: ChannelMessage = {
            f: this.userId,
            unencryptedContents: contents,
        }
        if (options) {
            if (options.sendTo) {
                const u = this.sendToToUserId(options.sendTo)
                if (!u) throw new SBError(`wrapMessage(): invalid 'sendTo' contents ('${options.sendTo}')`)
                msg.t = u
            }
            if (options.subChannel) throw new SBError(`wrapMessage(): subChannel not yet supported`) // would be i2
            if (options.ttl !== undefined) msg.ttl = options.ttl
            if (options.sendString) {
                // low-level messages are not encrypted or signed or validated etc
                _sb_assert(typeof contents === 'string', "[packageMessage] sendString is true, but contents is not a string")
                _sb_assert(options.ttl === undefined || options.ttl === 0, `[packageMessage] sendString implies TTL=0 (we got ${options.ttl})`)
                msg.ttl = 0
                msg.stringMessage = true
            }
        }
        if (msg.stringMessage !== true) {
            // 'proper' message, we prep for encryption, signing, etc
            msg.protocol = options.protocol ? options.protocol : this.protocol // default to channel's unless overriden
            if (msg.ttl === undefined) msg.ttl = 15; // note, '0' is valid
            // there is always pre-generated salt and nonce, whether or not the protocol needs them
            if (!msg.salt) msg.salt = crypto.getRandomValues(new Uint8Array(16)).buffer
            if (!msg.iv) msg.iv = crypto.getRandomValues(new Uint8Array(12))
        }

        // this.#message = await sbCrypto.wrap(
        //   this.contents,
        //   this.channel.userId,
        //   await this.options.protocol.encryptionKey(this),
        //   this.salt!,
        //   this.channel.signKey,
        //   options);

        // if (DBG2) console.log("[Channel#packageMessage] - packaged message:\n", msg)
        // return validate_ChannelMessage(msg)
        return msg
    }

    // this is called upon actual sending; every 'send callback' in enqueued
    // messages should call this on the ChannelMessage before sending
    async finalizeMessage(msg: ChannelMessage): Promise<ChannelMessage> {
        if (!msg.ts) msg.ts = await ChannelApi.dateNow()
        _sb_assert(!(msg.stringMessage === true), "[Channel.finalizeMessage()] stringMessage is true, finalizing should not be called (internal error)")

        // msg = await sbCrypto.wrap(
        //   msg.unencryptedContents,
        //   this.userId,
        //   msg.protocol ? await msg.protocol.encryptionKey(msg) : await this.protocol.encryptionKey(msg),
        //   msg.salt!,
        //   this.signKey);

        const payload = assemblePayload(msg.unencryptedContents)
        _sb_assert(payload, "wrapMessage(): failed to assemble payload")
        _sb_assert(payload!.byteLength < MAX_SB_BODY_SIZE,
            `[Channel.finalizeMessage]: body must be smaller than ${MAX_SB_BODY_SIZE / 1024} KiB (we got ${payload!.byteLength / 1024} KiB)})`)
        msg.ts = await ChannelApi.dateNow()

        // ToDo: we want to add ChannelID, To, From, and possibly other things in the 'view'
        const view = new DataView(new ArrayBuffer(8));
        view.setFloat64(0, msg.ts); // ToDo: upgrade to use the *256 version

        _sb_assert(msg.protocol, "[Channel.finalizeMessage()] Protocol not set (internal error)")
        msg.c = await sbCrypto.encrypt(
            payload!,
            await msg.protocol!.encryptionKey(msg),
            { iv: msg.iv, additionalData: view }
        );
        // decryption will self-validate including timestamp signature applied to
        // encrypted contents (including aforementioned timestamp)
        msg.s = await sbCrypto.sign(this.signKey, msg.c)

        return stripChannelMessage(msg)
    }

    // actually carries out (async) send of message
    #_send(msg: ChannelMessage) {
        return new Promise(async (resolve, reject) => {
            await this.ready
            const content = msg.stringMessage === true
                ? msg.unencryptedContents
                : await this.finalizeMessage(msg)
            await this.callApi('/send', content)
                .then((rez: any) => { resolve(rez) })
                .catch((e: any) => { reject(e) });
        });
    }

    /**
     * Sends a message to the channel. The message is enqueued synchronously and sent
     * asynchronously. The return value is a Promise that resolves to the
     * server's response. If the message is a low-level message (eg status, server,
     * etc), then 'sendString' should be set to 'true'. If 'sendTo' is not provided,
     * the message will be sent to the channel owner. If 'protocol' is not provided,
     * the channel's default protocol will be used. If 'ttl' is not provided, it will
     * default to 15.
     */
    async send(contents: any, options: MessageOptions = {}): Promise<string> {
        return new Promise(async (resolve, reject) => {
            if (DBG2) console.log(SEP, "[Channel.send] called.", SEP, "contents:\n", contents)
            const msg = this.packageMessage(contents, options)
            if (DBG2) console.log(SEP, "packed message:\n", msg)
            if (DBG2 && msg.ttl !== undefined) console.log(SEP, "enqueuing message with TTL value: ", msg.ttl, SEP)
            this.sendQueue.enqueue({
                msg: msg,
                resolve: resolve,
                reject: reject,
                _send: this.#_send.bind(this),
                retryCount: options.retries !== undefined ? options.retries : 0 // default no retry
            })
            if (DBG2) console.log(SEP_)
        })
    }

    /** Authorizes/registers this channel on the provided server */
    create(storageToken: SBStorageToken, channelServer: ChannelId = this.channelServer!): Promise<Channel> {
        if (DBG0) console.log("==== Channel.create() called with storageToken:", storageToken, "and channelServer:", channelServer)
        _sb_assert(storageToken !== null, '[Channel.create] Missing storage token')
        if (channelServer) this.channelServer = channelServer;
        _sb_assert(this.channelServer, '[Channel.create] Missing channel server (neither provided nor in channelKeys)')
        return new Promise<Channel>(async (resolve, reject) => {
            await this.channelReady
            this.channelData.storageToken = validate_SBStorageToken(storageToken)
            if (DBG0) console.log("Will try to create channel with channelData:", this.channelData)
            this.callApi('/budd', this.channelData)
                .then(() => {
                    // in case it's different or whatevs, but only if it's confirmed
                    this.channelServer = channelServer
                    _sb_assert(this.channelData && this.channelData.channelId && this.userPrivateKey, 'Internal Error [L2546]')
                    resolve(this)
                    // resolve({
                    //   [SB_CHANNEL_HANDLE_SYMBOL]: true,
                    //   channelId: this.channelData.channelId!,
                    //   userPrivateKey: this.userPrivateKey,
                    //   // channelPrivateKey: (await new SB384(channelKeys.channelPrivateKey).ready).userPrivateKey,
                    //   channelServer: this.channelServer,
                    //   channelData: this.channelData
                    // })
                }).catch((e) => { reject("Channel.create() failed: " + WrapError(e)) })
        })
    }

    /** Deprecated. Would take an array of channelIds and get latest time stamp from all of them  */
    getLastMessageTimes() {
        throw new SBError("Channel.getLastMessageTimes(): deprecated")
    }

    /**
     * Gets the latest known timestamp for the channel, using server timestamps.
     * Returns it in prefix string format.
     */
    @Ready getLatestTimestamp(): Promise<string> {
        return this.callApi('/getLatestTimestamp')
    }

    async messageQueueManager() {
        if (DBG2) console.log(SEP, "[messageQueueManager] Channel message queue is starting up", SEP)
        await this.ready
        if (DBG2) console.log(SEP, "[messageQueueManager] ... continuing to start up", SEP)
        let keepRunning = true
        while (keepRunning) {
            await this.sendQueue.dequeue()
                .then(async (qMsg) => {
                    if (DBG2) console.log(SEP, "[messageQueueManager] ... pulled 'msg' from queue:\n", qMsg?.msg.unencryptedContents, SEP)
                    if (qMsg) {
                        if (DBG2) console.log(SEP, "[messageQueueManager] Channel message queue is calling '_send' on message\n", qMsg.msg.unencryptedContents)
                        if (DBG2) console.log(qMsg.msg)
                        let latestError = null
                        while (qMsg.retryCount-- >= 0) {
                            if (DBG2) console.log(SEP, "[messageQueueManager] ... trying message send (", qMsg.retryCount, "retries left)\n", qMsg.msg.unencryptedContents, SEP)
                            try {
                                const ret = await qMsg._send(qMsg.msg)
                                if (DBG2) console.log(SEP, "[messageQueueManager] Got response from registered '_send':\n", ret, SEP)
                                qMsg.resolve(ret)
                                break
                            } catch (e) {
                                if (DBG2) console.log(SEP, "[messageQueueManager] Got exception from '_send' operation, might retry", e, SEP)
                                latestError = '[ERROR] ' + e
                            }
                        }
                        // if we're here, we've run out of retries
                        qMsg.reject(latestError)
                    } else {
                        // 'null' signals queue is empty and closed
                        if (DBG2) console.log("[messageQueueManager] Channel message queue is empty and closed")
                        keepRunning = false
                    }
                })
                .catch((e: any) => {
                    // if we are closing down, we don't want to throw
                    if (this.closingDown || e === 'shutDown') {
                        if (DBG2) console.log("[messageQueueManager] Channel message queue is shutting down")
                        return
                    } else {
                        // ToDo: actually 'e' here can be an enqueued message, not an error per se
                        throw new SBError("[messageQueueManager] Channel message rejected (ToDo - internal error - L573)")
                    }
                })
            // .catch((message: EnqueuedMessage) => {
            //   if (DBG2 || DBG) console.log(SEP, "[messageQueueManager] Got exception from DEQUEUE operation:\n", JSON.stringify(message), SEP)
            //   // queue will reject (with the message) if it's closing down
            //   if (DBG2 || DBG) console.log("[messageQueueManager] Channel message queue is closing down")
            //   if (DBG2 || DBG) console.log(message)
            //   // check if 'shutDown' is in
            //   message.resolve('shutDown')
            // })
        }
    }

    // 'Channel' on a close will close and drain
    close() {
        if (DBG2) console.log("[Channel.close] called (will drain queue)")
        this.closingDown = true
        return this.sendQueue.drain('shutDown')
    }

    /**
     * Returns map of message keys from the server corresponding to the request.
     * Takes a single optional parameter, which is the time stamp prefix for
     * which a set is requested. If not provided, the default is '0' (which
     * corresponds to entire history). Returns a set of the message keys,
     * and the reverse-linked history shard if present.
     *
     * Note that if the channel is out of budget (eg "frozen" or in "deep
     * history" mode), it will return an empty set of keys (not an error).
     * 
     * Use 'getMessageMap' to get the actual messages from the set of keys.
     * 
     * See 'getHistory' for older message keys.
     * 
     * 'historyShard' is deprecated, and will be removed in a future version;
     * currently it just returns an empty object.
     * 
     * 'prefix' is about to be deprectated as well.
     * 
     * @public
     */
    getMessageKeys(prefix: string = '0'): Promise<{ historyShard: ObjectHandle | undefined, keys: Set<string> } > {
        // getMessageKeys(currentMessagesLength: number = 100, paginate: boolean = false): Promise<Set<string>> {
        return new Promise(async (resolve, reject) => {
            try {
                await this.channelReady
                _sb_assert(this.channelId, "Channel.getMessageKeys: no channel ID (?)");
                // const { historyShard, keys } =
                //     (await this.callApi(
                //         '/getMessageKeys',
                //         { prefix: prefix })) as { historyShard: ObjectHandle, keys: Set<string> | Array<string> }
                let keys: Set<string> | Array<string> = await this.callApi('/getMessageKeys', { prefix: prefix })
                if (DBG2) console.log("getMessageKeys:", keys)
                // forward compatibility
                if ((keys as any).keys) keys = (keys as any).keys
                // server protocol is moving away from Sets and Maps
                var finalizedKeys = new Set<string>()
                // check if 'keys' is a set
                if (keys instanceof Set) {
                    finalizedKeys = keys
                } else if (keys instanceof Array) {
                    keys.forEach(k => finalizedKeys.add(k))
                } else {
                    console.error("[Channel.getMessageKeys] Unexpected format, cannot parse out 'keys':", keys)
                    throw new SBError("[Channel.getMessageKeys] Unexpected response from server")
                }
                if (!finalizedKeys || finalizedKeys.size === 0)
                    console.warn("[Channel.getMessageKeys] Warning: no messages (empty/null response); not an error but perhaps unexpected?")
                resolve({ historyShard: undefined, keys: finalizedKeys })
            } catch (e) {
                const msg = `[Channel.getMessageKeys] Error in getting message keys (offline?) ('${e}')`
                if (DBG0) console.warn(msg)
                reject(msg)
            }
        });
    }

    /**
     * Get raw set of messages from the server. This corresponds to the 'getMessages' server
     * endpoint, and distinguished from 'getMessageMap' which you're more likely to be using.
     * @public
     */
    @Ready async getRawMessageMap(messageKeys: Set<string>): Promise<Map<string, ArrayBuffer>> {
        if (DBG0) console.log(SEP, "[Channel.getRawMessageMap] called ... ", SEP)
        if (!isSet(messageKeys)) throw new SBError("[getRawMessageMap] messageKeys is not a Set")
        if (messageKeys.size === 0) throw new SBError("[getRawMessageMap] no message keys provided")
        if (messageKeys.size > (ChannelApi.MAX_MESSAGE_REQUEST_SIZE))
            throw new SBError(`[getRawMessageMap] too many messages requested at once (max is ${ChannelApi.MAX_MESSAGE_REQUEST_SIZE}, you requested ${messageKeys.size})`)
        if (DBG0) console.log(SEP, "[Channel.getRawMessageMap] calling API with messageKeys ... ", SEP)

        // the format is either already a Map, or it's a pair of arrays that we need to zip together and build a map
        const mapOrDoubleArray: Map<string, ArrayBuffer> | { keys: Array<string>, values: Array<ArrayBuffer> } = await this.callApi('/getMessages', messageKeys)
        let messagePayloads: Map<string, ArrayBuffer> = new Map()
        if (mapOrDoubleArray instanceof Map) {
            messagePayloads = mapOrDoubleArray
        } else {
            const { keys, values } = mapOrDoubleArray
            if (keys.length !== values.length) throw new SBError("[Channel.getRawMessageMap] keys and values arrays are not the same length")
            for (let i = 0; i < keys.length; i++) {
                messagePayloads.set(keys[i], values[i])
            }
        }
        if (DBG0) console.log(SEP, `[Channel.getRawMessageMap] got ${messagePayloads.size} payloads ...`, SEP)
        return(messagePayloads)
    }

    /**
     * given a raw set of messages, extract payloads, validate (at ChannelMessage level),
     * then call extractMessageMap() to decrypt. generally you won't be using this, but it's
     * exposed in case you want to first review the raw messages and then separately decrypt
     * and validate them.
     */
    async convertRawMessageMap(messagePayloads: Map<string, ArrayBuffer>): Promise<Map<string, Message>> {
        if (DBG0) console.log(SEP, "[Channel.convertRawMessageMap] called ... ", SEP)
        const messages = new Map<string, ChannelMessage>()
        for (const [k, v] of messagePayloads) {
            try {
                messages.set(k, validate_ChannelMessage(extractPayload(v).payload))
            } catch (e) {
                if (DBG0) console.warn(SEP, "[getMessageMap] Failed extract and/or to validate message:", SEP, v, SEP, e, SEP)
            }
        }
        return (await this.extractMessageMap(messages))
    }

    /**
     * Main function for getting a chunk of messages from the server.
     * Note that if you want "raw" messages (unencrypted), use 'getRawMessageMap()'.
     */
    @Ready async getMessageMap(messageKeys: Set<string>): Promise<Map<string, Message>> {
        if (DBG0) console.log(SEP, `[Channel.getMessageMap] called with ${messageKeys.size} keys ...`, SEP)
        if (!isSet(messageKeys)) throw new SBError("[Channel.getMessageMap] messageKeys is not a Set")
        const messagePayloads = await this.getRawMessageMap(messageKeys)
        if (DBG0) console.log(SEP, `[Channel.getMessageMap] got ${messagePayloads.size} messagePayloads ... decoding`, SEP)
        const messageMap = await this.convertRawMessageMap(messagePayloads)
        if (DBG0) console.log(SEP, "[Channel.getMessageMap] got messageMap ... done, returning", SEP)
        return(messageMap)
    }

    /**
     * Returns a DeepHistory object corresponding to the channel. Note:
     * this will (live) instantiate this object at the time of calling
     * this function. The returned object is not kept in 'sync' with the
     * server in any manner. This allows calling traverse and similar
     * operations on it, repeatedly. Calling this function multiple times
     * is, in fact, not a lot of overhead, given the nature of the history
     * tree structure (eg it's mostly immutable).
     */
    async getHistory(): Promise<ClientDeepHistory> {
        await this.channelReady
        _sb_assert(this.channelId, "Channel.getHistory: no channel ID (?)")
        const data = await this.callApi('/getHistory') // as MessageHistoryDirectory
        if (DBG2) console.log(SEP, "getHistory result:\n", JSON.stringify(data, null, 2), SEP)
        const h = new ClientDeepHistory(data, this)
        return h
    }

    /**
     * Sets 'page' as the Channel's 'page' response. If type is provided, it will
     * be used as the 'Content-Type' header in the HTTP request when retrieved;
     * also, if the type is 'text-like', it will be recoded to UTF-8 before
     * delivery. Prefix indicates the smallest number of acceptable characters in
     * the link. Default is 12, shortest is 6. 
     */
    @Ready @Owner setPage(options: { page: any, prefix?: number, type?: string }) {
        var { page, prefix, type } = options
        _sb_assert(page, "Channel.setPage: no page (contents) provided")
        prefix = prefix || 12
        if (prefix < 6) throw new SBError("Channel.setPage: prefix must be at least 6 characters")
        type = type || 'sb384payloadV3'
        return this.callApi('/setPage', {
            page: page,
            type: type,
            prefix: prefix,
        })
    }

    /**
     * Note that 'getPage' can be done without any authentication, in which
     * case have a look at ChannelApi.getPage(). If however the Page is locked,
     * you need to access it through this ChannelApi entry point.
     * 
     * But conversely, we don't need a prefix or anything else, since
     * we know the channel. So .. we can just shoot this off.
     * 
     * Note that a 'Page' might be mime-typed, in which case you should
     * use a regular fetch() call and handle results accordingly. This
     * function is for 'sb384payloadV3' only.
     */
    @Ready async getPage() {
        const prefix = this.hashB32 // we know the full prefix
        if (DBG0) console.log(`==== ChannelApi.getPage: calling fetch with: ${prefix}`)
        const page = await (getSBFetch())(this.channelServer + '/api/v2/page/' + prefix)
            .catch((e) => { throw new SBError(`[Channel.getPage] fetch failed: ${e}`) })
        const contentType = page.headers.get('content-type')
        if (contentType !== 'sb384payloadV3')
            throw new SBError("[Channel.getPage] Can only handle 'sb384payloadV3' content type, use 'fetch()'")
        const buf = await page.arrayBuffer()
        return extractPayload(buf).payload
        // return extractPayload(await SBApiFetch(this.channelServer + '/api/v2/page/' + prefix)).payload
    }

    // TODO:
    // * add padding/unpadding to KV
    // * add encryption/decryption of both keys and values
    // * add setup code, it'll use the KV as well for state like nonce and salt
    // * for larger values, it might make sense to shard them?

    // todo: should probably be in SBCrypto
    async #deriveAESKeyHKDF(): Promise<CryptoKey> {
        if (!this.#kvParams) throw new SBError("Channel.deriveAESKeyHKDF() - no kvParams")
        const salt = this.#kvParams.salt
        const hkdfInput = new Uint8Array(assemblePayload({
            x: this.binaryD, y: this.#kvParams.entropy, z: this.#kvParams.derivationNonce
        })!)
        // Import hkdfInput as a raw key for HKDF
        const hkdfBaseKey = await crypto.subtle.importKey(
            'raw',
            hkdfInput,
            {
                name: 'HKDF',
            },
            false,
            ['deriveKey']
        );
        // Derive AES-256-GCM key using HKDF
        const aesKey = await crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: salt,
                info: new TextEncoder().encode('AES-GCM SHA-256 key'),
            },
            hkdfBaseKey,
            {
                name: 'AES-GCM',
                length: 256,
            },
            false,
            ['encrypt', 'decrypt']
        );
        return aesKey;
    }

    async #initializeKV() {
        if (this.#kvParams) return;
        if (this.#initializingKV) return this.#initializingKV;
        this.#initializingKV = (async () => {
            if (!this.binaryD) throw new SBError("Channel.initializeKV() - no binaryD provided");
            const kv = await this.get('__KV__params');
            if (kv) {
                this.#kvParams = structuredClone(kv);
                this.#kvParams.aesKey = await this.#deriveAESKeyHKDF();
            } else {
                const x = {
                    derivationNonce: crypto.getRandomValues(new Uint8Array(12)),
                    salt: crypto.getRandomValues(new Uint8Array(16)),
                    entropy: crypto.getRandomValues(new Uint8Array(32)),
                };
                this.#kvParams = structuredClone(x);
                this.#kvParams.aesKey = await this.#deriveAESKeyHKDF(); // need the key to 'put'
                await this.#_put('__KV__params', x, false); // omit cryptokey, and stored unencrypted
            }
        })();
        try {
            await this.#initializingKV;
            // console.log(SEP, "Channel.initializeKV() - done", SEP, this.#kvParams, SEP)
        } finally {
            this.#initializingKV = undefined;
        }
    }

    // generates key (location) for KV storage; we can't encrypt this,
    // since it needs to be deterministic
    async #hashKey(key: any): Promise<string> {
        if (!key) throw new SBError("Channel.hashKey() - no key provided")
        let keyWrapper
        if (typeof key === 'string' && key.startsWith('__KV__')) {
            keyWrapper = {
                x: this.binaryD,
                // omit entropy, or we'll get recursion
                key: key,
            }
        } else {
            if (!this.#kvParams) await this.#initializeKV()
            keyWrapper = {
                x: this.binaryD,
                y: this.#kvParams!.entropy,
                key: key,
            }
        }
        const h = await crypto.subtle.digest('SHA-256', assemblePayload(keyWrapper)!)
        return arrayBufferToBase62(h)
}

    // should probably be a static function in SBCrypto
    async #encryptPayload(
        aesKey: CryptoKey,
        plaintext: ArrayBuffer,
        nonce: NONCE_TYPE
      ): Promise<ArrayBuffer> {
        const ciphertext = await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: nonce,
          },
          aesKey,
          plaintext
        );
        return ciphertext;
      }

    async #decryptPayload(
        aesKey: CryptoKey,
        ciphertext: ArrayBuffer,
        nonce: NONCE_TYPE
    ): Promise<ArrayBuffer> {
        const plaintext = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: nonce,
            },
            aesKey,
            ciphertext
        );
        return plaintext;
    }

    async #_put(key: any, value: any, encrypt = true) {
        const keyHash = await this.#hashKey(key)
        const nonce = crypto.getRandomValues(new Uint8Array(12))
        const paddedpayload = StorageApi.padBuf(assemblePayload(value)!);
        const finalPayload = encrypt
            ? await this.#encryptPayload(this.#kvParams!.aesKey!, paddedpayload, nonce)
            : paddedpayload
        const packagedValue = assemblePayload({
            nonce: nonce,
            timestamp: await ChannelApi.dateNow(),
            version: 1,
            encrypted: encrypt,
            payload: finalPayload,
        })
        // console.log(SEP, "Channel._put() - packaged value:\n", SEP, packagedValue, SEP)
        return this.callApi('/kv', { type: 'global', operation: 'write', key: keyHash, value: packagedValue })
    }

    /**
     * Writes a key-value to the channel. Values can be any type and are
     * mutable.
     *
     * Size of an individual value can be up to 4 MiB, but note that channel KV
     * storage is (much) more expensive than shard/object storage, so you're
     * generally better off shardifying large values.
     *
     * If the channel is out of budget, KV writes allow a small amount of
     * "overdraft". This allows you to update small amount of KV state to avoid
     * inconsistencies, for example a counter or other summary information.
     *
     */
    @Ready @Owner async put(key: any, value: any, encrypt = true) {
        if (typeof key === 'string' && key.startsWith('__KV__'))
            throw new SBError("Channel.put() - string key prefix '__KV__' is read-only")
        return this.#_put(key, value, encrypt)
    }

    /**
     * Reads a key-value from the channel. If key is not found, it will return
     * 'undefined'. 
     */
    @Ready @Owner async get(key: any): Promise<any> {
        if (!key) throw new SBError("Channel.get() - no key provided")
        const r = await this.callApi('/kv', { type: 'global', operation: 'read', key: await this.#hashKey(key) })
        // console.log(SEP, "Channel.get() result:\n", SEP, r, SEP)
        if (!r || r.success !== true) throw new SBError(`Channel.get() failed ('success' false)`)
        if (!r.value) {
            // console.log(SEP, "Channel.get() - no value found, returning undefined", SEP)
            return undefined
        }
        const v = extractPayload(r.value).payload
        // console.log(SEP, "Channel.get() extracted value:", SEP, v, SEP)
        if (!v.payload || !v.nonce || v.version != 1) throw new SBError(`Channel.get() failed (got invalid structure)`)
        if (v.encrypted === false)
            return extractPayload(v.payload).payload
        if (!this.#kvParams || !this.#kvParams.aesKey) throw new SBError("Channel.get() - no kvParams, or no aes key, needed to decrypt")
        const decryptedPayload = await this.#decryptPayload(this.#kvParams.aesKey!, v.payload, v.nonce)
        return extractPayload(decryptedPayload).payload
    }

    /**
     * Adds 'SBUserId' to accepted visitors. Owner only.
     */
    @Ready @Owner acceptVisitor(userId: SBUserId) { return this.callApi('/acceptVisitor', { userId: userId }) }

    /**
     * Returns with total number of permitted (different) visitors/users. Owner only.
     * Default for a channel is to accept anybody that comes along, to change that
     * you would call 'localChannel()'
     */
    @Ready @Owner getCapacity() { return (this.callApi('/getCapacity')) }

    @Ready getInfo() { return this.callApi('/info') }

    /**
     * Returns a structure with various channel information. Owner only.
     * For common pieces of information there various convenience functions.
     */
    @Ready @Owner getAdminData() { return this.callApi('/getAdminData') as Promise<ChannelAdminData> }

    /**
     * Convenience function. Returns 'mother' channel, if any. Owner only.
     */
    @Ready @Owner getMother() {
        return this.getAdminData().then((adminData) => {
            return adminData.motherChannel
        });
    }

    /**
     * Convenience function. Returns boolean for whether channel is locked or not. Owner only.
     */
    @Ready @Owner isLocked() {
        return this.getAdminData().then((adminData) => {
            return adminData.locked
        });
    }

    /**
     * Locks down the channel (only visitors the Owner has pre-approved have access).
     * Owner only.
     */
    @Ready @Owner lock(): Promise<{ success: boolean }> { return this.callApi('/lockChannel') }

    /**
     * Same as lock(). Owner only
     */
    @Ready @Owner lockChannel(): Promise<{ success: boolean }> { return this.callApi('/lockChannel') }

    /** Sets limit of number of (different) visitors that can join. Owner only. */
    @Ready @Owner setCapacity(capacity: number) { return this.callApi('/setCapacity', { capacity: capacity }) }
    /** Sets limit of number of (different) visitors that can join. Same as setCapacity. Owner only. */
    @Ready @Owner updateCapacity(capacity: number) { return this.callApi('/setCapacity', { capacity: capacity }) }

    /**
     * Returns the 'channel data' structure: various keys etc.
     */
    @Ready @Memoize getChannelKeys(): Promise<SBChannelData> { return this.callApi('/getChannelKeys') }

    /**
     * Returns amount of storage available to 'you' on the channel.
     * Currently this is all the budget (please do not abuse),
     * but in the future this will be on a per-user basis. (Except for Owner)
     */
    @Ready async getStorageLimit(): Promise<number> {
        const result = await this.callApi('/getStorageLimit');
        const storageLimit = result?.storageLimit;
        if (typeof storageLimit !== 'number') {
            const payload = typeof result === 'string' ? result : JSON.stringify(result);
            throw new SBError(`[Channel.getStorageLimit] expected { storageLimit: number }, got: ${payload}`);
        }
        return storageLimit;
    }

    /**
     * 'Mint' a storaged token off a channel.
     */
    @Ready @Retry(1) async getStorageToken(size: number) { return validate_SBStorageToken(await this.callApi('/getStorageToken', { size: size })) }

    /**
     * "budd" will spin a channel off an existing one that you own,
     * or transfer storage budget to an existing channel.
     * 
     * You need to provide one of the following combinations of info:
     * 
     * - nothing: creates new channel with minmal permitted budget
     * - just storage amount: creates new channel with that amount, returns new channel
     * - just a target channel: moves a chunk of storage to that channel
     * - target channel and storage amount: moves that amount to that channel
     * - keys and storage amount: creates new channel with those keys and that storage amount
     * - if there's a storage token, add (top up) that storage to the channel (ignores size)
     * 
     * If you want to budd into a channel with specific keys, you'll need to
     * create a new set of keys (ChannelKeys) and pass the SBChannelData from that.
     * 
     * It returns a complete ChannelHandle, which will include the private key
     * 
     * Another way to remember the above: all combinations are valid except
     * both a target channel and assigning keys.
     * 
     * In terms of 'keys', you can provide a JsonWebKey, or a SBUserPrivateKey,
     * or a channel handle. JWK is there for backwards compatibility.
     * 
     * Note: if you're specifying the target channel, then the return values will
     * not include the private key (that return value will be empty).
     * 
     * Note: the owner of the target channel will get a message that you budded
     * into their channel, which includes the channelId it was budded from.
     * 
     * Note: a negative storage amount is interpreted as 'leave that much behind'.
     * 
     * Any indications that your parameters are wrong will result in a rejected
     * promise. This includes if you ask for more storage than is there, or if
     * your negative value is more than the storage budget that's there. 
     * 
     * If the budget and target channels are the same, it will throw.
     * 
     * If you omit budget size, it will use the smallest allowed new channel
     * storage (currently 32 MB). This will happens regardless of if you are
     * creating a new channel, or 'depositing'.
     * 
     * If you give the size value of 'Infinity', then all the storage available
     * on the source channel will be transferred to the target channel
     * (aka 'plunder').
     * 
     * On the server side, budd is in two steps, first extracting the storage
     * budget from the mother channel, and then creating or transferring the
     * storage budget to the target channel. 
     * 
     * Any issues and it will throw an Error.
     * 
     */
    @Ready @Owner async budd(options?: { targetChannel?: ChannelHandle, size?: number, token?: SBStorageToken })  {
        // in general we code a bit conservatively in budd(), to make sure we're returning a valid channel
        var { targetChannel, size, token } = options || {}
        if (!targetChannel) {
            targetChannel = (await new Channel().ready).handle
            if (DBG0) console.log("\n", SEP, "[budd()]: no target channel provided, using new channel:\n", SEP, targetChannel, "\n", SEP)
        } else if (this.channelId === targetChannel.channelId) {
            throw new Error("[budd()]: source and target channels are the same, probably an error")
        }
        if (!targetChannel) throw new SBError("[budd()]: no target channel provided")
        const targetChannelData = targetChannel.channelData
        if (!targetChannelData) {
            throw new Error(`[budd()]: target channel has no channel data, probably an error`)
        }
        if (token) {
            // if (size || targetChannel) throw new SBError("[budd()]: cannot specify token and size or target channel")
            if (size) throw new SBError("[budd()]: cannot specify token and size (warning, currently treated as error)")
            else size = Infinity // ToDo: confirm w server code
            token = validate_SBStorageToken(token)
        } else {
            if (!size) size = NEW_CHANNEL_MINIMUM_BUDGET // if nothing provided, goes with 'minimum'
            if (size !== Infinity && Math.abs(size) > await this.getStorageLimit()) {
                // server will of course enforce this but it's convenient to catch it earlier
                throw new Error(`[budd()]: storage amount (${size}) is more than current storage limit`)
            }
        }
        try {
            targetChannelData.storageToken = token || await this.getStorageToken(size!);
            if (DBG0) console.log(`[budd()]: requested ${size}, got storage token:`, targetChannelData.storageToken)
            // const newChannelData = validate_SBChannelData(await this.callApi('/budd', targetChannelData))
            const targetChannelApi = await new Channel(targetChannel).ready
            if (!targetChannelApi.channelServer) targetChannelApi.channelServer = this.channelServer
            const newChannelData = validate_SBChannelData(await targetChannelApi.callApi('/budd', targetChannelData))
            if (targetChannel.channelId !== newChannelData.channelId) {
                console.warn("[budd()]: target channel ID changed, should not happen, error somewhere\n", SEP)
                console.warn("targetChannel:", targetChannel, "\n", SEP)
                console.warn("newChannelData:", newChannelData, "\n", SEP)
                throw new Error(`[budd()]: target channel ID changed, should not happen, error somewhere`)
            }
            if (!newChannelData.storageToken)
                console.warn("[budd()]: target channel has no storage token, possibly an error, should be returned from server")
            const newHandle = {
                [SB_CHANNEL_HANDLE_SYMBOL]: true,
                channelId: newChannelData.channelId,
                userPrivateKey: targetChannel.userPrivateKey,
                channelServer: this.channelServer,
                channelData: newChannelData
            }
            if (DBG0) console.log("[budd()]: success, newHandle:", newHandle)
            return(validate_ChannelHandle(newHandle))
        } catch (e: any) {
            throw new Error(`[budd] Could not get storage token from server, are you sure about the size? ${WrapError(e)}`);
        }
    }

    /* Some utility functions that are perhaps most logically associated with 'Channel.x' */

    /**
     * Returns the 'lowest' possible timestamp.
     */
    static LOWEST_TIMESTAMP = '0'.repeat(26);

    /**
     * Returns the 'lowest' possible timestamp.
     */
    static HIGHEST_TIMESTAMP = '3'.repeat(26);

    /**
     * Converts from timestamp to 'base 4' string used in message IDs.
     * 
     * Time stamps are monotonically increasing. We enforce that they must be
     * different. Stored as a string of [0-3] to facilitate prefix searches (within
     * 4x time ranges). We append "0000" for future needs, for example if we need
     * above 1000 messages per second. Can represent epoch timestamps for the next
     * 400+ years. Currently the appended "0000" is stripped/ignored.
     * 
     * Note: '0' will return LOWEST_TIMESTAMP, 'Infinity' will return HIGHEST_TIMESTAMP.
     * 
     * If 'tsNum' is undefined it will return undefined.
     */
    static timestampToBase4String(tsNum: number | undefined): string | undefined {
        if (tsNum === undefined) return undefined
        if (tsNum < 0) throw new SBError("[timestampToBase4String] Negative timestamp")
        if (tsNum === 0) return Channel.LOWEST_TIMESTAMP
        if (tsNum === Infinity) return Channel.HIGHEST_TIMESTAMP
        return tsNum.toString(4).padStart(22, "0") + "0000" // total length 26
    }

    /**
     * Converts the server format (base4) to a string timestamp (ISO format).
     */
    static base4stringToDate(tsStr: string) {
        const ts = parseInt(tsStr.slice(0, -4), 4)
        return new Date(ts).toISOString()
    }

    /**
     * Will take values (or keys), and return the lowest and highest values;
     * empty data is fine and will return '[]' (falsey).
     */
    static getLexicalExtremes<T extends number | string>(set: Set<T> | Array<T> | Map<T, any>): [T, T] | [] {
        if (!(set instanceof Set || set instanceof Array || set instanceof Map))
            throw new SBError("[getLexicalExtremes] Paramater must be a Set, Array, or Map");
        const arr = set instanceof Array ? set : Array.from(set.keys()); // this is legit, which is cute
        if (arr.length === 0) return [];
        let [min, max] = [arr[0], arr[0]] as [T, T];
        for (const value of arr) {
            if (value < min) min = value;
            if (value > max) max = value;
        }
        return [min, max];
    }

    /**
     * Given a set of (full) keys, reviews all the timestamp prefixes, and returns
     * the shortest prefix that would range all the keys in the set.
     */
    static messageKeySetToPrefix = (keys: Set<string>): string => {
        if (!isSet(keys)) throw new SBError("[messageKeySetToPrefix] keys is not a Set")
        if (keys.size === 0) return '0'; // special case (everything)
        const [lowest, highest] = Channel.getLexicalExtremes(keys);
        _sb_assert(lowest && highest, "[timestampLongestPrefix]: no lowest or highest (internal error?)")
        const { timestamp: s1 } = Channel.deComposeMessageKey(lowest!)
        const { timestamp: s2 } = Channel.deComposeMessageKey(highest!)
        let i = 0;
        while (i < s1.length && i < s2.length && s1[i] === s2[i]) i++;
        return s1.substring(0, i);
    }

    static timestampLongestPrefix = (s1: string, s2: string): string => {
        if (s1 && s2 && typeof s1 === 'string' && typeof s2 === 'string' && s1.length === 26 && s2.length === 26) {
            let i = 0;
            while (i < s1.length && i < s2.length && s1[i] === s2[i]) i++;
            return s1.substring(0, i);
        } else throw new SBError(`[timestampLongestPrefix]: invalid input:\n '${s1}' or '${s2}'`);
    }

    static timestampRegex = /^[0-3]{26}$/;

    /**
     * Reverse of timestampToBase4String. Strict about the format (needs to be
     * `[0-3]{26}`), returns undefined if there's any issue. LOWEST_TIMESTAMP
     * will return 0, HIGHEST_TIMESTAMP will return Infinity.
     */
    static base4StringToTimestamp(tsStr: string): number | undefined {
        if (!tsStr || typeof tsStr !== 'string' || tsStr.length !== 26 || !Channel.timestampRegex.test(tsStr)) return undefined
        if (tsStr === Channel.LOWEST_TIMESTAMP) return 0
        if (tsStr === Channel.HIGHEST_TIMESTAMP) return Infinity
        return parseInt(tsStr.slice(0, -4), 4);
    }

    /*
    * Similar to {@link base4StringToTimestamp}, but takes a timestamp string
    * and returns an (ISO) formatted date string. Returns 'undefined' if there's
    * an issue with the timestamp. Note that it rigidly expects a 26 character
    * timestamp (prefix) string. 
    */
    static base4StringToDate(tsStr: string) {
        const ts: number | undefined = Channel.base4StringToTimestamp(tsStr)
        if (ts) return new Date(ts).toISOString()
        else return undefined
    }

    /**
     * Teases apart the three elements of a channel message key. Note, this does not
     * throw if there's an issue, it just sets all the parts to '', which should
     * never occur. Up to you if you want to run with that result or assert on it.
     * Strict about the format (defined as `[a-zA-Z0-9]{43}_[_a-zA-Z0-9]{4}_[0-3]{26}`).
     * 
     * Note that '____' is the default subchannel.
     */
    static deComposeMessageKey(key: string): { channelId: string, i2: string, timestamp: string } {
        const regex = /^([a-zA-Z0-9]{43})_([_a-zA-Z0-9]{4})_([0-3]{26})$/;
        const match = key.match(regex);
        if (match && match.length >= 4)
            // return [match![1]!, match![2]!, match![3]!]
            return { channelId: match[1], i2: match[2], timestamp: match[3] }
        else return { channelId: '', i2: '', timestamp: '' }
    }

    /**
     * Creates a 'message key' from constituent parts.
     */
    static composeMessageKey(channelId: ChannelId, timestamp: number, subChannel: string = '____',) {
        let id = `${channelId}_${subChannel ?? '____'}_${Channel.timestampToBase4String(timestamp)}`
        if (messageRegex.test(id)) return id
        else throw new SBError(`[composeMessageKey] generated invalid message key: ${id}`)
    }

} /* class Channel */

