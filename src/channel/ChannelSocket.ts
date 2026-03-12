// (c) 2024 384 (tm)

import {
    SBUserPrivateKey,
    SEP, DBG2,
    extractPayload, assemblePayload,
} from 'src/common'

import { jsonOrString, jsonParseWrapper } from 'src/utils/json'
import { SBError, _sb_assert, _sb_exception } from 'src/utils/error'

const DBG0 = false;

import { ChannelMessage, validate_ChannelMessage } from './ChannelMessage'
import { ChannelApi } from './ChannelApi'
import { SBProtocol } from './Protocol'
import { ChannelHandle, validate_ChannelHandle, _check_ChannelHandle } from './ChannelHandle'
import { Message, MessageOptions } from 'src/channel/Message'
import { Channel } from './Channel'

import { arrayBufferToBase62 } from 'src/utils/b62';
import { arrayBufferToBase64url } from 'src/utils/b64';

import {
    WEBSOCKET_MESSAGE_TIMEOUT,
    WEBSOCKET_SETUP_TIMEOUT,
    WEBSOCKET_PING_INTERVAL,
    WEBSOCKET_RETRY_COUNT,
} from './config'

import { _check_SBChannelData } from './Channel'


interface WSProtocolOptions {
    version?: number,
    url: string, // not the user (client) url, but where the socket is
    websocket?: WebSocket, // will have a value if we've connected
    onOpen?: null | CallableFunction,
    ready: boolean,
    // onMessage?: null | CallableFunction,
    onClose?: null | CallableFunction,
    onError?: null | CallableFunction,
    timeout?: number,
    closed: boolean,
}


async function closeSocket(socket: WebSocket) {
    console.log("[closeSocket] closing socket", socket)
    if (socket.readyState !== WebSocket.CLOSED)
      await new Promise<void>((resolve) => {
        socket.addEventListener('close', () => {
          console.log("[ChannelApi.closeSocket] ... socket confirmed closed", socket)
          resolve();
        }, { once: true });
        socket.close(1000); // not allowed to say '1001'
      });
    else {
      console.warn('[ChannelApi] websocket already closed')
    }
  }
  
  

/**
   * ChannelSocket extends Channel. Has same basic functionality as Channel, but
   * is synchronous and uses websockets, eg lower latency and higher throughput.
   *
   * You send by calling channel.send(msg: SBMessage | string), i.e. you can
   * send a quick string.
   *
   * You can set your message handler upon creation, or later by using
   * channel.onMessage = (m: Message) => { ... }.
   *
   * You don't need to worry about managing resources, like closing it, or
   * checking if it's open. It will close based on server behavior, eg it's up
   * to the server to close the connection based on inactivity. The
   * ChannelSocket will re-open if you try to send against a closed connection.
   *
   * Messages are delivered as type Message if it could be parsed and decrypted;
   * it can also be a string (typically if a low-level server message, in which
   * case it will just be forwarded to the message handler).
   *
   * It also handles a simple ack/nack mechanism with the server transparently.
   *
   * Be aware that if ChannelSocket doesn't know how to handle a certain
   * message, it will generally drop it. 
   *
 */
export class ChannelSocket extends Channel {
    channelSocketReady: Promise<ChannelSocket>
    static ReadyFlag = Symbol('ChannelSocketReadyFlag'); // see below for '(this as any)[ChannelSocket.ReadyFlag] = false;'

    // #myChannelSocketID = Symbol()

    #ws?: WSProtocolOptions
    #socketServer: string

    onMessage = (_m: Message | string): void => { _sb_assert(false, "[ChannelSocket] NO MESSAGE HANDLER"); }
    #ack: Map<string, (value: string | PromiseLike<string>) => void> = new Map()
    #ackTimer: Map<string, number> = new Map()
    #traceSocket: boolean = false // should not be true in production

    // set of messages that have been forwarded to the message handler
    #forwardedMessages: Set<string> = new Set()
    #MAX_DUPLICATE_WINDOW = 2000; // max count of messages we look for duplicates in

    // last timestamp we've seen
    lastTimestampPrefix: string = '0'.repeat(26);
    #pingInterval: number = 0;

    #errorPromise?: Promise<ChannelSocket>;
    #rejectError?: (reason?: any) => void;

