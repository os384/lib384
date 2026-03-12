#!/usr/bin/env -S deno run --allow-read

//  (c) 2023-2024, 384 (tm) Inc.

// this is underlying design work for 'deep history' feature

const _SEP_ = '='.repeat(76)
const _SEP = '\n' + _SEP_
const SEP_ = _SEP_ + '\n'
const SEP = '\n' + _SEP_ + '\n'

// low for testing; real production would be 32.
// const MESSAGE_HISTORY_BRANCH_FACTOR = 16;
const MESSAGE_HISTORY_BRANCH_FACTOR = 3;

// low for testing; real production would be 500.
// const MAX_MESSAGE_SET_SIZE = 64;
// const MAX_MESSAGE_SET_SIZE = 2;
const MAX_MESSAGE_SET_SIZE = 8;


const DBG1 = true;
const DBG2 = false;


import {
    MessageHistoryEntry, assemblePayload, extractPayload,
    ChannelMessage, Channel
} from "../dist/384.esm.js"

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

    private freezeInternal(node: TreeNode<ValueType, FrozenIdType, IndexType>): FrozenIdType {
        const v = node.children.map(child => child.value!)
        const freezeId = this.root.freeze({ type: 'leaf', valuesArray:  v})
        if (DBG2) console.log(SEP_, `Frozen chunk with ${MESSAGE_HISTORY_BRANCH_FACTOR} 'ValueType' into chunk id ${freezeId}:\n`, v, _SEP)
        return freezeId;
    }

    private freezeNode(node: TreeNode<ValueType, FrozenIdType, IndexType>): FrozenIdType {
        // iterate through the children, and verify that they are all frozen
        if (DBG1) console.log(`Freezing node with ${node.children.length} children`)
        this.children.forEach(child => {
            if (!child.isFull) throw new Error("Should not be freezing here, there are incomplete children")
            if (child.frozenChunkId === undefined) throw new Error("Frozen chunk missing")
            // if (DBG1) console.log('  ', `Frozen chunk ID: ${child.frozenChunkId}`)
        });
        const freezeId = this.root.freeze({ type: 'node', frozenChunkIdArray: node.children.map(child => child.frozenChunkId!) })
        if (DBG2) console.log(`  ... above went into frozen chunk id ${freezeId}`)
        return freezeId;
    }

    // Attempts to insert a value into the tree. Returns false if the node is full.
    insert(value: ValueType, from: IndexType, to: IndexType = from): boolean {
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
            if (this.children.length === MESSAGE_HISTORY_BRANCH_FACTOR) {
                // it's 'full', we freeze it
                this.isFull = true;
                this.frozenHeight = this.nodeHeight(); // will be '1'
                this.frozenChunkId = this.freezeInternal(this);
                this.children = []; // we don't need the children anymore
            }
            return true;
        }

        if (this.children.length === 0 || this.children[this.children.length - 1].isFull) {
            if (this.children.length === MESSAGE_HISTORY_BRANCH_FACTOR) throw new Error("Internal Error (L100)")
            const newNode = new TreeNode<ValueType, FrozenIdType, IndexType>(this.root, true); // always start with leaf node
            newNode.insert(value, from, to); // this will be true
            this.children.push(newNode);
            if (!this.from || from < this.from) this.from = from;
            if (!this.to || to > this.to) this.to = to;
            return true;
        }

        // pick last child (we know it's not full) and insert, and check if that fills it
        this.children[this.children.length - 1].insert(value, from, to);
        this.from = from < this.from! ? from : this.from!;
        this.to = to > this.to! ? to : this.to!;

        // if this filled up the last child, and we have branch factor children, we are full
        if (this.children[this.children.length - 1].isFull && this.children.length === MESSAGE_HISTORY_BRANCH_FACTOR) {
            let i = 0;
            while (this.children[i].nodeHeight() === this.children[i+1].nodeHeight()) {
                if (++i === this.children.length - 1) {
                    // if all children are the same height, we are full, and we freeze the node
                    this.isFull = true;
                    this.frozenHeight = this.nodeHeight();
                    this.frozenChunkId = this.freezeNode(this);
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

    traverse(callback: (node: TreeNode<ValueType, FrozenIdType, IndexType>) => void, reverse = false): void {
        if (!reverse) callback(this);
        var children = this.children;
        if (this.frozenChunkId !== undefined) {
            const frozen = this.root.deFrost(this.frozenChunkId);
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
        // if (DBG1) console.log(SEP_, `Considering children set of:\n`, children, _SEP)
        if (!reverse) {
            children.forEach(child => child.traverse(callback, reverse));
        } else {
            for (let i = children.length - 1; i >= 0; i--) {
                children[i].traverse(callback, reverse);
            }
        }
        if (reverse) callback(this);
    }

    _callbackValue(node: TreeNode<ValueType, FrozenIdType, IndexType>, _nodeCallback?: (value: ValueType) => void): void {
        if (node.value !== undefined)
            if (_nodeCallback !== undefined)
                _nodeCallback(node.value);
            else
                if (DBG1) console.log(node.value);
    }

    traverseValues(callback?: (value: ValueType) => void, reverse = false): void {
        this.traverse(node => this._callbackValue(node, callback), reverse);
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
    abstract freeze(data: Freezable<ValueType, FrozenType>): FrozenType
    abstract deFrost(data: FrozenType): Freezable<ValueType, FrozenType>
    constructor(data?: any) {
        if (data)
            this.root = TreeNode.import(this, data);
    }
    insertValue(value: ValueType, from: IndexType, to: IndexType): void {
        if (this.root.isFull) {
            // when the tree grows is the decision point to shardify the structure
            const newRoot = new TreeNode<ValueType, FrozenType, IndexType>(this);
            newRoot.from = this.root.from;
            newRoot.to = this.root.to;
            newRoot.children.push(this.root);
            this.root = newRoot;
        }
        this.root.insert(value, from, to);
        console.log("Top root from/to: ", this.root.from, this.root.to)
    }
    traverse(callback: (node: TreeNode<ValueType, FrozenType, IndexType>) => void, reverse = false): void {
        this.root.traverse(callback, reverse);
    }
    traverseValues(callback?: (value: ValueType) => void, reverse = false): void {
        this.root.traverseValues(callback, reverse);
    }
    export(): any {
        if (this.root)
            return this.root.export();
        else return {};
    }

}

export class DeepHistory extends Tree<MessageHistoryEntry, number, string> {
    chunkArray: Array<ArrayBuffer> = []
    top: Map<string, ArrayBuffer> = new Map()
    constructor(jsonString?: string) {
        super(jsonString);
    }
    freeze(data: Freezable<MessageHistoryEntry, number>): number {
        const b = assemblePayload(data)
        if (!b) throw new Error("Failed to assemble payload")
        this.chunkArray.push(b!)
        const n = this.chunkArray.length - 1
        // console.log(SEP, `Frozen chunk id ${n}:\n`, data, _SEP)
        return n
    }
    deFrost(data: number) {
        const v = extractPayload(this.chunkArray[data]).payload as Freezable<MessageHistoryEntry, number>
        if (DBG2) console.log(SEP, `De-frosted chunk id ${data}:\n`, v)
        
        return v
    }
    insert(msg: ChannelMessage): void {
        const id = msg._id!
        this.top.set(id, assemblePayload(msg)!)
        if (this.top.size == MAX_MESSAGE_SET_SIZE) {
            if (DBG2) console.log(`Top is now size ${this.top.size}, overflowing ...`)
            const [from, to] = Channel.getLexicalExtremes(this.top)
            const newEntry: MessageHistoryEntry = {
                type: 'entry',
                version: '20240529.0',
                channelId: '<channelId>',
                ownerPublicKey: '<ownerPublicKey>',
                created: Date.now(),
                from: from!,
                to: to!,
                count: this.top.size,
                messages: new Map(this.top)
            }
            this.top.clear()
            if (DBG2) console.log(SEP, "Local (KV etc) overflowed, inserting new entry:\n", newEntry, _SEP)
            this.insertValue(newEntry, from!, to!)
            if (newEntry.messages.size !== MAX_MESSAGE_SET_SIZE) {
                console.log(newEntry.messages)
                throw new Error(`Failed to insert the new entry (left with size ${newEntry.messages.size})`)
            }
        } else if (this.top.size > MAX_MESSAGE_SET_SIZE) throw new Error("Top is too big")
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
    traverseValues(callback?: (value: MessageHistoryEntry) => void, reverse = false): void {
        if (callback) throw new Error("Not implemented, we hard code the callback")
        console.log(SEP, `Traversing the tree ${reverse ? 'reverse' : 'in order'} :`, _SEP)
        if (reverse) this.printTop(true)
        this.traverse(node => {
            const messages = node.value?.messages
            if (messages) {
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
                        console.log(msg._id, ' - ', msg.unencryptedContents)
                    }
                }
            }
        }, reverse);
        if (!reverse) this.printTop(false)
        console.log(SEP)
    }
    
}
// =============================================================== END EXPORT

function randomMessage(i: number): ChannelMessage {
    const randomString = Math.random().toString(36).substring(2, 8)
    const todayDateString = new Date().toISOString()
    const index = i.toString().padStart(4, '0')
    const message = `message number ${index} [${randomString}] [${todayDateString}]`
    if (DBG2) console.log("Inserting: ", message)
    return { _id: index, unencryptedContents: message }
}

// Testing the tree ... in tricky ways
function printTestTree(N: number, detail = false): void {
    let current_N = 0
    let i = 0;
    console.log(SEP, "[08.05] [tree] testing tree with size ", N, SEP)

    // const tree = new Tree<number, string>(testFreeze);
    const tree = new DeepHistory();
    for (i = 0; i < N; i++)
        tree.insert(randomMessage(i));
    current_N = i;

    const exportedTree = tree.export()
    console.log(SEP, "Raw tree structure for tree ONE:", SEP, exportedTree, SEP)

    console.log("(JSON format, note that 'messages' are maps so not shown, and frozen chunks not expanded)")
    console.log(JSON.stringify(exportedTree, null, 2))
    console.log(SEP)


    if (DBG2) console.log("Note, DeepHistory has this in the 'top' value:\n", tree.top, SEP)

    if (detail) {
        console.log(SEP, "Traversing the tree in order:", SEP)
        tree.traverseValues();
        console.log(SEP, "Traversing the tree in reverse order:", SEP)
        tree.traverseValues(undefined, true);    
    }
    console.log(SEP)

    // print out contents of chunkArray, with the number of each chunk, printed in a zero-padded format
    console.log(SEP, "Frozen chunks:", _SEP)
    tree.chunkArray.forEach((chunk, index) => {
        if (DBG2) console.log(`Chunk ${index.toString().padStart(4, '0')}:`, extractPayload(chunk).payload)
        const payload = extractPayload(chunk)!.payload as Freezable<MessageHistoryEntry, number>
        if (payload.type === 'node') {
            console.log(`Chunk ${index.toString().padStart(4, '0')} contains:`, payload.frozenChunkIdArray)
        } else {
            console.log(`Chunk ${index.toString().padStart(4, '0')} contains: ${payload.valuesArray?.length} values`)
        }
        if (DBG2) console.log(`Chunk ${index.toString().padStart(4, '0')} contains:\n`, payload)
    });
    console.log(SEP_)

    // now test export / import
    const tree2 = new DeepHistory(exportedTree);
    tree2.chunkArray = tree.chunkArray; // copy over the frozen chunks
    tree2.top = tree.top; // copy over the top (reference is fine for testing purposes)

    if (DBG2) console.log(SEP, "TREE 2 top:\n", tree2.top, SEP)
    
    if (detail) {
        console.log(SEP, "Reconstructed tree structure test, traversing values:", _SEP)
        tree2.traverseValues();
        console.log(SEP)
    }

    // let's now insert some more values into the recovered tree
    let add_N = MAX_MESSAGE_SET_SIZE * (MESSAGE_HISTORY_BRANCH_FACTOR + 1)
    for (i = current_N; i < current_N + add_N; i++)
        tree2.insert(randomMessage(i));
    current_N = i;
    console.log(SEP, `Added ${add_N} values`, _SEP)
    if (detail) {
        tree2.traverseValues();
        console.log(SEP)
    }


    // now let's repeat that - extract, recover, insert more, traverse
    const exportedTree2 = tree2.export()
    console.log(SEP, "Raw tree structure for tree TWO:", SEP, exportedTree2, SEP)

    console.log("(JSON format, note that 'messages' are maps so not shown, and frozen chunks not expanded)")
    console.log(JSON.stringify(exportedTree2, null, 2))
    console.log(SEP)

    const tree3 = new DeepHistory(exportedTree2);
    tree3.chunkArray = tree2.chunkArray; // copy over the frozen chunks
    tree3.top = tree2.top; // copy over the top (reference is fine for testing purposes)

    if (DBG2) console.log(SEP, "TREE 3 top:\n", tree3.top, SEP)
    add_N = MAX_MESSAGE_SET_SIZE * (MESSAGE_HISTORY_BRANCH_FACTOR * MESSAGE_HISTORY_BRANCH_FACTOR + 1)
    for (i = current_N; i < current_N + add_N; i++)
        tree.insert(randomMessage(i));
    console.log(SEP, `Reconstructed tree test, and added ${add_N} more`, _SEP)
    if (detail) {
        tree3.traverseValues();
        console.log(SEP)
        console.log(SEP, "Reconstructed tree structure test, iterated tree3, traversing values in REVERSE:", _SEP)
        tree3.traverseValues(undefined, true);
        console.log(SEP)
    }

    console.log(SEP, "Final 'packaged' tree structure (tree THREE):", _SEP)
    const exportedTree3 = tree3.export()
    console.log(exportedTree3)
    console.log(SEP)
    console.log("(JSON format, note that 'messages' are maps so not shown, and frozen chunks not expanded)")
    console.log(JSON.stringify(exportedTree3, null, 2))
    console.log(SEP)
    if (detail) {
        tree3.chunkArray.forEach((chunk, index) => {
            console.log(`Chunk ${index.toString().padStart(4, '0')}:`, chunk)
        });
        console.log(SEP_)
    }
}


if (import.meta.main) { // tells Deno not to run this in the test suite
    // printTestTree(MAX_MESSAGE_SET_SIZE * (MESSAGE_HISTORY_BRANCH_FACTOR + 1), true);
    // printTestTree(MAX_MESSAGE_SET_SIZE * (MESSAGE_HISTORY_BRANCH_FACTOR * MESSAGE_HISTORY_BRANCH_FACTOR + 1));    
    // printTestTree(MAX_MESSAGE_SET_SIZE * (MESSAGE_HISTORY_BRANCH_FACTOR * MESSAGE_HISTORY_BRANCH_FACTOR * MESSAGE_HISTORY_BRANCH_FACTOR + 1));
    printTestTree(MAX_MESSAGE_SET_SIZE * (MESSAGE_HISTORY_BRANCH_FACTOR * MESSAGE_HISTORY_BRANCH_FACTOR * MESSAGE_HISTORY_BRANCH_FACTOR * MESSAGE_HISTORY_BRANCH_FACTOR + 1));

    // printTestTree(MAX_MESSAGE_SET_SIZE * ((MESSAGE_HISTORY_BRANCH_FACTOR + MESSAGE_HISTORY_BRANCH_FACTOR + 1) * MESSAGE_HISTORY_BRANCH_FACTOR + 1));    

    // printTestTree(MAX_MESSAGE_SET_SIZE * (MESSAGE_HISTORY_BRANCH_FACTOR - 1), true);

}

