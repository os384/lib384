// (c) 2023-2024 384 (tm)

import {
    _sb_assert, ChannelId, SBUserId,
    SBUserPrivateKey, SBUserPublicKey, SBError,
    SEP, DBG2, Memoize,
    sbCrypto,
} from 'src/common'

const DBG0 = false;

import { SBCrypto } from 'src/sbCrypto/SBCrypto'

import { SBFetch, SBApiFetch, setSBFetch, abortActiveFetches } from 'src/utils/fetch'

import { ChannelHandle, _check_ChannelHandle } from './ChannelHandle'
import { Message } from 'src/channel/Message'
// import { ObjectHandle } from 'src/storage/ObjectHandle'
import { storageCoreKnownShards, fetchPayloadFromHandle } from 'src/storage/core'
import { SBStorageToken, validate_SBStorageToken } from 'src/storage/StorageToken'
import { Channel } from './Channel'

import { SBEventTarget } from 'src/utils/SBEventTarget'
import { ServerDeepHistory } from 'src/storage/MessageHistory';

import { StorageApi } from 'src/storage/StorageApi';
import { ChannelSocket } from 'src/channel/ChannelSocket';

import {
    WEBSOCKET_PING_INTERVAL,
    NEW_CHANNEL_MINIMUM_BUDGET
} from './config'

/**
 * Channel and Storage servers return the same structure.
 */
export interface SBServerInfo {
    version: string,
    channelServer: string,
    storageServer: string,
    jslibVersion?: string,
}

export type ServerOnlineStatus = 'online' | 'offline' | 'unknown';

const SB_CHANNEL_API_BODY_SYMBOL = Symbol('SB_CHANNEL_API_BODY_SYMBOL')


// ToDo: we should add a channel ID to every call that is the budget
// source for any api costs (in case the server decides to charge)

/**
 * Pretty much every api call needs a payload that contains the
 * api request, information about 'requestor' (user/visitor),
 * signature of same, time stamp, yada yada.
 * 
 * Validator is {@link validate_ChannelApiBody}
 * @public
 */
export interface ChannelApiBody {
    [SB_CHANNEL_API_BODY_SYMBOL]?: boolean,
    channelId: ChannelId,
    path: string,
    userId: SBUserId,
    userPublicKey: SBUserPublicKey,
    isOwner?: boolean,
    timestamp: number,
    sign: ArrayBuffer
    apiPayloadBuf?: ArrayBuffer,
    apiPayload?: any, // if present, extracted from apiPayloadBuf
}

/**
 * Return self if it matches shape, otherwise throw. Extraneous properties are ignored
 * 
 * @public
 */
export function validate_ChannelApiBody(body: any): ChannelApiBody {
    if (!body) throw new SBError(`invalid ChannelApiBody (null or undefined)`)
    else if (body[SB_CHANNEL_API_BODY_SYMBOL]) return body as ChannelApiBody
    else if (
        body.channelId && body.channelId.length === 43
        && body.path && typeof body.path === 'string' && body.path.length > 0
        && body.userId && typeof body.userId === 'string' && body.userId.length === 43
        && body.userPublicKey && body.userPublicKey.length > 0
        && (!body.isOwner || typeof body.isOwner === 'boolean')
        && (!body.apiPayloadBuf || body.apiPayloadBuf instanceof ArrayBuffer)
        && body.timestamp && Number.isInteger(body.timestamp)
        && body.sign && body.sign instanceof ArrayBuffer
    ) {
        return { ...body, [SB_CHANNEL_API_BODY_SYMBOL]: true } as ChannelApiBody
    } else {
        if (DBG0) console.error('invalid ChannelApiBody ... trying to ingest:\n', body)
        throw new SBError(`invalid ChannelApiBody`)
    }
}

// Note: 'ChannelApi' replaces 'Snackabra' object

// todo: perhaps "ChannelApi" should be called "ChannelServer"?

