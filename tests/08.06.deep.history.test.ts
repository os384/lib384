#!/usr/bin/env -S deno run --allow-net --allow-read

//  (c) 2023-2024, 384 (tm) Inc.

// this is underlying design work for 'deep history' feature

// same as 08.05, but works with actual shards. ergo, use 08.05 top stress-test
// 'pure' very large trees in isolation from storage server.

// note that the 'DeepHistory' class in this test is distinctly different from
// final result in lib384: the former (this one) isn't operating within a channel
// server and ergo needs to have a 'top' (latest messages) to work with.

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import {
    ChannelApi,
    assemblePayload, extractPayload,
    ChannelMessage, Channel,
    ObjectHandle, stringify_ObjectHandle, 
    ChannelId, SBUserPublicKey, 
} from "../dist/384.esm.js"

let SB = new ChannelApi(configuration.channelServer, configuration.DBG)
// Guard: skip top-level connection if no credentials are configured (e.g. CI / fast-test runs).
const budgetChannel = configuration.budgetKey ? SB.connect(configuration.budgetKey) : null
if (budgetChannel) await budgetChannel.ready

const _SEP_ = '='.repeat(76)
const _SEP = '\n' + _SEP_
const SEP_ = _SEP_ + '\n'
const SEP = '\n' + _SEP_ + '\n'

const DBG1 = true;
const DBG2 = false;

// =============================================================== BEGIN EXPORT
// this section is self-contained, being migrated to lib384

