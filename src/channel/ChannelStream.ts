// (c) 2024 384 (tm)

import {
    _sb_assert, ChannelId,
    SBUserPrivateKey, SBError,
    SEP, SEP_, Memoize,
    extractPayload, assemblePayload,
    isSet
} from 'src/common'

import {
    MessageQueue
} from 'src/utils/MessageQueue'

import { ChannelMessage } from './ChannelMessage'
import { ChannelApi } from './ChannelApi'
import { SBProtocol } from './Protocol'
import { ChannelHandle, _check_ChannelHandle } from './ChannelHandle'
import { Message, MessageOptions } from 'src/channel/Message'
import { SBStorageToken } from 'src/storage/StorageToken'
import { Channel, _check_SBChannelData } from './Channel'
import { ChannelSocket } from './ChannelSocket'
import { MessageCache } from './MessageCache'
import { AsyncSequence } from 'src/utils/AsyncSequence'
// import { ClientDeepHistory } from 'src/storage/MessageHistory'

const DBG0 = false
const DBG2 = false

function _assert(val: unknown, msg: string) {
    if (!(val)) {
        const m = ` <<<<[_sb_assert] assertion failed: '${msg}'>>>> `;
        if (DBG0) console.trace(m)
        throw new SBError(m);
    }
}

/**
 * Options for ChannelStream.spawn(). Optional start/end are timestamps,
 * indicating a range (inclusive) of messages to fetch. If 'live' is true,
 * the stream will continue to fetch new messages as they arrive. Note
 * that timestamps can be '0' (earliest) or 'Infinity' (latest). If 'start'
 * is a larger value than 'end', the stream will be in reverse order.
 * 
 * Note: 'prefix' and 'reverse' are being deprecated (used for 'start()' method).
 */
export interface ChannelStreamOptions {
    start?: number;
    end?: number;
    live?: boolean;
    /** Note: 'prefix' is being deprecated */
    prefix?: string;
    /** Note: 'reverse' is being deprecated */
    reverse?: boolean;
}

// helper class for ChannelStream
class MessageSequence extends AsyncSequence<Message> {
    private uniqueMessageSequenceId = Symbol()
    // private toSkip = 0
    constructor(private ch: ChannelStream, private options: ChannelStreamOptions = {}) {
        super();
        this.source = this.createSource()
    }

    private async *_historySequence(start: number, end: number, forward: boolean): AsyncIterableIterator<Message> {
        // before proceeding with recent messages, we look at history
        const channelHistory = await this.ch.getHistory()
        if (DBG2) console.log(SEP, "[MessageSequence] Fetching channel history from", SEP, channelHistory, SEP)
        if (DBG0) console.log(SEP, `[MessageSequence] History covers from ${channelHistory.fromTimestamp} to ${channelHistory.toTimestamp}`, SEP)
        const chHistory = channelHistory.traverseMessagesGenerator(
            // ClientDeepHistory expects these in order
            start <= end ? start : end,
            end >= start ? end : start,
            !forward // 'reverse' for ChannelHistory
        )
        yield* chHistory
        if (DBG0) console.log(SEP, "[MessageSequence] Done fetching channel history ...", SEP)
    }

