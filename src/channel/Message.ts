// (c) 2023-2024 384 (tm)

import {
    _sb_assert, ChannelId, SBUserId,
    SBUserPublicKey, SBError,
} from 'src/common'

const DBG0 = false;

import { SBProtocol } from './Protocol'

/**
 * Options for sending a message.
 * @public
 */
export interface MessageOptions {
  /** Time to live, see MessageTtl enum for how it translates to time. */
  ttl?: MessageTtl,
  /** Routed message (named recipient). Will be SBUserId but for convenience internally will convert from SBUserPublicKey. */
  sendTo?: SBUserId | SBUserPublicKey,
  /** 'i2' in ChannelMessage (Owner only) */
  subChannel?: string,
  protocol?: SBProtocol,
  /** if true, just send the string, no other processing */
  sendString?: boolean,
  /** Internal. Optional override of defaults (0 for no retries) */
  retries?: number,
}


/**
     Index/number of seconds/string description of TTL values (0-15) for
     messages and shards.

     ```text
         #    Seconds  Description
         0          0  Ephemeral (not stored)
         1             <reserved>
         2             <reserved>
         3         60  One minute (current minimum)
         4        300  Five minutes
         5       1800  Thirty minutes
         6      14400  Four hours
         7     129600  36 hours
         8     864000  Ten days
        10             <reserved> (all 'reserved' future choices will be monotonically increasing)
        11             <reserved>
        12             <reserved>
        13             <reserved>
        14             <reserved>
        15   Infinity  Permastore, this is the default.
      ```

      Note that time periods above '8' (10 days) is largely TBD pending
      finalization of what the storage server will prefer. As far as messages
      are concerned, anything above '8' is 'very long'.

      A few rules around messages and TTL (this list is not exhaustive):

      - Currently only values 0, 3-8, and 15 are valid (15 is default).
      - Routable messages (eg messages with a 'to' field) may not have ttl above '8'.
      - TTL messages are never in storage shards; channel servers can chose to
        limit how many they will keep (on a per TTL category basis) regardless
        of time value (but at least last 1000).
      - TTL messages are duplicated and available on 'main' channel ('i2')
        '____' as well as on subchannels '___3', '___4', up to '___8'.

      It's valid to encode it as four bits (by design).

      The  {@link msgTtlToSeconds} array provides the actual time in seconds for
      each value, and {@link msgTtlToString} provides a string description.

      @public
*/
export type MessageTtl = 0 | 3 | 4 | 5 | 6 | 7 | 8 | 15

/** @internal */ export const msgTtlToSeconds = [0, -1, -1, 60, 300, 1800, 14400, 129600, 864000, -1, -1, -1, -1, -1, Infinity]
/** @internal */ export const msgTtlToString = ['Ephemeral', '<reserved>', '<reserved>', 'One minute', 'Five minutes', 'Thirty minutes', 'Four hours', '36 hours', '10 days', '<reserved>', '<reserved>', '<reserved>', '<reserved>', '<reserved>', 'Permastore (no TTL)']



/**
 * The "app" level message format, provided to onMessage (by ChannelSocket), and
 * similar interfaces.
 * 
 * 'body' contains whatever the message contents are, most apps won't be accessing
 * the rest of the fields. And they are all populated either by the library
 * or the server.
 * 
 * Note that generally apps won't see a message unless it's been validated
 * in a variety of ways.
 * 
 * Internally, os384 shuffles messages around as @{link ChannelMessage}.
 * 
 * Validator is {@link validate_Message}.
 * 
 * @public
 */
export interface Message {
    body: any;

    channelId: ChannelId;
    sender: SBUserId;
    /** implied is userId of channel, but note that all 'private' messages are 'cc' to Owner */
    messageTo?: SBUserId;
    senderPublicKey: SBUserPublicKey;
    senderTimestamp: number;
    /** reconstructed from timestampPrefix */
    serverTimestamp: number;
    /** end of life (timestamp, if present) */
    eol?: number;
    _id: string;
    /** if present, hash of previous message from this sender */
    previous?: string;
    /** if present, there was an error */
    error?: string;
}