export interface Freezable<T1, T2> {
    type: 'leaf' | 'node';
    valuesArray?: T1[];
    frozenChunkIdArray?: T2[];
  }
  
  export class TreeNode<ValueType, FrozenIdType, IndexType> {
    children: TreeNode<ValueType, FrozenIdType, IndexType>[] = [];
    value: ValueType | undefined = undefined;
    from: IndexType | undefined = undefined;
    to: IndexType | undefined = undefined;
    isFull: boolean = false;
  
    frozenHeight: number | undefined = undefined; // if set, corresponds to a frozen chunk
    frozenChunkId: FrozenIdType | undefined = undefined; // if we're frozen at this point, this is the chunk number
  
    constructor(
        private root: Tree<ValueType, FrozenIdType, IndexType>,
        public isLeaf: boolean = false
    ) { }
  
    // Attempts to insert a value into the tree. Returns false if the node is full.
    async insert(value: ValueType, from: IndexType, to: IndexType = from): Promise<boolean> {
        if (DBG2) console.log(SEP_, `Inserting value ${value} at this point (leaf, full, children count):\n`, this.isLeaf, this.isFull, this.value, this.children.length)
        if (this.isFull || this.value !== undefined) throw new Error("Should not be inserting here")
        if (this.isLeaf) {
            const newLeaf = new TreeNode<ValueType, FrozenIdType, IndexType>(this.root);
            newLeaf.value = value;
            newLeaf.from = from;
            newLeaf.to = to;
            if (!this.from || from < this.from) this.from = from;
            if (!this.to || to > this.to) this.to = to;
            newLeaf.isFull = true;
            this.children.push(newLeaf);
            if (this.children.length === this.root.branchFactor) {
                // it's 'full', we freeze it
                this.isFull = true;
                this.frozenHeight = this.nodeHeight(); // will be '1'
                this.frozenChunkId = await this.root.freeze({ type: 'leaf', valuesArray: this.children.map(child => child.value!)})
                this.children = []; // we don't need the children anymore
            }
            return true;
        }
  
        if (this.children.length === 0 || this.children[this.children.length - 1].isFull) {
            if (this.children.length === this.root.branchFactor) throw new Error("Internal Error (L100)")
            const newNode = new TreeNode<ValueType, FrozenIdType, IndexType>(this.root, true); // always start with leaf node
            await newNode.insert(value, from, to); // this will be true
            this.children.push(newNode);
            if (!this.from || from < this.from) this.from = from;
            if (!this.to || to > this.to) this.to = to;
            return true;
        }
  
        // pick last child (we know it's not full) and insert, and check if that fills it
        await this.children[this.children.length - 1].insert(value, from, to);
        this.from = from < this.from! ? from : this.from!;
        this.to = to > this.to! ? to : this.to!;
  
        // if this filled up the last child, and we have branch factor children, we are full
        if (this.children[this.children.length - 1].isFull && this.children.length === this.root.branchFactor) {
            let i = 0;
            while (this.children[i].nodeHeight() === this.children[i+1].nodeHeight()) {
                if (++i === this.children.length - 1) {
                    // if all children are the same height, we are full, and we freeze the node
                    this.isFull = true;
                    this.frozenHeight = this.nodeHeight();
                    this.frozenChunkId = await this.root.freeze({ type: 'node', frozenChunkIdArray: this.children.map(child => child.frozenChunkId!) })
                    this.children = []; // we don't need the children anymore
                    // 'from' and 'to' are already set
                    return true;
                }
            }
            // we know that child 'i+1' onwards are shorter than child 'i', merge those into a new node
            const newChild = new TreeNode<ValueType, FrozenIdType, IndexType>(this.root);
            newChild.children = this.children.splice(i+1);
            // we leverage that the leaves are always sorted 'left to right'
            newChild.from = newChild.children[0].from;
            newChild.to = newChild.children[newChild.children.length - 1].to;
            this.children.push(newChild);
            return true
        }
        return true; // regardless, we did handle the value
    }
  
    nodeHeight(): number {
        if (this.frozenHeight !== undefined) return this.frozenHeight;
        if (this.value !== undefined) return 0;
        // otherwise we return the max height of any of our children
        return 1 + Math.max(...this.children.map(child => child.nodeHeight()));
    }
  
    async traverse(callback: (node: TreeNode<ValueType, FrozenIdType, IndexType>) => Promise<void>, reverse = false): Promise<void> {
        if (!reverse) await callback(this);
        var children = this.children;
        if (this.frozenChunkId !== undefined) {
            const frozen = await this.root.deFrost(this.frozenChunkId);
            if (frozen.type === 'leaf') {
                children = frozen.valuesArray!.map(value => {
                    const node = new TreeNode<ValueType, FrozenIdType, IndexType>(this.root, true);
                    node.value = value;
                    return node;
                });
            } else if (frozen.type === 'node') {
                children = frozen.frozenChunkIdArray!.map(chunkId => {
                    const node = new TreeNode<ValueType, FrozenIdType, IndexType>(this.root);
                    node.frozenChunkId = chunkId;
                    return node;
                });
            } else {
                console.error("Frozen type error, contents of frozen:\n", frozen)
                throw new Error("Unknown frozen type")
            }
        }
  
        if (!reverse) for (const child of children) await child.traverse(callback, reverse);
        else for (let i = children.length - 1; i >= 0; i--) await children[i].traverse(callback, reverse);
        
        if (reverse) await callback(this);
    }
  
    async _callbackValue(node: TreeNode<ValueType, FrozenIdType, IndexType>, _nodeCallback?: (value: ValueType) => Promise<void>): Promise<void> {
        if (node.value !== undefined)
            if (_nodeCallback !== undefined)
                await _nodeCallback(node.value);
            else
                if (DBG1) console.log(node.value);
    }
  
    async traverseValues(callback?: (value: ValueType) => Promise<void>, reverse = false): Promise<void> {
        return this.traverse(async node => await this._callbackValue(node, callback), reverse);
    }
  
    export(): any {
        let retVal: any = { from: this.from, to: this.to }
        if (this.frozenChunkId !== undefined) {
            // return { frozenHeight: this.frozenHeight, frozenChunkId: this.frozenChunkId }
            retVal = { ...retVal, frozenChunkId: this.frozenChunkId, frozenHeight: this.frozenHeight}
        } else if (this.value) {
            // return { value: this.value }
            retVal = { ...retVal, value: this.value }
        } else {
            // return { frozenHeight: this.frozenHeight, value: this.value, isFull: this.isFull, children: this.children.map(child => child.export())}
            if (this.frozenHeight !== undefined) throw new Error("Should not have a frozen height here")
            // return { isFull: this.isFull, children: this.children.map(child => child.export())}
            retVal = { ...retVal, isFull: this.isFull, children: this.children.map(child => child.export())}
        }
        return retVal;
    }
  
    static import<ValueType, FrozenType, IndexType>(root: Tree<ValueType, FrozenType, IndexType>, data: any): TreeNode<ValueType, FrozenType, IndexType> {
        const node = new TreeNode<ValueType, FrozenType, IndexType>(root);
        node.from = data.from;
        node.to = data.to;
        if (data.frozenChunkId !== undefined) {
            node.frozenChunkId = data.frozenChunkId;
            node.frozenHeight = data.frozenHeight;
            node.isFull = true // <== forgot this
        } else if (data.value !== undefined) {
            node.isLeaf = true; // <== forgot this
            node.isFull = true; // <== forgot this
            node.value = data.value;
        } else {
            node.isFull = data.isFull;
            node.children = data.children.map((child: any) => TreeNode.import(root, child));
        }
        return node;
    }
  
  }
  
  export abstract class Tree<ValueType, FrozenType, IndexType> {
    root: TreeNode<ValueType, FrozenType, IndexType> = new TreeNode<ValueType, FrozenType, IndexType>(this)
    abstract freeze(data: Freezable<ValueType, FrozenType>): Promise<FrozenType>
    abstract deFrost(data: FrozenType): Promise<Freezable<ValueType, FrozenType>>
    constructor(public branchFactor: number, data?: any) {
        if (data)
            this.root = TreeNode.import(this, data);
    }
    async insertValue(value: ValueType, from: IndexType, to: IndexType): Promise<boolean> {
        if (this.root.isFull) {
            // when the tree grows is the decision point to shardify the structure
            const newRoot = new TreeNode<ValueType, FrozenType, IndexType>(this);
            newRoot.from = this.root.from;
            newRoot.to = this.root.to;
            newRoot.children.push(this.root);
            this.root = newRoot;
        }
        return this.root.insert(value, from, to);
    }
    async traverse(callback: (node: TreeNode<ValueType, FrozenType, IndexType>) => Promise<void>, reverse = false): Promise<void> {
        return this.root.traverse(callback, reverse);
    }
    async traverseValues(callback?: (value: ValueType) => Promise<void>, reverse = false): Promise<void> {
        return this.root.traverseValues(callback, reverse);
    }
    export(): any {
        if (this.root)
            return this.root.export();
        else return {};
    }
  
  }
  
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
  */
  export interface MessageHistory {
    version: '20240601.0',
    channelId: ChannelId, // server from which this backup was originally taken
    ownerPublicKey: SBUserPublicKey, // archives pub key that created original channel
    created: number, // timestamp of creation (of this backup shard)
    from: string, // first message ID in this set (inclusive)
    to: string, // last message ID in this set (inclusive)
    count: number, // (total) count of messages, zero means empty, max is 512
    size: number, // total size of all the messages (counted individually, not the size of the shard)
    shard: ObjectHandle, // the actual shard (payload wrapped Map<string, ArrayBuffer>)
  }
  
  
  /**
  * Full deep history feature. If no budget is provided, it will be in read-only
  * mode. Uses Tree with index type 'string' (eg channelId + '_' + subChannel +
  * '_' + timestampPrefix). The 'values' handled by Tree are MessageHistory, and
  * this class will encapsulate shardifying the lowest level, eg 'leaf' nodes
  * with between ~128 and 512 messages.
  */
  export class DeepHistory extends Tree<MessageHistory, ObjectHandle, string> {
    /*
       the production values are calibrated for overflowing on either max
       message count or max message size, whichever happens first.  a
       'directory' (eg 'node') entry is at most ~750 bytes per child. hence the
       branching factor of 32, which will keep the size of a sharded 'node'
       under 24 KiB.
  
       the message set size is set to 512, which is approx half of 1000, which
       is the current Cloudflare limit to single-query key queries. with a
       current maximum of 64 KiB per message (though we are currently using 32
       KiB), that would translate to at least 32 MiB in a single shard, which is
       well above efficient sizes, so we also limit the size message contents to
       4 MiB, which in practice leads to a minimum message cound of 125 (not
       128, because of packaging overhead, and a small buffer).
  
       in practice, most messages are (much) shorter than max.
  
       we want large values, if for no other reason than that the mutable part
       of DeepHistory is of a size that's a function of height.
  
       these production values imply a single-level tree can reference up to 16K
       messages (or up to 128 MiB of message content); two levels can reference
       512K messages (or up to 4 GiB of message content); three levels can
       reference 16M messages (or up to 128 GiB of message content).
  
       the design limit for a single channel is 256K messages per second. so two
       year's worth of flat-out messaging would be over 16 trillion messages,
       and could fit (in principle) fit in a 7-level tree.
  
       (our current Cloudflare-hosted channel servers are capped at 1K messages
       per second, but we have POC channel server code that can handle >1M).
  
    */
    // public static MESSAGE_HISTORY_BRANCH_FACTOR = 32; // production value
    public static MESSAGE_HISTORY_BRANCH_FACTOR = 5; // testing value
  
    // public static MAX_MESSAGE_SET_SIZE = 512; // production value
    public static MAX_MESSAGE_SET_SIZE = 7; // testing value
  
    // this is specific to DH; we take a cue from SBFile max chunks which are
    // currently 4 MiB, and current channel server message maximum is 32 KiB. 
    public static MAX_MESSAGE_HISTORY_SHARD_SIZE = (4 * 1024 * 1024) - (2 * 32 * 1024)
  
    // top is 'working memory', when feeding items (eg messages) into the tree
    top: Map<string, ArrayBuffer> = new Map()
    topSize = 0; // size in bytes of messages in 'top'
  
    constructor(data?: any, private SB?: ChannelApi, private budget?: Channel) {
        super(DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR, data);
    }
  
    // wrapper for the storage API; returnes cleaned-up / compacted handle
    private async storeData(data: any): Promise<ObjectHandle> {
        if (!this.budget || !this.SB) throw new Error("Budget required to freeze data (this DeepHistory is operating in read-only mode)")
        if (DBG2) {
            const b = assemblePayload(data)!
            console.log("(packaged size will be) [storeData] asked to store buffer size", b.byteLength, "bytes")
        }
        const h = await this.SB.storage.storeData(data, this.budget)
        const x = await stringify_ObjectHandle(h)
        return {
            id: x.id,
            key: x.key,
            verification: x.verification
        }    
    }
  
    // wrapper for the storage API; returns the final payload (extracted)
    private async fetchData(handle: ObjectHandle): Promise<any> {
        // return SB.storage.fetchData(handle).then(h => extractPayload(h.payload).payload)
        if (!this.SB) throw new Error("SB required to fetch data")
        const b = await this.SB.storage.fetchData(handle)
        // const p = extractPayload(b.payload)
        // if (!p) throw new Error("Failed to extract payload")
        // return p.payload
        return b.payload
    }
  
    // provides abstract interface for the Tree class
    async freeze(data: Freezable<MessageHistory, ObjectHandle>): Promise<ObjectHandle> {
        if (DBG1) 
            console.log("*** Freezing data, packaged size will be:", assemblePayload(data)!.byteLength)
        return this.storeData(data)
    }
    // provides abstract interface for the Tree class
    async deFrost(handle: ObjectHandle) {
        return this.fetchData(handle) as Promise<Freezable<MessageHistory, ObjectHandle>>
    }
  
    async insert(msg: ChannelMessage): Promise<void> {
        const id = msg._id!
        const msgPayload = assemblePayload(msg); if (!msgPayload) throw new Error("Failed to assemble payload")
        this.top.set(id, msgPayload)
        this.topSize += msgPayload.byteLength
        if (
            // note: we need '>=' so we can ingest an older tree, and pick it back up
               this.top.size >= DeepHistory.MAX_MESSAGE_SET_SIZE
            || this.topSize >= DeepHistory.MAX_MESSAGE_HISTORY_SHARD_SIZE
        ) {
            if (DBG2) console.log(`Top now has ${this.top.size} messages, and ${this.topSize} bytes of content, overflowing ...`)
            if (DBG2) console.log(`(packaged size will be) contains ${this.top.size} messages, and ${this.topSize} bytes of content`)
            const [from, to] = Channel.getLexicalExtremes(this.top)
            const newEntry: MessageHistory = {
                version: '20240601.0',
                channelId: '<channelId>',
                ownerPublicKey: '<ownerPublicKey>',
                created: Date.now(),
                from: from!,
                to: to!,
                count: this.top.size,
                // messages: new Map(this.top)
                size: this.topSize,
                shard: await this.storeData(this.top)
            }
            this.top.clear(); this.topSize = 0;
            if (DBG2) console.log(SEP, "Local (KV etc) overflowed, inserting new entry:\n", newEntry, _SEP)
            await this.insertValue(newEntry, from!, to!)
        }
    }
    printTop(reverse: boolean) {
        if (!(this.top instanceof Map)) throw new Error("Expected a map (in this.top)")
        const keys = Array.from(this.top.keys())
        keys.sort()
        if (reverse) keys.reverse()
        keys.forEach(key => {
            const value = this.top.get(key)
            if (value) {
                const msg = extractPayload(value).payload as ChannelMessage
                console.log(msg._id, ' - ', msg.unencryptedContents)
            }
        });
    }
    async traverseValues(callback?: (value: MessageHistory) => void, reverse = false): Promise<void> {
        if (callback) throw new Error("Not implemented, we hard code the callback")
        console.log(SEP, `Traversing the tree ${reverse ? 'reverse' : 'in order'} :`, _SEP)
        if (reverse) this.printTop(true)
        await this.traverse(async node => {
            // const messages = node.value?.messages
            // console.log(SEP, "NODE and node value:\n", node, SEP, node.value, SEP)
            if (node.value) {
                const messages = await this.fetchData(node.value.shard) as Map<string, ArrayBuffer>
                if (!(messages instanceof Map)) throw new Error("Expected a map")
                if (DBG2) console.log(SEP, "We are looking at:\n", node.value, SEP, messages, SEP, messages.size, SEP)
                const keys = Array.from(messages.keys())
                // either sort in order or sort reverse
                keys.sort()
                if (reverse) keys.reverse()
                for (const key of keys) {
                    const value = messages.get(key)
                    if (value) {
                        const msg = extractPayload(value).payload as ChannelMessage
                        if (DBG2) console.log(msg._id, ' - ', msg.unencryptedContents)
                        else console.log(msg._id, ` - '${msg.unencryptedContents.msg}' and ${msg.unencryptedContents.body.byteLength} bytes`)
                    }
                }
            }
        }, reverse);
        if (!reverse) this.printTop(false)
        console.log(SEP)
    }
    
  }
  
