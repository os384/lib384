// (c) 2024 384 (tm)

const DBG0 = false

import {
  ChannelId, SBUserPublicKey, ObjectHandle, ChannelApi, Channel, Message,
  ChannelMessage,
} from '../index'
import { DBG2, SEP, _SEP, _SEP_, Memoize, isNil } from '../common'
// import { AsyncSequence } from "../utils/AsyncSequence"
import { TreeNodeValueType, HistoryTree, HistoryTreeNode, TEST_WITH_SMALL_BRANCHING } from './HistoryTree'

/**
* 'MessageHistory' is where Messages go to retire. It's a scaleable structure
* that can be used to store messages in a flexible way. Chunks of messages are
* stored as shards, in the form of a payload wrapped Map (key->message), where
* each message in turn is a payload-wrapped ChannelMessage.
*
* This can be thought of as a flexible 'key-value store archive format' (where
* the keys are globally unique and monotonically increasing).
*
* The channel server keeps the 'latest' messages (by some definition) in a
* straight KV format; overflow (or archiving) is done by processing messages
* into this structure.
*
* The class for the whole thing is 'DeepHistory', below. It is a variant of a
* Merkle tree (strictly speaking, it's only a Merkle tree when fully 'frozen').
*
* @public
*/
export interface MessageHistory extends TreeNodeValueType {
  version: '20240603.0',
  channelId: ChannelId, // server from which this backup was originally taken
  ownerPublicKey: SBUserPublicKey, // archives pub key that created original channel
  created: number, // timestamp of creation (of this backup shard)
  size?: number, // total size of all the messages (counted individually, not the size of the shard)
  shard: ObjectHandle, // the actual shard with the messages
}

/**
* Full deep history ("DH") feature. If no budget is provided, it will be in
* read-only mode. Uses Tree with index type 'string' (eg channelId + '_' +
* subChannel + '_' + timestampPrefix). The 'values' handled by HistoryTree are
* MessageHistory, and this class will encapsulate shardifying the lowest level,
* eg 'leaf' nodes with between ~128 and 512 messages.
*
* Note that the channel server has a parallel class to this ('ChannelHistory')
*
* @public
*/
export abstract class DeepHistory<FrozenType> extends HistoryTree<FrozenType> {
  /*
     the production values are calibrated for overflowing on either max message
     count or max message size, whichever happens first.  a 'directory' (eg
     'node') entry is at most ~750 bytes per child. hence the branching factor
     of 32, which will keep the size of a sharded 'node' under 24 KiB.

     the message set size is set to 512, which is approx half of 1000, which is
     the current Cloudflare limit to single-query key queries. with a current
     maximum of 64 KiB per message (though we are currently using 32 KiB), that
     would translate to at least 32 MiB in a single shard, which is well above
     efficient sizes, so we also limit the size message contents to 4 MiB, which
     in practice leads to a minimum message count of 125 (not 128, because of
     packaging overhead, and a small buffer).

     in practice, most messages are (much) shorter than max.

     we want large values, if for no other reason than that the mutable part of
     DeepHistory is of a size that's a function of height.

     these production values imply a single-level tree can reference up to 16K
     messages (or up to 128 MiB of message content); two levels can reference
     512K messages (or up to 4 GiB of message content); three levels can
     reference 16M messages (or up to 128 GiB of message content).

     the design limit for a single channel is 256K messages per second. so two
     year's worth of flat-out messaging would be over 16 trillion messages, and
     could in principle fit in a 7-level tree.

     our current channel servers are capped by CF at 1K messages per second, but
     we have POC server code that can handle >1M.

  */

  abstract storeData(data: any): Promise<FrozenType>
  abstract fetchData(handle: FrozenType): Promise<any>

  // this is specific to DH; we take a cue from SBFile max chunks which are
  // currently 4 MiB, and current channel server message maximum is 32 KiB. 
  public static MAX_MESSAGE_HISTORY_SHARD_SIZE = (4 * 1024 * 1024) - (2 * 32 * 1024)