    private async *_recentSequence(timeStamps: number[], myChannelId: string, s: number, e: number, forward: boolean): AsyncIterableIterator<Message> {
        if (DBG0) console.log(SEP, "[MessageSequence] Fetching recent messages ...", SEP)
        // create a 'keyArray' that reconstructs the id values from the timeStamps
        const start = forward ? s : e
        const end = forward ? e : s
        timeStamps = (timeStamps.filter((ts) => ts >= start && ts <= end)).sort((a, b) => forward ? a - b : b - a)
        if (DBG0) console.log(SEP, `Fetching messages using getMessageMap(.. ${timeStamps.length} entries ..) ...`, SEP, timeStamps, SEP)
        const keyArray = timeStamps.map((ts) => Channel.composeMessageKey(myChannelId, ts))
        const chunkSize = 64
        for (let i = 0; i < keyArray.length; i += chunkSize) {
            // note: currently not much point doing this in parallel since it'll hit the same DO
            const chunk = keyArray.slice(i, i + chunkSize)
            if (DBG0) console.log(SEP, "Fetching chunk:", SEP, chunk, SEP)
            const chunkMessages = await this.ch.getMessageMap(new Set(chunk))
            const messageArray = Array.from(chunkMessages.values())
               .sort((a, b) => forward ? a.serverTimestamp - b.serverTimestamp : b.serverTimestamp - a.serverTimestamp)
            if (DBG0) console.log(SEP, "Received chunk:", SEP, messageArray.map(m => m.body), SEP)
            for (const m of messageArray) {
                yield m
            }
        }
    }

    private async *_liveSequence(myQ: MessageQueue<Message>, latestTimestampStr: string): AsyncIterableIterator<Message> {
        if (DBG0) console.log(SEP, "[MessageSequence] Switching to live stream ...", SEP)
        await this.ch.startRestartSocket()
        try {
            while (true) {
                const message = await myQ.dequeue();
                if (this.ch.closingDown) {
                    if (DBG0) console.log("[MessageSequence] ChannelStream is closing down, breaking out ...")
                    break
                }
                if (message === null) {
                    if (DBG0) console.log("[MessageSequence] Queue is empty, breaking out ...")
                    break;
                }
                if (DBG0) console.log(SEP, "++++ MSG: ", message._id, " [MessageSequence]", SEP)
                const key = message!._id
                const { timestamp } = Channel.deComposeMessageKey(key)
                if (timestamp > latestTimestampStr) {
                    latestTimestampStr = timestamp
                    yield message
                } else {
                    if (DBG0) console.log("[MessageSequence] Skipping message, already processed:", message)
                    continue
                }
            }
        } catch (error) {
            console.error("[getNewMessages] Error in getNewMessages:", error)
            throw error;
        }
    }

    private async *createSource(): AsyncIterableIterator<Message> {
        try {
            await this.ch.ready

            const { start = 0, end = Infinity, live = false } = this.options;
            const forward = end >= start;
            const myChannelId = this.ch.channelId
            if (DBG0) console.log(SEP, "[MessageSequence] messageStream() options:", SEP, this.options, SEP,
                "Channel ID:", myChannelId, SEP, "Start:", start, "End:", end, "Live:", live, "Forward:", forward, SEP
            );

            if ((live && !forward) || (live && end !== Infinity))
                throw new SBError("[MessageSequence] Cannot start live stream in reverse or with an end timestamp")

            let latestTimestampStr = Channel.LOWEST_TIMESTAMP

            // make sure to capture brand new messages, if that will be needed
            const myQ = new MessageQueue<Message>()
            if (live) this.ch.streamQueueArray.set(this.uniqueMessageSequenceId, myQ)

            // get 'recent' messages that's on the server
            let timeStamps: number[] = []
            {
                const { historyShard, keys } = await this.ch.getMessageKeys()
                const keyArray = Array.from(keys.keys())
                if (DBG2) console.log(SEP, `Found ${keys.size} recent messages:`, SEP, keys, SEP, "history shard:", historyShard, SEP)
                // ToDo: handle non-'____' keys
                timeStamps = keyArray.map((k) => Channel.base4StringToTimestamp(Channel.deComposeMessageKey(k).timestamp)!)
                // sort the timeStamps array in accordance with 'forward'
                timeStamps.sort((a, b) => forward ? a - b : b - a)
                // remove any time stamps that are outside the range
                timeStamps = timeStamps.filter((ts) => forward ? ts >= start && ts <= end : ts <= start && ts >= end)
                // console.log(SEP, `Time stamps [${timeStamps.length} from ${n}] (note, forward is ${forward}, boundaries are ${start}, ${end}):`, '\n', timeStamps, SEP)
            }

            if (forward) {
                yield* this._historySequence(start, end, forward)
                yield* this._recentSequence(timeStamps, myChannelId, start, end, forward)
                if (live) yield* this._liveSequence(myQ, latestTimestampStr)
            } else {
                yield* this._recentSequence(timeStamps, myChannelId, start, end, forward)
                yield* this._historySequence(start, end, forward)
            }

        } catch (e) {
            console.error("[MessageSequence] Error in messageStream:", e)
            throw e
        } finally {
            // looks like we're all done, so some cleanup
            if (DBG0) console.log("[MessageSequence] Cleaning up ...")
            this.ch.streamQueueArray.delete(this.uniqueMessageSequenceId)
            // the local mQ will just be garbage collected
        }

    }