// =============================================================== END EXPORT

const VARIABLE_MESSAGE_SIZES = true // if false, maxes on LOTS of messages
const MAX_MESSAGE_SIZE = false // if true, maxes on LARGE messages

function randomMessage(i: number): ChannelMessage {
    let msgData = new Uint8Array(0)
    if (VARIABLE_MESSAGE_SIZES) {
        const messageSizes = [
            32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, // most or short
            64, 64, 128, 128, 64, 64, 128, 128, 64, 64, 128, 128, // some are medium
            2048, 2048, 2048, 4096, 8192, 4096, 8192, 16384 // and sometimes they're long
        ]
        // pick a random messages size from the above array
        const randomSize = MAX_MESSAGE_SIZE ? 32 * 1024 : messageSizes[Math.floor(Math.random() * messageSizes.length)]
        msgData = crypto.getRandomValues(new Uint8Array(randomSize))
    }

    const randomString = Math.random().toString(36).substring(2, 8)
    const todayDateString = new Date().toISOString()
    const index = i.toString().padStart(8, '0')
    const msgString = `message number ${index} [${randomString}] [${todayDateString}]`
    const message = { msg: msgString, body: msgData }
    if (DBG2) console.log("Inserting: ", message)
    return { _id: index, unencryptedContents: message }
}