  constructor(
    public branchFactor: number,
    data?: any
  ) { super(branchFactor, data); }

  // provides abstract interface for the Tree class
  async freeze(data: HistoryTreeNode<FrozenType>): Promise<FrozenType> {
    if (DBG2) console.log("freezing data:", data)
    const f = await this.storeData(data)
    if (DBG2) console.log("... frozen data identifier:", f)
    return f
  }
  // provides abstract interface for the Tree class
  async deFrost(handle: FrozenType) {
    if (DBG2) console.log("deFrosting handle:", handle)
    const data = await this.fetchData(handle) as any;
    if (DBG2) console.log("... deFrosted results:\n", data)
    return data
  }
  /** returns timestamp form of FIRST message covered by this history (use 'from' for prefix format) */
  @Memoize get fromTimestamp(): number | undefined {
    if (isNil(this.from)) throw new Error("Requesting 'from' timestamp on uninitialized history");
    return Channel.base4StringToTimestamp(this.from);
  }
  /** returns timestamp form of LAST message covered by this history (use 'to' for prefix format) */
  @Memoize get toTimestamp(): number | undefined {
    if (isNil(this.to)) throw new Error("Requesting 'to' timestamp on uninitialized history");
    return Channel.base4StringToTimestamp(this.to);
  }
}

// used server-side (write only)
export abstract class ServerDeepHistory extends DeepHistory<ObjectHandle> {
  public static MESSAGE_HISTORY_BRANCH_FACTOR = TEST_WITH_SMALL_BRANCHING ? 3 : 32; // production value
  public static MAX_MESSAGE_SET_SIZE = TEST_WITH_SMALL_BRANCHING ? 5 : 512; // production value
  constructor(
    data: any
  ) {
    super(ServerDeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR, data)
  }
  async insert(data: MessageHistory) {
    await this.insertTreeNodeValue(data)
  }
  async fetchData(_handle: ObjectHandle): Promise<any> {
    throw new Error("[ServerDeepHistory] should not be fetching data (server-side is write-only)")
  }

}

/**
 * Client-side Deep History.
 * @public
 */
export class ClientDeepHistory extends DeepHistory<ObjectHandle> {
  private SB: ChannelApi
  constructor(
    data: any,
    private channel: Channel
  ) {
    super(ServerDeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR, data)
    if (!this.channel.channelServer) throw new Error("Channel server required")
    this.SB = new ChannelApi(this.channel.channelServer)
  }

  // wrapper (blocker) for the storage API
  async storeData(_data: any): Promise<ObjectHandle> {
    throw new Error("[ClientDeepHistory] should not be storing data (client-side is read-only)")
  }
  // wrapper for the storage API; returns the final payload (extracted)
  async fetchData(handle: ObjectHandle): Promise<any> {
    if (!this.SB) throw new Error("SB required to fetch data")
    return (await this.SB.storage.fetchData(handle)).payload

  }

  // /** traverses all messages in the tree, in order or reverse; currently only
  //     used by unit test code. end-users would presumably use streams */
  // async traverseMessages(callback: (value: Message) => Promise<void>, reverse: boolean): Promise<void> {
  //   if (DBG0) console.log(SEP, `Traversing the tree ${reverse ? 'in REVERSE' : 'in order'} :`, _SEP)
  //   await this.traverseValues(async t => {
  //     const node = t as MessageHistory // specialized TreeNodeValueType
  //     if (DBG0) console.log(SEP, "We are looking at node:\n", node, SEP)
  //     if (node.shard) {
  //       const messages = await this.fetchData(node.shard) as Map<string, ChannelMessage>
  //       if (!(messages instanceof Map)) throw new Error("Expected a map")
  //       // if (DBG0) console.log(SEP, "We are looking at:\n", node.shard, SEP, messages, SEP, messages.size, SEP)
  //       if (DBG0) console.log(SEP, `... in this shard we find ${messages.size} messages):`, "\n", node.shard, SEP)
  //       const keys = Array.from(messages.keys())
  //       // either sort in order or sort reverse
  //       keys.sort()
  //       if (reverse) keys.reverse()
  //       for (const key of keys) {
  //         const value = messages.get(key)
  //         if (value) {
  //           const msg = await this.channel.extractMessage(value)
  //           if (msg)
  //             if (callback) await callback(msg)
  //             else console.log(msg)
  //         }
  //       }
  //     }
  //   }, reverse);
  //   if (DBG0) console.log(SEP)
  // }