    // skip(n: number) {
    //     this.toSkip += n
    //     return this
    // }

    [Symbol.asyncIterator](): AsyncIterator<Message> {
        return this.source[Symbol.asyncIterator]();
    }


}

/** @public */
export class ChannelStream extends Channel {
    // static version = '20240704.0'
    sbChannelStreamReady: Promise<ChannelStream>
    static ReadyFlag = Symbol('SBChannelStreamReadyFlag');
    private channelSocket?: ChannelSocket;

    // todo: the AI really doesn't like how i use this time stamp for
    // filtering/managing what messages to look at. so far i think it's pointing
    // to 'false positive' race conditions, but, conversely, this approach might
    // be more error prone over time?
    private latestTimestampStr = Channel.LOWEST_TIMESTAMP;

    // for the (older) stream interface
    private messageQueue = new MessageQueue<Message>();

    // for the (newer) stream interface (spawn)
    streamQueueArray: Map<symbol, MessageQueue<Message>> = new Map()

    sb: ChannelApi
    streamStarted = false
    private restartInProgress = false

    // the cache is shared by all streamobjects
    public static globalMessageCache: MessageCache = new MessageCache()
    public messageCache: MessageCache = ChannelStream.globalMessageCache

    constructor() // requesting a new channel, no protocol
    constructor(newChannel: null, protocol: SBProtocol) // requesting a new channel, with this protocol
    constructor(key: SBUserPrivateKey, protocol?: SBProtocol)
    constructor(handle: ChannelHandle, protocol?: SBProtocol)
    constructor(handleOrKey?: ChannelHandle | SBUserPrivateKey | null, protocol?: SBProtocol) {
        if (handleOrKey === null && protocol !== undefined)
            super(null, protocol);
        else if (handleOrKey === null && !protocol)
            super()
        else if (typeof handleOrKey === 'string')
            super(handleOrKey as SBUserPrivateKey, protocol);
        else
            super(handleOrKey as ChannelHandle, protocol);

        _assert(this.channelServer, "Internal Error (channelServer not known) [L364]")
        this.sb = new ChannelApi(this.channelServer!)

        this.sbChannelStreamReady = new Promise<ChannelStream>(async (resolve) => {
            await super.ready
                ; (this as any)[ChannelStream.ReadyFlag] = true
            if (DBG0) console.log("[channelStream] ChannelStream ready")
            resolve(this)
        });
    }

    get latestTimeStampDate() { return Channel.base4StringToDate(this.latestTimestampStr) }