    constructor(
        handleOrKey: ChannelHandle | SBUserPrivateKey,
        onMessage: (m: Message | string) => void,
        protocol?: SBProtocol
    ) {
        _sb_assert(onMessage, '[ChannelSocket] constructor: no onMessage handler provided')

        if (typeof handleOrKey === 'string') {
            super(handleOrKey as SBUserPrivateKey, protocol) // we let super deal with it
        } else {
            const handle = validate_ChannelHandle(handleOrKey)
            super(handle, protocol)
            if (handle.channelServer)
                this.channelServer = handle.channelServer // handle choice will override
        }

        // if (!this.channelServer) this.channelServer = ChannelApi.defaultChannelServer
        // if we don't have this explicitly by now, throw
        if (!this.channelServer) throw new SBError("ChannelSocket: no channel server provided")

        ; (this as any)[ChannelSocket.ReadyFlag] = false;
        this.#socketServer = this.channelServer.replace(/^http/, 'ws')
        this.onMessage = onMessage
        this.channelSocketReady = this.#channelSocketReadyFactory()
    }

    #setupPing() {
        if (DBG0) console.log(SEP, "[ChannelSocket] Setting up 'ping' messages ... ", SEP)

        // we regularly check how long it's been since we heard from the server;
        // every channelsocket does this
        this.#pingInterval = setInterval(() => {
            if (this.closingDown) {
                console.error("[ChannelSocket] we are closed, removing ping interval")
                clearInterval(this.#pingInterval)
                return // close down quietly
            }
            ChannelApi.haveNotHeardFromServer()
        }, WEBSOCKET_PING_INTERVAL * 0.5);

        // and we fire off the first one
        if (this.#ws && this.#ws.websocket && this.#ws.websocket.readyState === 1) {
            if (DBG0) console.log(SEP, "[ChannelSocket] Sending first 'ping' (timestamp request) message.", SEP)
            try {
                this.#ws.websocket.send('ping')
            } catch (e) {
                console.error("[ChannelSocket] Failed to send first (hibernation) 'ping' message, Internal Error [L3986]")
            }
        } else {
            console.error("[ChannelSocket] websocket not ready (?), not sending first 'ping', hibernation disabled")
        }

        // const pingTimer = setInterval(() => {
        //   if (this.isClosed) return // close down quietly
        //   if (DBG2) console.log(SEP, "[ChannelSocket] Sending 'ping' (timestamp request) message.", SEP)
        //   try {
        //     this.#ws!.websocket!.send('ping')
        //     // set a timer that is 0.8 * the interval, to time out if this doesn't respond
        //     setTimeout(() => {
        //       if (this.isClosed) return // close down quietly
        //       if (DBG0) console.warn("[ChannelSocket] 'ping' message timed out")
        //       this.errorState = true;
        //     }, interval * 0.8);
        //   } catch (e) {
        //     if (this.isClosed) {
        //       if (DBG2) console.log("[ChannelSocket] we are closed, removing interval")
        //       clearInterval(pingTimer)
        //     } else {
        //       if (DBG0) console.warn("[ChannelStream.startSocket] Failed to send 'ping' message:", e)
        //       this.errorState = true;
        //     }
        //   }
        // }, interval);
    }

    async #tryReconnect() {
        if (DBG0) console.log(SEP, "[ChannelSocket] Trying to re-establish connection ...", SEP)
        // first we wait a little bit, then a quick retry
        await new Promise((resolve) => setTimeout(resolve, 75))
        this.channelSocketReady = this
            .#channelSocketReadyFactory()
            .catch((e) => {
                console.error(SEP, "[ChannelSocket] Could not re-establish connection, should queue up\n", e, SEP);
                return this
            });

    }

    // if we lose the channel, we decide what to do here; only called if we at some point were
    // 'ready' (connected) and then later disconnected for any reason (other than explicit 'close()')
    // ToDo: check if explicit close propagates properly to things like online status?
    async #handleDisconnect(reason: string) {
        console.warn(`[ChannelSocket] Lost connection to server, will try to reset.\nReason (if any): '${reason}'`);
        (this as any)[ChannelSocket.ReadyFlag] = false;
        ChannelApi.removeChannelSocket(this)
        ChannelApi.on('online', this.#tryReconnect)
    }

    #channelSocketReadyFactory() {
        this.#errorPromise = new Promise<ChannelSocket>((_, reject) => {
            if (DBG2) console.log("Error promise initialized")
            this.#rejectError = reject;
        });
        const returnPromise = Promise.race([
            this.#errorPromise,
            new Promise<ChannelSocket>(async (resolve, _) => {
                if (DBG0) console.log("++++ STARTED ChannelSocket.readyPromise()")
                await this.sbChannelKeysReady // because we need the getter for channelId
                const url = this.#socketServer + '/api/v2/channel/' + this.channelId + '/websocket'
                this.#ws = {
                    url: url,
                    ready: false,
                    closed: false,
                    timeout: WEBSOCKET_MESSAGE_TIMEOUT
                }
                if (!this.#ws.websocket || this.#ws.websocket.readyState === 3 || this.#ws.websocket.readyState === 2) {
                    // either it's new, or it's closed, or it's in the process of closing
                    if (this.#ws.websocket) {
                        console.warn("[ChannelSocket] websocket is in a bad state, closing it ... will await")
                        await closeSocket(this.#ws.websocket)
                        ChannelApi.addChannelSocket(this)
                    }
                    // a WebSocket connection is always a 'GET', and there's no way to provide a body
                    const apiBodyBuf = assemblePayload(await this.buildApiBody(url))
                    _sb_assert(apiBodyBuf, "Internal Error [L3598]")
                    try {
                        // here's the only spot in the code where we actually open a websocket:
                        this.#ws.websocket = new WebSocket(url + "?apiBody=" + arrayBufferToBase62(apiBodyBuf!))
                        ChannelApi.addChannelSocket(this)
                    } catch (e) {
                        const msg = "[ChannelSocket] Could not open websocket: " + e
                        if (DBG0) console.error(msg)
                        this.#rejectError!(msg)
                        return // don't do anything else
                    }
                }

                if (DBG0) console.log(SEP, "++++ readyPromise() - setting up websocket message listener", SEP);

                const thisWsWebsocket = this.#ws.websocket
                const initialListener = async (e: MessageEvent<any>) => {
                    if (!e.data) {
                        const msg = "[ChannelSocket] received empty message (should be a 'ready' message)";
                        console.error(msg);
                        this.#rejectError!(msg)
                    }
                    let serverReadyMessage: { ready: boolean, messageCount: number, latestTimestamp: string } | null = null

                    if (typeof e.data === 'string') {
                        serverReadyMessage = jsonParseWrapper(e.data, "L3909")
                        // const json = jsonParseWrapper(e.data, "L3909")
                        // if (json && json.hasOwnProperty('ready')) {
                        //   if (DBG0) console.log("++++ readyPromise() - received ready message, switching to main message processor:\n", e.data)
                        //   if (json.hasOwnProperty('latestTimestamp')) {
                        //     this.lastTimestampPrefix = json.latestTimestamp
                        //     if (DBG2) console.log("++++ readyPromise() - received latestTimestamp:", this.lastTimestampPrefix)
                        //   } else console.warn("[ChannelSocket] received 'ready' message without 'latestTimestamp'")
                        //   thisWsWebsocket.removeEventListener('message', initialListener);
                        //   thisWsWebsocket.addEventListener('message', this.#processMessage);
                        //   this.#setupPing();
                        //   (this as any)[ChannelSocket.ReadyFlag] = true;
                        //   resolve(this);
                        // } else {
                        //   reject("[ChannelSocket] received something other than 'ready' as first message:\n" + JSON.stringify(e.data));
                        // }
                    } else if (e.data instanceof ArrayBuffer) {
                        serverReadyMessage = extractPayload(e.data).payload
                    } else if (e.data instanceof Blob) {
                        serverReadyMessage = extractPayload(await e.data.arrayBuffer()).payload
                    } else {
                        _sb_exception("L3987", "[ChannelSocket] received something other than string or ArrayBuffer")
                    }
                    if (serverReadyMessage) {
                        if (serverReadyMessage.ready) {
                            if (DBG0) console.log("++++ readyPromise() - received ready message, switching to main message processor:\n", serverReadyMessage)
                            if (serverReadyMessage.latestTimestamp) {
                                this.lastTimestampPrefix = serverReadyMessage.latestTimestamp
                                if (DBG2) console.log("++++ readyPromise() - received latestTimestamp:", this.lastTimestampPrefix)
                            } else console.warn("[ChannelSocket] received 'ready' message without 'latestTimestamp'")
                            thisWsWebsocket.removeEventListener('message', initialListener);
                            thisWsWebsocket.addEventListener('message', this.#processMessage);
                            this.#setupPing();
                            (this as any)[ChannelSocket.ReadyFlag] = true;
                            resolve(this);
                        } else {
                            const msg = "[ChannelSocket] received something other than 'ready' as first message:\n" + JSON.stringify(e.data);
                            if ((this as any)[ChannelSocket.ReadyFlag] === true) console.warn(msg);
                            else this.#rejectError!(msg);
                        }
                    } else {
                        const msg = "[ChannelSocket] received empty message, or could not parse it (should be a 'ready' message)"
                        if ((this as any)[ChannelSocket.ReadyFlag] === true) console.warn(msg);
                        else this.#rejectError!(msg);
                    }
                };

                this.#ws.websocket.addEventListener('message', initialListener);

                // if (DBG0) console.log(SEP,"++++ readyPromise() - setting up websocket message listener", SEP)
                // this.#ws.websocket.addEventListener('message',
                //   (e: MessageEvent<any>) => {
                //     if (e.data && typeof e.data === 'string' && jsonParseWrapper(e.data, "L3618")?.hasOwnProperty('ready')) {
                //       // switch to main message processor
                //       this.#ws!.websocket!.addEventListener('message', this.#processMessage)
                //       // we're ready
                //       if (DBG0) console.log(SEP, "Received ready", SEP)
                //       ; (this as any)[ChannelSocket.ReadyFlag] = true;
                //       resolve(this)
                //     } else {
                //       if (DBG0) console.log(SEP, "Received non-ready:\n", e.data, "\n", SEP)
                //       reject("[ChannelSocket] received something other than 'ready' as first message")
                //     }
                //   }
                // )

                // let us set a timeout to catch and make sure this thing resoles within a certain time limit
                let resolveTimeout: number | undefined = setTimeout(() => {
                    if (!(this as any)[ChannelSocket.ReadyFlag]) {
                        const msg = "[ChannelSocket] Socket not resolving after waiting, fatal."
                        console.warn(msg);
                        this.#rejectError!(msg)
                    } else {
                        if (DBG2) console.log("[ChannelSocket] resolved correctly", this)
                    }
                }, WEBSOCKET_SETUP_TIMEOUT);

                this.#ws.websocket.addEventListener('open', async () => {
                    this.#ws!.closed = false
                    if (resolveTimeout) { clearTimeout(resolveTimeout); resolveTimeout = undefined; }
                    // need to make sure parent is ready (and has keys)
                    await this.ready
                    if (DBG0) console.log("++++++++ readyPromise() sending init")
                    // auth is done on setup, it's not needed for the 'ready' signal
                    // this.#ws!.websocket!.send(assemblePayload({ ready: true })!)
                    this.#ws!.websocket!.send('ready')
                    if (DBG0) console.log("++++++++ readyPromise() ... no immediate errors for init")
                });

                this.#ws.websocket.addEventListener('close', (e: CloseEvent) => {
                    this.#ws!.closed = true
                    if (this.closingDown) {
                        if (DBG0) console.log(`[ChannelSocket] Closing  down.`)
                    } else {
                        if (e.wasClean) {
                            if (e.reason.includes("does not have an owner")) {
                                const msg = `[ChannelSocket] No such channel on this server (${this.channelServer})`
                                if ((this as any)[ChannelSocket.ReadyFlag] === true)
                                    throw new SBError(msg + ' plus we are ready? (L4130)')
                                this.#rejectError!(msg)
                            } else {
                                console.log(`[ChannelSocket] Closed (cleanly).\nReason (if any): '${e.reason}'.`)
                            }
                        } else {
                            console.warn(`[ChannelSocket] Closed (but not cleanly) [L4137]\nReason (if any): '${e.reason}'. Server: '${this.channelServer}'`)
                        }
                        if ((this as any)[ChannelSocket.ReadyFlag] === true) {
                            this.#handleDisconnect("Channel was ready, but reporting being closed [L4140]")
                        } else {
                            const msg = "[ChannelSocket] Closed before ready (?) [L4142]"
                            console.error(msg)
                            this.#rejectError!(msg)
                        }
                    }
                });

                this.#ws.websocket.addEventListener('error', (e) => {
                    this.#ws!.closed = true
                    if (this.closingDown) {
                        if (DBG0) console.log(`[ChannelSocket] Closing down.`)
                    } else {
                        if ((this as any)[ChannelSocket.ReadyFlag] === true) {
                            // this.#handleDisconnect("Error on trying to open socket [L4152]")
                            const msg = "[ChannelSocket] Socket closed [L4152]\nEvent message (if any): '" + (e as any).message + "'";
                            console.error(msg)
                            this.#rejectError!(msg)
                        } else {
                            const msg = `[ChannelSocket] Failed to connect, or errored out immediately [L4153].\nError (if any): '${e}'`
                            console.error(msg)
                            this.#rejectError!(msg)
                        }
                    }
                });
            })
        ]);
        if (DBG2) console.log("Socket ready factory done, error promise:", this.#rejectError)
        return returnPromise
        // this.#errorPromise.catch((e) => {
        //   console.log(SEP, "[ChannelSocket] Error in setup:", e, SEP)
        //   this.#handleDisconnect("Error in setup [L4162]: " + e)
        // })
    }

    // all messages (that eventually get to an onMessage() handler) pass through here
    #processMessage = async (e: MessageEvent<any>) => {
        _sb_assert(!this.errorState, "[ChannelSocket] in error state (Internal Error L4018)")
        const msg = e.data
        if (DBG2) console.log(SEP, "[ChannelSocket] Received socket message:\n", msg, SEP)
        var message: ChannelMessage | null = null
        _sb_assert(msg, "[ChannelSocket] received empty message")
        ChannelApi.heardFromServer(); // do this on every message to track online status

        // string [0-3]* are magical, they imply a 'latest' time stamp prefix from server
        if (typeof msg === 'string' && Channel.timestampRegex.test(msg)) {
            if (DBG2) console.log("[ChannelSocket] Received 'latestTimestamp' message:", msg)
            ChannelApi.heardFromServer()
            if (msg > this.lastTimestampPrefix) {
                // if this is *newer* than we were last at, we ping back *our* latest
                // string; if everything after that is still buffered by the server, it'll
                // respond with them, otherwise the server will close the websocket
                if (DBG0) console.log(SEP, "[ChannelSocket] Received newer timestamp, will request those messages", SEP)
                this.#ws!.websocket!.send(this.lastTimestampPrefix)
            }
            // we only have one 'ping' outstanding at a time
            setTimeout(() => {
                if (this.#ws && !this.#ws.closed && this.#ws.websocket?.readyState === 1) {
                    if (DBG2) console.log("[ChannelSocket] Sending 'ping' (timestamp request) message.")
                    try {
                        this.#ws!.websocket!.send('ping')
                    } catch (_e) {
                        if (DBG0) console.warn("[ChannelSocket] Failed to send 'ping' message, ignoring");
                    }
                } else if (DBG0) console.log("[ChannelSocket] Shutting down ping message timeout")
            }, WEBSOCKET_PING_INTERVAL)
            // these messages are absorbed
            return;
        }

        if (typeof msg === 'string') {
            // could be a simple JSON message, or a low-level server message (eg just a string)
            const _message: any = jsonOrString(msg)
            if (!_message) _sb_exception("L3287", "[ChannelSocket] Cannot parse message: " + msg)
            else {
                // currently, a timestamp is the only 'pure' string that should arrive
                if (DBG0) console.log("[ChannelSocket] Received unrecognized 'string' message, will discard:\n", _message)
                this.#ws!.websocket!.send(assemblePayload({ error: `Cannot parse 'string' message (''${_message})` })!);
                return;
            }
        } else if (msg instanceof ArrayBuffer) {
            message = extractPayload(msg).payload
        } else if (msg instanceof Blob) {
            message = extractPayload(await msg.arrayBuffer()).payload
        } else {
            this.#ws!.websocket!.send(assemblePayload({ error: `Received unknown 'type' of message (??)` })!);
            return;
        }
        _sb_assert(message, "[ChannelSocket] cannot extract message")

        // we catch server-specific messages here, and then pass the rest to the user
        if (message!.ready) {
            if (DBG0) console.log("++++++++ #processMessage: received ready message\n", message)
            return
        }
        if (message!.error) {
            // ToDo: some error messages need to propagate to the attempted send operation, such as out of budget
            console.error("++++++++ #processMessage: received error message:\n", message!.error)
            return
        }

        message = validate_ChannelMessage(message!) // throws if there's an issue
        if (DBG2) console.log(SEP, "[ChannelSocket] Received (extracted/validated) socket message:\n", message, "\n", SEP)

        if (!message.channelId) message.channelId = this.channelId
        _sb_assert(message.channelId === this.channelId, "[ChannelSocket] received message for wrong channel?")

        if (this.#traceSocket) console.log("[ChannelSocket] Received socket message:", message)

        _sb_assert(message.sts, "[ChannelSocket] Message missing server timestamp Internal Error (L4145)")
        this.lastTimestampPrefix = ChannelSocket.timestampToBase4String(message!.sts!)!
        if (DBG0) console.log("[ChannelSocket] Updated 'latestTimestamp' to:", this.lastTimestampPrefix)

        // if (!message._id)
        //   message._id = composeMessageKey(message.channelId!, message.sts!, message.i2)

        // check if this message is one that we've recently sent (track 'ack'), based on contents
        _sb_assert(message.c && message.c instanceof ArrayBuffer, "[ChannelSocket] Internal Error (L3675)")
        const hash = await crypto.subtle.digest('SHA-256', message.c! as ArrayBuffer)
        const ack_id = arrayBufferToBase64url(hash)

        // ToDo: track (chain) hashes of previous messages from same sender;
        // similarly, or perhaps that's superflous, track and verify time stamps
        // also, bootstrap upon a reconnect what latest message hash was

        if (this.previous) message.p = this.previous
        this.previous = ack_id
        if (DBG0) console.log("[ChannelSocket] Received message with hash:", ack_id)
        const r = this.#ack.get(ack_id)
        if (r) {
            if (DBG0 || this.#traceSocket) console.log(`++++++++ #processMessage: found matching ack for id ${ack_id}`)
            this.#ack.delete(ack_id)
            r("success") // we first resolve that outstanding send (and then also deliver message)
        }
        const t = this.#ackTimer.get(ack_id)
        if (t) {
            if (DBG2 || this.#traceSocket) console.log(`++++++++ #processMessage: clearing matching ack timeout for id ${ack_id}`)
            clearTimeout(t)
            this.#ackTimer.delete(ack_id)
        }

        if (DBG2) console.log("[ChannelSocket] New message, client and server time stamp: ", message.sts)
        const m = await this.extractMessage(message)

        if (m) {
            if (!m._id) throw new SBError("[ChannelSocket] Internal Error (L522)")
            if (this.#forwardedMessages.has(m._id)) {
                console.warn("[ChannelSocket] **** WARNING: Message already forwarded, will not deliver")
            } else {
                while (this.#forwardedMessages.size > this.#MAX_DUPLICATE_WINDOW) {
                    // being a bit conservative on state here
                    const firstValue = this.#forwardedMessages.values().next().value!;
                    this.#forwardedMessages.delete(firstValue);
                }                  
                this.#forwardedMessages.add(m._id)
                if (DBG0) console.log("[ChannelSocket] Repackaged and will deliver 'Message':", m)
                // call user-provided message handler. this is the only spot in ChannelSocket.ts that does this
                this.onMessage(m)
            }
        } else {
            if (DBG0) console.log("[ChannelSocket] Message could not be parsed, will not deliver")
        }
    }

    get ready() {
        _sb_assert(!this.errorState, "[ChannelSocket] in error state (Internal Error L4104)")
        _sb_assert(!this.closingDown, "[ChannelSocket] We are closed, blocking on'ready' will reject")
        return this.channelSocketReady
    }

    get errorPromise() {
        if (!this.#errorPromise) throw new SBError("[ChannelSocket] errorPromise called before ready")
        return this.#errorPromise
    }

    // get readyFlag(): boolean { return this.#ChannelSocketReadyFlag }
    get ChannelSocketReadyFlag(): boolean { return (this as any)[ChannelSocket.ReadyFlag] }

    get status() {
        if (!this.#ws || !this.#ws.websocket) return 'CLOSED'
        else switch (this.#ws.websocket.readyState) {
            case 0: return 'CONNECTING'
            case 1: return 'OPEN'
            case 2: return 'CLOSING'
            default: return 'CLOSED'
        }
    }

    /** Enables debug output */
    set enableTrace(b: boolean) {
        this.#traceSocket = b;
        if (b) console.log("==== ChannelSocket: Tracing enabled ====")
    }

    // actually send the message on the socket; returns a description of the outcome
    #_send(msg: ChannelMessage) {
        _sb_assert(!this.errorState, "[ChannelSocket] in error state (Internal Error L4130)")
        if (DBG2) console.log("[ChannelSocket] #_send() called")
        return new Promise(async (resolve, reject) => {
            if (DBG2) console.log(SEP, "++++++++ [ChannelSocket.#_send()] called, will return promise to send:", msg.unencryptedContents, SEP)
            if (this.#ws!.closed) {
                if (DBG2) console.error("[ChannelSocket] #_send() to a CLOSED socket")
                reject('<websocket closed>'); return;
            }
            if (msg.stringMessage === true) {
                try {
                    // 'string' messages are not tracked with an 'ack'; that
                    // would need to be done at another location of whatever protocol the
                    // message corresponds to.
                    const contents = msg.unencryptedContents
                    if (DBG2) console.log("[ChannelSocket] actually sending string message:", contents)
                    this.#ws!.websocket!.send(contents)
                    resolve("success")
                } catch (e) {
                    reject(`<websocket error upon send() of a string message: ${e}>`); return;
                }
            } else {
                // if it's not simple, then it's more complicated
                msg = await this.finalizeMessage(msg)
                const messagePayload = assemblePayload(msg)
                if (!messagePayload) {
                    reject("ChannelSocket.send(): no message payload (Internal Error)"); return;
                }

                // we keep track of a hash of things to manage 'ack'
                const hash = await crypto.subtle.digest('SHA-256', msg.c! as ArrayBuffer)
                const messageHash = arrayBufferToBase64url(hash)
                if (DBG2 || this.#traceSocket)
                    console.log("++++++++ ChannelSocket.send(): Which has hash:", messageHash)
                this.#ack.set(messageHash, resolve)
                this.#ackTimer.set(messageHash, setTimeout(async () => {
                    if (this.#ack.has(messageHash)) {
                        this.#ack.delete(messageHash)
                        if (ChannelApi.isShutdown) { reject("shutDown"); return; } // if we're shutting things down, we're done
                        if (DBG0) console.error(`[ChannelSocket] websocket request timed out (no ack) after ${this.#ws!.timeout}ms (${messageHash})`)
                        // update: no we don't reset at low levels, turns out to confuse responsibilities
                        // this.reset() // for timeouts, we try to reset the socket
                        // await this.ready // wait for it to start up again
                        // if (DBG0)  console.error(`[ChannelSocket] ... channel socket should be ready again`);
                        reject(`<websocket request timed out (no ack) after ${this.#ws!.timeout}ms (${messageHash})>`);
                        return;
                    } else {
                        // ChannelSocket resolves on seeing message return
                        if (DBG0 || this.#traceSocket) console.log("++++++++ ChannelSocket.send() completed sending")
                        resolve("<received ACK, success, message sent and mirrored back>")
                    }
                }, this.#ws!.timeout))
                if (DBG2) console.log("[ChannelSocket] actually sending message:", messagePayload)
                try {
                    // THIS IS WHERE we actually send an SBMessage payload ...
                    if (DBG2) console.log("[ChannelSocket] actually sending message:", messagePayload)
                    this.#ws!.websocket!.send(messagePayload!)
                } catch (e) {
                    // print out stack at this time
                    console.error("Failed to send on socket:\n", e, '\n', new Error().stack)
                    reject(`<websocket error upon send() of a message: ${e}>`); return;
                }
            }
        });
    }

    /**
      * ChannelSocket.send()
      *
      * Returns a promise that resolves to "success" when sent,
      * or an error message if it fails.
      */
    async send(contents: any, options?: MessageOptions): Promise<string> {
        if (DBG2) console.log("++++ ChannelSocket.send() called ...")
        await this.ready
        _sb_assert(this.#ws && this.#ws.websocket, "[ChannelSocket.send()] called before ready")
        if (DBG2) console.log(SEP, "[ChannelSocket] sending, contents:\n", JSON.stringify(contents), SEP)
        if (this.#ws!.closed) {
            console.info("send() triggered reset of #readyPromise() (normal)")
            this.channelSocketReady = this.#channelSocketReadyFactory()
                // this.#ChannelSocketReadyFlag = true
                ; (this as any)[ChannelSocket.ReadyFlag] = false;
        }
        return new Promise(async (resolve, reject) => {
            if (!this.ChannelSocketReadyFlag) reject("ChannelSocket.send() is NOT ready, perhaps it's resetting?")
            const readyState = this.#ws!.websocket!.readyState
            switch (readyState) {
                case 1: // OPEN
                    // if (this.#traceSocket)
                    //   console.log("++++++++ ChannelSocket.send() will send message:", Object.assign({}, sbm.message))
                    // let messagePayload: ArrayBuffer | string | null = null
                    // if (options?.sendString === true) {
                    //   messagePayload = sbm.message as string
                    // } else {
                    //   const msg = sbm.message as ChannelMessage
                    //   messagePayload = assemblePayload(msg)
                    //   _sb_assert(messagePayload, "ChannelSocket.send(): failed to assemble message")
                    //   // we keep track of a hash of things we've sent so we can track when we see them
                    //   // todo: 'hash' should probably be an sbm property
                    //   const hash = await crypto.subtle.digest('SHA-256', msg.c!)
                    //   const messageHash = arrayBufferToBase64url(hash)
                    //   if (DBG0 || this.#traceSocket)
                    //     console.log("++++++++ ChannelSocket.send(): Which has hash:", messageHash)
                    //   this.#ack.set(messageHash, resolve)
                    //   this.#ackTimer.set(messageHash, setTimeout(() => {
                    //     // we could just resolve on message return, but we want to print out error message
                    //     if (this.#ack.has(messageHash)) {
                    //       this.#ack.delete(messageHash)
                    //       if (ChannelApi.isShutdown) { reject("shutDown"); return; } // we don't want to print this out if we're shutting down
                    //       const msg = `Websocket request timed out (no ack) after ${this.#ws!.timeout}ms (${messageHash})`
                    //       console.error(msg)
                    //       reject(msg)
                    //     } else {
                    //       // normal behavior
                    //       if (this.#traceSocket) console.log("++++++++ ChannelSocket.send() completed sending")
                    //       resolve("success")
                    //     }
                    //   }, this.#ws!.timeout))
                    // }

                    // console.log("[ChannelSocket.send()] enqueueing message: ", contents)
                    // console.log("TTL at point of channel socket send() is: ", options?.ttl)
                    this.sendQueue.enqueue({
                        msg: this.packageMessage(contents, options),
                        resolve: resolve,
                        reject: reject,
                        _send: this.#_send.bind(this),
                        retryCount: WEBSOCKET_RETRY_COUNT
                    })

                    // // THIS IS WHERE we actually send the payload ...
                    // if (!messagePayload) reject("ChannelSocket.send(): no message payload (Internal Error)")
                    // else this.#ws!.websocket!.send(messagePayload)

                    break
                case 0: // CONNECTING
                case 2: // CLOSING
                case 3: // CLOSED
                    const errMsg = `[ChannelSocket.send()] Tried sending but socket not OPEN - it is ${readyState === 0 ? 'CONNECTING' : readyState === 2 ? 'CLOSING' : 'CLOSED'}`
                    // _sb_exception('ChannelSocket', errMsg)
                    reject(errMsg)
                    break
                default:
                    _sb_exception('ChannelSocket', `socket in unknown state (${readyState})`)
            }
        })
    }

    /**
     * This is either called when you're done, or is called internally
     * during various restart/reconnect scenarios.
     */
    async close() {
        if (DBG0) console.log("++++ ChannelSocket.close() called ... closing down stuff ...")
        this.closingDown = true;
        clearInterval(this.#pingInterval);
        if (this.#ws && this.#ws.websocket) {
            // this.#ws.websocket.send('close') // will try to rely on protocol instead
            if (this.#ws.websocket.readyState === 1) {
                if (DBG0) console.log(SEP, "[ChannelSocket] Closing websocket, with readystate:", this.#ws.websocket.readyState, SEP)
                this.#ws.websocket.close()
                // debugging Deno? ... wait a moment here
                await new Promise((resolve) => setTimeout(resolve, 75))
            }
            this.#ws.closed = true
        }
        // close and drain the sendQueue; any messages in flight will be rejected
        // todo: strictly speaking, if we're in a retry situation, we can still handle them
        const queueDrain = super.close()

        // tell SB that we are no longer connected
        ChannelApi.removeChannelSocket(this)

            // set ready to permanently reject
            ; (this as any)[ChannelSocket.ReadyFlag] = false;

        // we would like to throw if anybody anywhere tries to await on our 'ready':
        // this.channelSocketReady = Promise.reject("[ChannelSocket] This channel socket has been closed (by client request)")
        // but this doesn't work well because of JS limitations in tracking stacks. instead we in effect have a different
        // state: 'isClosed' can be true, while the ChannelSocket is still 'ready'.

        return queueDrain; // in case caller wants to await
    }

    /**
     * Reconnects (resets) a ChannelSocket. This will not block (it's
     * synchronous), and 'ready' will resolve when the socket is ready again.
     */
    reset() {
        if (DBG0) console.trace("++++ ChannelSocket.reset() called ... for ChannelID:", this.channelId)
        if (this.#ws && this.#ws.websocket) {
            if (this.#ws.websocket.readyState === 1) {
                if (DBG0) console.log("[ChannelSocket] Closing websocket, with readystate:", this.#ws.websocket.readyState)
                this.#ws.websocket.close()
            }
            this.#ws.closed = true;
            (this as any)[ChannelSocket.ReadyFlag] = false;
            // we also delete the old entry on the active sockets list
            ChannelApi.removeChannelSocket(this)
            // and reset our readiness
            this.channelSocketReady = this.#channelSocketReadyFactory()
        }
    }


    // /** @type {JsonWebKey} */ @Memoize @Ready get exportable_owner_pubKey() { return this.keys.ownerKey }

} /* class ChannelSocket */