// Testing the tree ... in tricky ways
async function printTestTree(N: number, detail = false): Promise<void> {
    let current_N = 0
    let i = 0;
    console.log(SEP, "[08.05] [tree] testing tree with size ", N, SEP)

    // const tree = new Tree<number, string>(testFreeze);
    const tree = new DeepHistory(undefined, SB, budgetChannel);
    for (i = 0; i < N; i++)
        await tree.insert(randomMessage(i));
    current_N = i;

    const exportedTree = tree.export()
    console.log(SEP, "Raw tree structure for tree ONE:", SEP, exportedTree, SEP)

    console.log("(JSON format, note that 'messages' are always in shards so not shown, ditto for any frozen (node) chunks)")
    console.log(JSON.stringify(exportedTree, null, 2))
    console.log(SEP)

    if (DBG2) console.log("Note, DeepHistory has this in the 'top' value:\n", tree.top, SEP)

    if (detail) {
        console.log(SEP, "Traversing the tree in order:", SEP)
        await tree.traverseValues();
        console.log(SEP, "Traversing the tree in reverse order:", SEP)
        await tree.traverseValues(undefined, true);    
    }
    console.log(SEP)

    // now test export / import
    const tree2 = new DeepHistory(exportedTree, SB, budgetChannel);
    tree2.top = tree.top; // copy over the top (reference is fine for testing purposes)

    if (DBG2) console.log(SEP, "TREE 2 top:\n", tree2.top, SEP)
    
    if (detail) {
        console.log(SEP, "Reconstructed tree structure test, traversing values:", _SEP)
        await tree2.traverseValues();
        console.log(SEP)
    }

    // let's now insert some more values into the recovered tree
    let add_N = DeepHistory.MAX_MESSAGE_SET_SIZE * (DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR + 1)
    for (i = current_N; i < current_N + add_N; i++)
        await tree2.insert(randomMessage(i));
    current_N = i;
    console.log(SEP, `Added ${add_N} values`, _SEP)
    if (detail) {
        await tree2.traverseValues();
        console.log(SEP)
    }

    // now let's repeat that - extract, recover, insert more, traverse
    const exportedTree2 = tree2.export()
    console.log(SEP, "Raw tree structure for tree TWO:", SEP, exportedTree2, SEP)

    console.log("(JSON format, note that 'messages' are always in shards so not shown, ditto for any frozen (node) chunks)")
    console.log(JSON.stringify(exportedTree2, null, 2))
    console.log(SEP)

    const tree3 = new DeepHistory(exportedTree2, SB, budgetChannel);
    tree3.top = tree2.top; // copy over the top (reference is fine for testing purposes)

    if (DBG2) console.log(SEP, "TREE 3 top:\n", tree3.top, SEP)
    add_N = DeepHistory.MAX_MESSAGE_SET_SIZE * (DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR + 1)
    for (i = current_N; i < current_N + add_N; i++)
        await tree.insert(randomMessage(i));
    console.log(SEP, `Reconstructed tree test, and added ${add_N} more`, _SEP)
    if (detail) {
        await tree3.traverseValues();
        console.log(SEP)
        console.log(SEP, "Reconstructed tree structure test, iterated tree3, traversing values in REVERSE:", _SEP)
        await tree3.traverseValues(undefined, true);
        console.log(SEP)
    }

    console.log(SEP, "Final 'packaged' tree structure (tree THREE):", _SEP)
    const exportedTree3 = tree3.export()
    console.log(exportedTree3)
    console.log(SEP)
    console.log("(JSON format, note that 'messages' are always in shards so not shown, ditto for any frozen (node) chunks)")
    console.log(JSON.stringify(exportedTree3, null, 2))
    console.log(SEP)
}


if (import.meta.main) { // tells Deno not to run this in the test suite

    // printTestTree(DeepHistory.MAX_MESSAGE_SET_SIZE * (DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR + 1), true);
    // printTestTree(DeepHistory.MAX_MESSAGE_SET_SIZE * (DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR + 1));

    // printTestTree(DeepHistory.MAX_MESSAGE_SET_SIZE * (DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR + 1), true);

    // printTestTree(DeepHistory.MAX_MESSAGE_SET_SIZE * ((DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR + DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR + 1) * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR + 1));

    // await printTestTree(DeepHistory.MAX_MESSAGE_SET_SIZE * (DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR - 1), true);

    // printTestTree(DeepHistory.MAX_MESSAGE_SET_SIZE * (DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR + 1), true);

    // printTestTree(5 * DeepHistory.MAX_MESSAGE_SET_SIZE, true);

    // printTestTree(DeepHistory.MAX_MESSAGE_SET_SIZE * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR);
    printTestTree(DeepHistory.MAX_MESSAGE_SET_SIZE * (DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR + 1), true)
    // printTestTree(DeepHistory.MAX_MESSAGE_SET_SIZE * (DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR * DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR + 1));


}