    /** sees all messages regardless of source; keeps track of
        latestTimestampStr; returns 'true' if this is a new message
        ('new' from the perspective of the lifetime of this ChannelStream object) */
    private processMessage = (message: Message | undefined) => {
        _assert(typeof message !== 'undefined', "Internal Error [L227]")
        const key = message!._id
        const { channelId, timestamp } = Channel.deComposeMessageKey(key)
        _assert(channelId === this.channelId, "Internal Error [L376]")
        if (DBG2) console.log(
            SEP,
            "[channelStream.processMessage] Evaluating time stamp", timestamp, "against", this.latestTimestampStr, '\n',
            "                               ... eg comparing new value:", Channel.base4StringToDate(timestamp), '\n',
            "                               ...          versus latest:", Channel.base4StringToDate(this.latestTimestampStr), '\n',
            "                               ... decision is to " + (timestamp > this.latestTimestampStr ? "UPDATE (and forward msg)" : "SKIP"),
            "                               ... message:\n", message, '\n',
            SEP
        )
        if (timestamp > this.latestTimestampStr) {
            this.latestTimestampStr = timestamp
            return true
        } else {
            if (DBG0) console.log("[channelStream.processMessage] Skipping message, already processed:", message)
            return false
        }
    }

    // websocket message handler given to the channel socket. enqueues it.
    private processSocketMessage = async (msg: Message | string) => {
        _assert(typeof msg !== 'string', "Internal Error [L250]") // will throw if it's a low-level messaging thing
        const message = msg as Message
        if (this.streamStarted) {
            // older interface (one stream per ChannelStream object)
            this.messageQueue.enqueue(message)
        }
        // newer interface (spawn)
        for (const [_uniqueMessageSequenceId, q] of this.streamQueueArray) {
            q.enqueue(message)
        }
    }

    // starts live listener on channel websocket
    startRestartSocket = async () => {
        if (this.closingDown) throw new SBError("ChannelStream is closing down, cannot restart socket")
        if (this.restartInProgress) return
        this.restartInProgress = true
        try {
            await this.sbChannelStreamReady
            if (this.channelSocket) {
                if (DBG0) console.log(SEP, "[ChannelStream.startRestartSocket] RESTARTING channel socket ... ")
                this.channelSocket.reset()
            } else {
                if (DBG0) console.log(SEP, "[ChannelStream.startRestartSocket] Starting channel socket ... ")
                // only spot in this file that should actually be creating a new socket
                this.channelSocket = new ChannelSocket(this.handle, this.processSocketMessage, this.protocol);
            }
            this.channelSocket.errorPromise.catch((e: any) => {
                if (!this.closingDown) {
                    console.error(SEP, "[ChannelStream.startRestartSocket] Error in channel socket:", e, SEP)
                    console.warn("[ChannelStream.startRestartSocket] Will wait 1 second then restart")
                    setTimeout(() => {
                        if (DBG0) console.log("[ChannelStream.startRestartSocket] Restarting channel socket ... ")
                        this.startRestartSocket()
                    }, 2000)
                }
            });
            await this.channelSocket.ready;
        } catch (e) {
            console.error("[ChannelStream.startRestartSocket] Error in startRestartSocket:", e)
            throw e
        } finally {
            this.restartInProgress = false
        }
        if (DBG0) console.log("[ChannelStream.startRestartSocket] ... channel socket ready")
    }

    // given a set of keys, compares with what we have in our cache, and fetches
    // anything missing, adding those to the cache. can handle large sets of keys.
    private updateCacheWithTheseKeys = async (keys: Set<string>) => {
        if (this.closingDown) throw new SBError("ChannelStream is closing down, cannot fetch messages")
        if (!isSet(keys)) throw new SBError("Internal Error [L338]")
        await this.messageCache.readyPromise
        let newMessageKeys: string[] = [];
        const cacheKeys = await this.messageCache.getKnownMessageKeys(
            this.channelId!,
            Channel.messageKeySetToPrefix(keys));
        const newKeys = ChannelStream.difference(cacheKeys, keys);
        if (DBG0) console.log("[channelStream.fetchMessages] These are new messages we need to fetch:", newKeys);
        if (newKeys.size === 0) {
            if (DBG0) console.log("[channelStream.fetchMessages] No new messages");
            return newMessageKeys;
        } else {
            const keyArray = Array.from(newKeys)
            const chunkSize = ChannelApi.MAX_MESSAGE_REQUEST_SIZE
            for (let i = 0; i < keyArray.length; i += chunkSize) {
                const chunk = keyArray.slice(i, i + chunkSize)
                const newMessages = await this.getRawMessageMap(new Set(chunk))
                if (DBG0) console.log("[channelStream.fetchMessages] New messages (RAW, these should pop up on stream):", newMessages)
                // add them all to the cache, nota bene in raw format
                for (const [key, value] of newMessages) {
                    await this.messageCache.add(key, value);
                    newMessageKeys.push(key)
                }
            }
            if (DBG0) console.log("New messages added to cache")
        }
        return newMessageKeys.sort()
    }