  async *traverseMessagesGenerator(
    from: number,
    to: number,
    reverse: boolean
    // ): AsyncGenerator<Message, void, unknown> {
  ): AsyncIterableIterator<Message> {
    const fromStr = Channel.timestampToBase4String(from);
    const toStr = Channel.timestampToBase4String(to);
    if (!fromStr || !toStr) throw new Error("Invalid timestamp conversion");
    if (DBG0) console.log(SEP, `Generator traversing the tree ${reverse ? 'in REVERSE' : 'in order'} from ${from} to '${to}':`, SEP,
       "From string:", fromStr, "To string:", toStr, _SEP);
    for await (const t of this.traverseValuesGenerator(fromStr, toStr, reverse)) {
      const node = t as MessageHistory; // Specialized TreeNodeValueType
      if (DBG0) console.log(SEP, "We are looking at node:\n", node, SEP);
      if (isNil(node.from) || isNil(node.to)) throw new Error("Node missing 'from' or 'to' values");
      if (node.shard) {
        if (toStr < node.from || fromStr > node.to) {
          if (DBG0) console.log(SEP, "Skipping shard, out of range", '\n',
            "         node from/to:", node.from, node.to, '\n',
            "  restriction from/to:", fromStr, toStr, SEP);
          continue;
        } else {
          if (DBG0) console.log(SEP, "Processing shard range:", '\n',
            "                node from/to", node.from, node.to, '\n',
            " touches restriction from/to:", fromStr, toStr, SEP);
        }
        const messages = await this.fetchData(node.shard) as Map<string, ChannelMessage>;
        if (!(messages instanceof Map)) throw new Error("Expected a map");
        if (DBG0) console.log(SEP, `... FETCHING FROM STORAGE SERVER and in this shard we find ${messages.size} messages:`, "\n", node.shard, SEP);
        const keys = Array.from(messages.keys());
        keys.sort();
        if (reverse) keys.reverse();
        for (const key of keys) {
          const value = messages.get(key);
          if (value) {
            if (isNil(value.sts)) throw new Error("Message missing 'sts' value (L219)");
             if (value.sts >= from && value.sts <= to) {
              const msg = await this.channel.extractMessage(value);
              if (msg) {
                if (DBG2) console.log("[ClientDeepHistory] Yielding message with server timestamp:", msg.senderTimestamp);
                yield msg;
              }
            } else {
              if (DBG2) console.log("Skipping message, out of range. message sts:", value.sts, "  restriction from/to:", from, to);
            }
          }
        }
      }
    }
    if (DBG0) console.log(SEP);
  }

  // specialized version, non-reversed traversal, requesting raw messages.
  // used by ChannelStream to populate it's cache with full history
  async traverseMessagesEncrypted(callback: (id: string, value: ChannelMessage) => Promise<void>): Promise<void> {
    await this.traverseValues(async t => {
      const node = t as MessageHistory // specialized TreeNodeValueType
      if (node.shard) {
        const messages = await this.fetchData(node.shard) as Map<string, ChannelMessage>
        if (!(messages instanceof Map)) throw new Error("Expected a map")
        // perform callback for raw messages, remember (key, value)
        for (const [key, value] of messages)
          await callback(key, value)
      }
    });
  }

  async validate(): Promise<void> {
    await super.validate(ServerDeepHistory.MAX_MESSAGE_SET_SIZE);
  }
}