/**
 * Validates 'Message', throws if there's an issue
 * @public
 */
export function validate_Message(data: Message): Message {
    if (!data) throw new SBError(`invalid Message (null or undefined)`)
    else if (
        // body can be anything, but must be something
        data.body !== undefined && data.body !== null
        && data.channelId && typeof data.channelId === 'string' && data.channelId.length === 43
        && data.sender && typeof data.sender === 'string' && data.sender.length === 43
        && data.senderPublicKey && typeof data.senderPublicKey === 'string' && data.senderPublicKey.length > 0
        && data.senderTimestamp && Number.isInteger(data.senderTimestamp)
        && data.serverTimestamp && Number.isInteger(data.serverTimestamp)
        && data._id && typeof data._id === 'string' && data._id.length === 75 // 86 new v3 format is shorter (base 4)
    ) {
        return data as Message
    } else {
        if (DBG0) console.error('invalid Message ... trying to ingest:\n', data)
        throw new SBError(`invalid Message`)
    }
}



/**
 * Every message being sent goes through the SBMessage object. Upon creation,
 * the provided contents (which can be any JS object more or les) is encrypted
 * and wrapped into a ChannelMessage object, which is what is later sent. Same
 * binary format is used for restful endpoints, websockets, and other
 * transports.
 *
 * Body should be below 32KiB. Note: for protocol choice, sbm will prioritize
 * message options over channel choice, and lacking both will default to
 * Channel.defaultProtocol (which is Protocol_ECDH).
 *
 * Note that with Protocl_ECDH, you need to make sure 'sendTo' is set, since
 * that will otherwise default to Owner. It does not support channel
 * 'broadcast'.
 *
 * The option 'sendString' allows for 'lower-level' messaging, for example for
 * special 'keep alive' messages that might be server-specific. If that is set,
 * the contents are expected to be a string, and the message will be sent as-is,
 * and features like encryption, ack/nack, ttl, routing, etc, are not available.
 */


// class SBMessage {
//   [SB_MESSAGE_SYMBOL] = true
//   sbMessageReady: Promise<SBMessage>
//   static ReadyFlag = Symbol('SBMessageReadyFlag'); // see below for '(this as any)[<class>.ReadyFlag] = false;'
//   #message?: ChannelMessage | string   // the message that's set to send
//   salt?: ArrayBuffer

//   constructor(
//     public channel: Channel,
//     public contents: any,
//     public options: MessageOptions = {}
//   ) {

//     if (options.sendString) {
//       // in this case, we don't need to do anything else, so 'sbMessageReady'
//       // should resolve to 'this' right away
//       _sb_assert(typeof contents === 'string', "SBMessage() - sendString is true, but contents is not a string")
//       this.#message = contents
//       this.sbMessageReady = new Promise<SBMessage>(async (resolve) => {
//         (this as any)[SBMessage.ReadyFlag] = true
//         resolve(this)
//       })
//     } else {
//       // there is always sbm-generated salt, whether or not the protocol needs it,
//       // or wants to create/manage it by itself
//       this.salt = crypto.getRandomValues(new Uint8Array(16)).buffer;
//       this.sbMessageReady = new Promise<SBMessage>(async (resolve) => {
//         await channel.channelReady
//         if (!this.options.protocol) this.options.protocol = channel.protocol
//         if (!this.options.protocol) this.options.protocol = Channel.defaultProtocol
//         this.#message = await sbCrypto.wrap(
//           this.contents,
//           this.channel.userId,
//           await this.options.protocol.encryptionKey(this),
//           this.salt!,
//           this.channel.signKey,
//           options);
//         (this as any)[SBMessage.ReadyFlag] = true
//         resolve(this)
//       })
//     }
//   }

//   get ready() { return this.sbMessageReady }
//   get SBMessageReadyFlag() { return (this as any)[SBMessage.ReadyFlag] }
//   @Ready get message() { return this.#message! }

//   /**
//    * SBMessage.send()
//    */
//   async send() {
//     await this.ready
//     if (DBG0) console.log("SBMessage.send() - sending message:", this.message)
//     return this.channel.callApi('/send', this.message)
//   }
// } /* class SBMessage */