    /** get complete 'DeepHistory' and populate cache with it, from first to last */
    async getChannelHistory() {
        try {
            if (this.closingDown) throw new SBError("ChannelStream is closing down, cannot fetch messages")
            await this.sbChannelStreamReady
            const channelHistory = await this.getHistory()
            let count = 0
            // todo: there's no optimization currently to keep track of what "periods" of messages
            // are already in the cache; we're fetching and adding full history
            await channelHistory.traverseMessagesEncrypted(
                async (id: string, msg: ChannelMessage) => {
                    if (DBG2) console.log("++++ MSG: ", id, " [getChannelHistory]")
                    // our deep history is extracted, so we need to assemble
                    const b = assemblePayload(msg)!
                    await this.messageCache.add(id, b)
                    count += 1
                }
            )
            if (DBG0) console.log(SEP, `[getChannelHistory] Added ${count} messages to cache`, SEP)
        } catch (e) {
            console.trace("Error in getChannelHistory:", e)
            throw e
        }
    }

    /**
     * given a prefix, calls Channel.getMessageKeys with that prefix;
     * then filters results through fetchMessages(). if we're offline, we will
     * keep trying until we get a response. will pass results to 
     * updateCacheWithTheseKeys() and return the new keys (in array form),
     * together with the history shard.
     */
    private syncCacheWithServer = async (prefix: string = '0') => {
        // ToDo: this is older version, doesn't handle history here
        if (this.closingDown) throw new SBError("ChannelStream is closing down, cannot fetch messages")
        await this.channelReady
        let kh
        try {
            kh = await this.getMessageKeys(prefix); // calls Channel.getMessageKeys
        } catch (e) {
            const msg = `[channelStream.fetchCurrentMessageKeys] Error in fetchMessageKeys, cannot get updated keys (${e})`
            if (msg.includes('offline')) {
                // todo: we can have a better "back online" mechanism nowadays
                if (DBG0) console.log(SEP, "[channelStream.fetchMessageKeys] we are offline, we will keep trying", SEP)
                while (true) {
                    await new Promise((resolve) => setTimeout(resolve, 1000))
                    try {
                        // we have some resilience here in kicking off reading messages
                        kh = await this.getMessageKeys(prefix); // calls Channel.getMessageKeys
                        break
                    } catch (e) {
                        if (DBG0) console.log("[channelStream.fetchCurrentMessageKeys] ... still offline, we will keep trying")
                    }
                }
            } else {
                throw new SBError(msg)
            }
        }
        try {
            if (DBG2) console.log("[channelStream.fetchCurrentMessageKeys] Messages on server and shard:", kh)
            const keysArray = await this.updateCacheWithTheseKeys(kh.keys)
            return keysArray
        } catch (e) {
            const msg = `[channelStream.fetchCurrentMessageKeys] Error, cannot get updated keys (${e})`
            console.error(msg); throw new SBError(msg)
        }
    }

    /**
     * Simply inherits the channel's method, but will return an ChannelStream
     * object. 
     */
    async create(storageToken: SBStorageToken, channelServer?: ChannelId): Promise<ChannelStream> {
        await super.create(storageToken, channelServer);
        return (this)
    }

    get ready() { return this.sbChannelStreamReady }
    get SBChannelStreamReadyFlag() { return (this as any)[ChannelStream.ReadyFlag] }