/**
  * Main class. It corresponds to a single channel server. Most apps
  * will only be talking to one channel server, but it is possible
  * to have multiple instances of ChannelApi, each talking to a
  * different channel server.
  * 
  * Channel servers are generally associated with a single storage
  * storage, one where the channel server is trusted to make storage
  * allocation decisions.
  * 
  * Takes a single parameter, the URL to the channel server.
  * 
  * @example
  * ```typescript
  *     const sb = new ChannelApi('http://localhost:3845')
  * ```
  * 
  * Websocket server is always the same server (just different protocol),
  * storage server is provided by '/api/v2/info' endpoint from the
  * channel server.
  * 
  * You can give an options parameter with various settings, including
  * debug levels. For ease of use, you can just give a boolean value
  * (eg 'true') to turn on basic debugging.
  * 
  * It might be a bit confusing given it's name, but the "channel API"
  * is provided by Channels. 
  * 
  * The 'sbFetch' option allows you to provide a custom fetch function
  * for accessing channel and storage servers. For example, to provide
  * a specific service binding for a web worker.
  * 
  * ChannelApi also provides accurate online/offline status (if the
  * channel server supports it). It will emit 'online' and 'offline'
  * events, and you can check 'ChannelApi.onlineStatus'.
 */
export class ChannelApi extends SBEventTarget {
    public static version = "20250205.1"

    // max number of messages (with body) that can be requested at once; note that
    // this is calibrated with the server, which might think differently
    public static MAX_MESSAGE_REQUEST_SIZE = 128

    // max number of message *keys* that can be requested at once;
    // this is also the core DeepHistory sharding size
    public static MAX_MESSAGE_SET_SIZE = ServerDeepHistory.MAX_MESSAGE_SET_SIZE

    // these are known shards that we've seen and know the handle for; this is
    // global. hashed on decrypted (but not extracted) contents.
    // public static knownShards: Map<string, ObjectHandle> = new Map();
    public static knownShards = storageCoreKnownShards

    #channelServer: string
    #storage: StorageApi

    // globally paces (messaging) operations, and assures unique timestamps
    public static lastTimeStamp = 0 // todo: x256 (string) format

    // static abortPromises = new Map<symbol, Promise<unknown>>()

    static #activeChannelSockets = new Set<ChannelSocket>()
    public static isShutdown = false // flipped 'true' when closeAll() is called

    public static lastTimestampPrefix: string = '0'.repeat(26)
    static #latestPing = Date.now(); // updated by 'ping'

    // public static online = true; // updated by 'ping'
    public static onlineStatus: ServerOnlineStatus = 'unknown'

    // Private static variable to store the latest channel server
    static #defaultChannelServer: string | null = null

    /**
     * Returns the default channel server URL that's used when no specific server is provided.
     * This will throw an error if no ChannelApi instance has been created yet.
     */
    static get defaultChannelServer(): string {
        if (ChannelApi.#defaultChannelServer === null) {
            throw new SBError('No ChannelApi instance has been created yet. Create a ChannelApi instance before accessing defaultChannelServer.')
        }
        return ChannelApi.#defaultChannelServer
    }

    /**
     * Sets the default channel server URL that's used when no specific server is provided.
     * This is always set whenever creating a new ChannelApi instance, but it can be
     * set in the absence of a ChannelApi instance.
     */
    static set defaultChannelServer(channelServer: string) {
        ChannelApi.#defaultChannelServer = channelServer
    }

    eventTarget = new SBEventTarget()

    static shardBreakpoints: Set<string> = new Set()

    fetchPayload = fetchPayloadFromHandle

    constructor(
        channelServer: string,
        options?:
            {
                DBG?: boolean,
                DBG2?: boolean,
                sbFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
            }
            | boolean
    ) {
        super() // ToDo: for some freaking reason can't do 'extends SBEventTarget'
        _sb_assert(typeof channelServer === 'string', '[ChannelApi] Takes channel server URL as parameter')
        ChannelApi.defaultChannelServer = channelServer
        if (DBG0) console.warn(`==== CREATING ChannelApi object generation: ${ChannelApi.version} (${ChannelApi.defaultChannelServer}) ====`)
        if (typeof options === 'boolean') options = { DBG: options }
        // sets global setting for what network/fetch operation to use
        if (options && options.sbFetch) {
            console.log("++++ ChannelApi constructor: setting custom fetch function ++++" /*, options.sbFetch */)
            setSBFetch(options.sbFetch)
        }
        this.#channelServer = channelServer // conceptually, you can have multiple channel servers
        this.#storage = new StorageApi(channelServer)
    }