    // separate from super because this shouldn't (?) need a @Ready decorator
    @Memoize get channelId(): ChannelId { return super.channelId! }

    // a couple of set operation helpers for dealing with message keys
    static difference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
        // also called 'relative complement'
        return new Set([...setB].filter(element => !setA.has(element)));
    }
    static union<T>(setA: Set<T>, setB: Set<T>): Set<T> {
        return new Set([...setA, ...setB]);
    }
    static intersection<T>(setA: Set<T>, setB: Set<T>): Set<T> {
        return new Set([...setA].filter(x => setB.has(x)));
    }

    private async* feedFromMessageCache(prefix?: string): AsyncGenerator<Message> {
        if (DBG0) console.log(SEP, SEP_, `[feedFromMessageCache] Called, prefix '${prefix}'`, '\n', SEP_, SEP)
        if (this.closingDown) throw new SBError("ChannelStream is closing down, cannot fetch messages")
        await this.sbChannelStreamReady
        if (!prefix) prefix = '0'
        const messages = await this.messageCache.getKnownMessages(this.channelId, prefix)
        // first we want to sort them so that we are returning inlexical order
        const sortedKeys = Array.from(messages.keys()).sort() // ToDo: handle reverse here
        if (DBG0) console.log("[feedFromMessageCache] Sorted keys:", sortedKeys)
        for (const key of sortedKeys) {
            const storedMessage = await this.messageCache.get(key)
            if (!storedMessage) throw new SBError("Internal Error [L523]")
            const b = extractPayload(storedMessage).payload
            if (DBG0) console.log("[feedFromMessageCache] Got a stored message, extracted:\n", b)
            const message = await this.extractMessage(b)
            if (message) {
                if (DBG0) console.log("[feedFromMessageCache] Got a well-formed message, time stamp:", message.serverTimestamp)
                if (await this.processMessage(message)) {
                    if (DBG0) console.log(SEP, "++++ MSG: ", message._id, " [feedFromMessageCache]", SEP)
                    yield message
                } else {
                    if (DBG0) console.log("[feedFromMessageCache] Skipping this message, should we?\n", message)
                }
            } else if (DBG0) {
                console.warn("[feedFromMessageCache] Got an undefined message (probably decryption issue)")
                // console.log(b)
            }
        }
    }

    // pulls messages from queue (that have come across ChannelSocket)
    public async* getNewMessages(): AsyncGenerator<Message> {
        // todo: (probably detail) understand AsyncGenerator vs AsyncIterableIterator in this situation?
        if (this.closingDown) throw new SBError("ChannelStream is closing down, cannot fetch messages")
        await this.sbChannelStreamReady
        try {
            while (true) {
                const message = await this.messageQueue.dequeue();
                if (message === null) {
                    if (DBG0) console.log("[getNewMessages] Queue is empty, breaking out ...")
                    break; // Queue closed, exit loop
                }
                if (DBG0) console.log(SEP, "++++ MSG: ", message._id, " [getNewMessages]", SEP)
                if (this.processMessage(message))
                    yield message;
            }
        } catch (error) {
            console.error("[getNewMessages] Error in getNewMessages:", error)
            throw error;
        }
    }

    /**
     * Start stream of messages from the channel. If prefix is provided, only
     * that timestamp prefix and onward are streamed. Prefix can be a complete
     * timestamp (in which case it's a unique message).  If reverse is true, the
     * stream is in reverse. If no prefix is provided, or empty string '' as
     * prefix, stream starts from 'now', with whatever is current latest
     * message and any upcoming ones (and does not go back through history)
     * 
     * To start from the beginning of time, use prefix '0', which will match
     * any possible timestamp prefix.
     * 
     * Nota bene, this returns an AsyncGenerator with type ''Message'':
     * 
     * ```typescript
     * 
     *    # prints all messages in channel, and stays 'live'
     *    for await (const m of channelStream.start({ prefix: '0' })) {
     *       console.log("Got message:", m)
     *    }
     * 
     * Hint on patterns: if you want to first process in reverse for anything
     * 'relevant', and then pick it back up going forward, then start your
     * reverse, grab the first (eg latest) timestamp, and the create a separate
     * ChannelStream with that same timestamp as prefix moving forward. When
     * you're done with the reverse, you can pick up the stream going forward.
     * This way you won't miss any messages.
     * 
     * Note it defaults to leaving you connected. You can set option 'live' to
     * false, and you will just process all the messages at the time you called 'start'.
     * However if you called it with reverse, it will not leave you connected.
     * 
     * Currently, you can't start with both prefix and reverse, eg reverse mode
     * is always from latest message and backwards.
     * 
     * NOTE: this is being deprecated in favor of 'spawn'.
     */
    public async* start(options: ChannelStreamOptions = {}) {

        // todo: some possible things to consider:
        // * the inner generator can take a parameter, so the end user api could
        //   be expanded to allow consumer to, for example, 'jump around' in timestamps
        // * end user consumer can call '.return()' to close stream
        // * we could figure out how to make it simpler to have likely patterns
        //   such as a consumer for history, and at the same time provide a
        //   consumer for 'live and onwards'.

        if (this.closingDown) throw new SBError("[ChannelStream.start] ChannelStream is closing down, cannot fetch messages")
        if (this.streamStarted) throw new SBError("[ChannelStream.start] Stream already started (only one stream per channelStream object)")
        this.streamStarted = true
        const { prefix = '', reverse = false, live = true } = options
        if (reverse) {
            if (reverse || live) throw new SBError("[ChannelStream.start] If running in reverse, cannot (currently) have prefix or run 'live'")
            if (DBG0) console.log(SEP, `[ChannelStream.start] Starting in REVERSE`, SEP)
            throw new SBError("Reverse not implemented yet")
            // yield* this.getNewMessages();
        } else {
            if (!prefix || prefix === '' || prefix === "") {
                if (DBG0) console.log(SEP, `[ChannelStream.start] Starting from 'live' point of messages, nothing historical`, SEP)
                if (live) this.startRestartSocket()
                yield* this.getNewMessages();
            } else {
                if (DBG0) console.log(SEP, `[ChannelStream.start] Starting HISTORICALLY with prefix: ${prefix}`, SEP)

                this.latestTimestampStr = Channel.LOWEST_TIMESTAMP // lowest possible

                // we kick off websocket so we don't miss new stuff; these will queue up in this.messageQueue
                if (live) /* await */ this.startRestartSocket()


                // await this.getChannelHistory() // fetches ALL messages in history and populates cache
                await this.syncCacheWithServer(prefix) // fetches anything the server has and adds to cache

                yield* this.feedFromMessageCache(prefix);
                if (live) yield* this.getNewMessages();

                //  else {
                //     // whatever is in the queue, is what's there
                //     this.messageQueue.close()
                // }
            }
        }
    }

    /**
     * Returns an AsyncSequence of messages from the channel. This is the
     * newer design to process messages, and will supercede 'start'.
     */
    async spawn(options: ChannelStreamOptions = {}): Promise<AsyncSequence<Message>> {
        return new MessageSequence(this, options);
    }

    async close() {
        this.closingDown = true
        this.messageQueue.close()
        if (this.channelSocket)
            await this.channelSocket.close()
        await super.close()
            ; (this as any)[ChannelStream.ReadyFlag] = false
    }

    async send(contents: any, options?: MessageOptions) {
        await this.ready
        if (this.channelSocket) {
            if (DBG0) console.log("[channelStream] Sending via channelSocket ...")
            return this.channelSocket.send(contents, options);
        } else {
            if (DBG0) console.log("[channelStream] Sending via super (Channel) ...")
            return super.send(contents, options);
        }
    }

}

if (DBG0) console.log("==== ChannelStream loaded ====")