    /** Any operations that require a precise timestamp (such as messages) can use
        this, to assure both pacing, uniqueness, and monotonically increasing
        timestamps (on a per-Channel basis)
        */
    static async dateNow() {
        let timestamp = Date.now()
        if (timestamp <= ChannelApi.lastTimeStamp) {
            timestamp = ChannelApi.lastTimeStamp + 1
        }
        ChannelApi.lastTimeStamp = timestamp
        return timestamp
    }

    /**
     * Call when somethings been heard from any channel server; this is used to
     * track whether we are online or not.
     */
    static heardFromServer() {
        ChannelApi.#latestPing = Date.now()
        if (DBG0 || DBG2) console.log("[ChannelApi] heardFromServer() at", ChannelApi.#latestPing)
        switch (ChannelApi.onlineStatus) {
            case 'offline':
                if (DBG0) console.info(`[ChannelApi] [${ChannelApi.#latestPing}] we are now BACK online`)
                this.emit('online')
                this.emit('reconnected')
                ChannelApi.onlineStatus = 'online'
                break
            case 'online':
                // still online, unless socket count is zero
                if (DBG0 || DBG2) console.info("[ChannelApi] heardFromServer() we are still online")
                break
            case 'unknown':
                if (DBG0 || DBG2) console.info(`[ChannelApi] [${ChannelApi.#latestPing}] we are now ONLINE`)
                this.emit('online')
                ChannelApi.onlineStatus = 'online'
                break
        }
        this.checkUnknownNetworkStatus()
    }

    static checkUnknownNetworkStatus() {
        if (ChannelApi.#activeChannelSockets.size === 0) {
            if (ChannelApi.onlineStatus !== 'unknown')
                this.emit('unknownNetworkStatus')
            ChannelApi.onlineStatus = 'unknown'
        }
    }

    /**
     * Call when we haven't heard from any channel server for a while, and we
     * think we should have.
     */
    static haveNotHeardFromServer() {
        const timeNow = Date.now()
        if (timeNow - ChannelApi.#latestPing > WEBSOCKET_PING_INTERVAL * 1.5) {
            if (DBG0 || DBG2) console.warn("[ChannelApi] 'ping' message seems to have timed out")
            if (ChannelApi.onlineStatus === 'online') {
                if (ChannelApi.#activeChannelSockets.size > 0) {
                    if (DBG0) console.log(`[ChannelApi] [${timeNow}] OFFLINE`)
                    ChannelApi.onlineStatus = 'offline'
                    // this is the only spot in the code where we emit 'offline'
                    this.emit('offline')
                } else {
                    if (DBG0) console.warn("[ChannelApi] [${timeNow}] No active channel sockets, online status is now UNKNOWN")
                    ChannelApi.onlineStatus = 'unknown'
                    ChannelApi.onlineStatus = 'offline'
                    this.emit('unknownNetworkStatus')
                }
            }
        }
        this.checkUnknownNetworkStatus()
    }

    static addChannelSocket(socket: ChannelSocket) {
        if (DBG0) console.log("[ChannelApi] adding channel socket:", socket)
        ChannelApi.#activeChannelSockets.add(socket)
    }

    static removeChannelSocket(socket: ChannelSocket) {
        if (DBG0) console.log("[ChannelApi] removing channel socket:", socket)
        if (ChannelApi.#activeChannelSockets.has(socket))
            ChannelApi.#activeChannelSockets.delete(socket)
        this.checkUnknownNetworkStatus()
    }

    /**
     * "Anonymous" version of fetching a page, since unless it's locked you do not
     * need to be authenticated to fetch a page (or even know what channel it's
     * related to). This will return mime type and payload in 'convenient' format
     * (eg string, blob, ArrayBuffer, or for JSON is 'any').
     */
    async getPage(prefix: string): Promise<{ type: string, payload: any }> {
        if (DBG0) console.log(`==== ChannelApi.getPage: calling fetch with: ${prefix}`)
        // return extractPayload(await SBApiFetch(this.#channelServer + '/api/v2/page/' + prefix))
        const pageResponse = await SBFetch(this.#channelServer + '/api/v2/page/' + prefix)
        if (pageResponse.ok) {
            const pageType = pageResponse.headers.get('content-type')
            if (!pageType) throw new SBError(`[getPage] Failed to fetch page '${prefix}'`)
            let payLoad: any
            if (pageType.includes('application/json')) {
                payLoad = await pageResponse.json();
            } else if (pageType.includes('text/') || pageType.includes('xml') || pageType.includes('html')) {
                payLoad = await pageResponse.text();
            } else if (pageType.includes('multipart/form-data')) {
                throw new SBError(`[getPage] Multipart form data not supported`);
            } else if (pageType.match(/(image|audio|video)\//)) {
                payLoad = await pageResponse.blob();
            } else {
                payLoad = await pageResponse.arrayBuffer();
            }
            return { type: pageType, payload: payLoad }
        } else {
            throw new SBError(`[getPage] Failed to fetch page '${prefix}'`)
        }
    }

    // // deprecated ... used anywhere?
    // attach(handle: ChannelHandle): Promise<Channel> {
    //   return new Promise((resolve, reject) => {
    //     if (handle.channelId) {
    //       if (!handle.channelServer) {
    //         handle.channelServer = this.#channelServer
    //       } else if (handle.channelServer !== this.#channelServer) {
    //         reject('[attach] ChannelHandle channelId does not match channelServer')
    //       }
    //       resolve(new Channel(handle))
    //     } else {
    //       reject('ChannelHandle missing channelId')
    //     }
    //   })

    // }

    /**
     * Creates a new channel. Returns a promise to a @link(ChannelHandle} object.
     * Note that this method does not connect to the channel, it just creates
     * (authorizes) it and allocates storage budget.
     *
     * Note that if you have a full budget channel, you can budd off it (which
     * will take all the storage). Providing a budget channel here will allows you
     * to create new channels when a 'guest' on some other channel (for example),
     * or to create a new channel with a minimal budget.
     *
     * ChannelApi.create() returns a handle, whereas Channel.create() returns the
     * channel itself.
     */
    create(budgetChannel: Channel): Promise<ChannelHandle>
    create(storageToken: SBStorageToken): Promise<ChannelHandle>
    create(budgetChannelOrToken: Channel | SBStorageToken): Promise<ChannelHandle> {
        _sb_assert(budgetChannelOrToken !== null, '[create channel] Invalid parameter (null)')
        return new Promise<ChannelHandle>(async (resolve, reject) => {
            try {
                var _storageToken: SBStorageToken | undefined
                if (budgetChannelOrToken instanceof Channel) {
                    const budget = budgetChannelOrToken as Channel
                    await budget.ready // make sure it's ready
                    if (!budget.channelServer) budget.channelServer = this.#channelServer
                    _storageToken = await budget.getStorageToken(NEW_CHANNEL_MINIMUM_BUDGET)
                } else {
                    // try to read it as a storage token
                    try {
                        _storageToken = validate_SBStorageToken(budgetChannelOrToken as SBStorageToken)
                    } catch (e) {
                        reject('Invalid parameter to create() - need a token or a budget channel')
                        return
                    }
                }
                _sb_assert(_storageToken, '[create channel] Failed to get storage token for the provided channel')

                // create a fresh channel (set of keys)
                const channelKeys = await new Channel().ready
                channelKeys.channelServer = this.#channelServer
                // channelKeys.create(_storageToken!)
                //   .then((handle) => { resolve(handle) })
                //   .catch((e) => { reject(e) })
                channelKeys.create(_storageToken!)
                    .then((c) => { resolve(c.handle) })
                    .catch((e) => { reject(e) })
            } catch (e) {
                const msg = `Creating channel did not succeed: ${e}`; console.error(msg); reject(msg);
            }
        })
    }

    /**
     * Connects to a channel on this channel server. Returns a @link{Channel}
     * object unless you provide an onMessage handler, in which case it
     * returns a @link{ChannelSocket}.
     */
    connect(handleOrKey: ChannelHandle | SBUserPrivateKey): Channel
    connect(handleOrKey: ChannelHandle | SBUserPrivateKey, onMessage: (m: Message | string) => void): ChannelSocket
    connect(handleOrKey: ChannelHandle | SBUserPrivateKey, onMessage?: (m: Message | string) => void): Channel | ChannelSocket {
        let handle: ChannelHandle
        if (typeof handleOrKey === 'string') {
            handle = {
                userPrivateKey: handleOrKey as SBUserPrivateKey
            }
        } else {
            handle = handleOrKey as ChannelHandle
            if (!_check_ChannelHandle(handle))
                throw new SBError('[ChannelApi.connect] Invalid parameter (not a channel handle)')
        }
        _sb_assert(handle !== undefined && handle && handle.userPrivateKey, '[ChannelApi.connect] Invalid parameter (at least need owner private key)')
        if (handle.channelServer && handle.channelServer !== this.#channelServer)
            throw new SBError(`[ChannelApi.connect] channel server in handle ('${handle.channelServer}') does not match what SB was set up with ('${this.#channelServer}')`)
        if (!handle.channelServer) handle.channelServer = this.#channelServer
        if (DBG0) console.log("++++ ChannelApi.connect() ++++", handle)
        if (onMessage)
            return new ChannelSocket(handle, onMessage)
        else
            return new Channel(handle)
    }

    /**
     * Closes all active operations and connections, including any fetches
     * and websockets. This closes EVERYTHING (globally).
     */
    static async closeAll() {
        console.log(SEP, "==== ChannelApi.closeAll() called ====", SEP)
        if (ChannelApi.isShutdown) {
            console.warn("closeAll() called, but it was already shutting down")
            return; // only one instance of closeAll()
        }
        ChannelApi.isShutdown = true;
        abortActiveFetches()

        console.log("[ChannelApi] [closeAll] closing all active channel sockets:", ChannelApi.#activeChannelSockets)
        await Promise.all(Array.from(ChannelApi.#activeChannelSockets).map(close));

        // we block a fraction of a second here to give everything time to propagate
        console.log("[ChannelApi] [closeAll] ... waiting for everything to close ...")
        await new Promise(resolve => setTimeout(resolve, 75));
    }

    /**
     * Gets server information on provided server. Note, this will return 'undefined'
     * if the server is not reachable (it will not throw).
     */
    static async getServerInfo(): Promise<SBServerInfo | undefined>;
    static async getServerInfo(server: string): Promise<SBServerInfo | undefined>;
    static async getServerInfo(server?: string): Promise<SBServerInfo | undefined> {
        try {
            if (!server) {
                // Try to get the default channel server, or return undefined if not available
                try {
                    server = this.defaultChannelServer;
                } catch (e) {
                    console.warn("[getServerInfo] No server provided and no default server available")
                    return undefined;
                }
            }
            if (DBG0) console.log(SEP, `[getServerInfo] Fetching server info from '${server}'`, SEP)
            const r = await SBApiFetch(server + '/api/v2/info');
            if (r && r.maxMessageRequestSize)
                ChannelApi.MAX_MESSAGE_REQUEST_SIZE = r.maxMessageRequestSize
            if (DBG0) console.log(SEP, `[getServerInfo] Received: '${r}`, SEP)
            return r
        } catch (e) {
            if (DBG0) console.warn(`[getServerInfo] Could not access server '${server}'`)
            return undefined
        }
    }

    /*
     * Will cause 'debugger' to be called when the specified shard is ever fetched,
     * facilitating debugging.
     */
    static traceShard(id: string) {
        ChannelApi.shardBreakpoints.add(id)
    }

    /** Returns the storage API */
    @Memoize get storage() { return this.#storage; }

    /** Returns matching storage server */
    @Memoize async getStorageServer(): Promise<string> {
        return this.storage.getStorageServer()
    }

    /** Returns the crypto API */
    get crypto(): SBCrypto { return sbCrypto; }

    /** Returns version */
    get version(): string { return ChannelApi.version; }

} /* class ChannelApi */
