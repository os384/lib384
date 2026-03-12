// (c) 2024 384 (tm)

const DBG0 = false
const DBG1 = false
const DBG2 = false

const _SEP_ = '='.repeat(76)
const SEP = '\n' + _SEP_ + '\n'

// const _SEP = '\n' + _SEP_
// const SEP_ = _SEP_ + '\n'

// import { AsyncSequence } from "../utils/AsyncSequence"

// @internal
export const TEST_WITH_SMALL_BRANCHING = false // if true, will use NON PRODUCTION settings for DeepHistory
if (TEST_WITH_SMALL_BRANCHING && !(DBG0 || DBG1)) throw new Error("TEST_WITH_SMALL_BRANCHING is set, but DBG0 or DBG1 is not set");

// all (value) nodes are indexed with strings; and they are always sorted etc
/** @internal */
export interface TreeNodeValueType {
  type: 'messageHistory',
  from: string,
  to: string,
  count: number,
}

/** @internal */
export class HistoryTreeNode<FrozenType> {

  // it's either one or the other of these arrays, but merging the types will
  // lead to convoluted code (eg type guards for constructed vs generic types).
  childrenNodes: HistoryTreeNode<FrozenType>[] = [];
  childrenValues: TreeNodeValueType[] = [];

  from: string | undefined = undefined;
  to: string | undefined = undefined;
  count: number = 0;
  isFull: boolean = false;
  height: number = 1;
  frozenChunkId: FrozenType | undefined = undefined; // if we're frozen at this point, this is the chunk number

  constructor(
    public isLeaf: boolean = false // if true, children array has TreeNodeValueType members, otherwise TreeNode members
  ) { }

  // Inserts a value (will always succeed). Will handle any partial freezing or merging of nodes.
  async insertTreeNodeValue(
    root: HistoryTree<FrozenType>,
    value: TreeNodeValueType
  ): Promise<void> {
    if (this.isFull) throw new Error("Should not be inserting here")
    const { count, from, to } = value
    this.count += count; // we are always the destination of the count
    if (isNil(this.from) !== isNil(this.to)) throw new Error("Internal Error (L52)") // we start with either both or neither
    if (isNil(this.from) || isNil(this.to)) { // we have not been initialized
      this.from = from;
      this.to = to;
    } else if (to > this.to) { // we have existing values, so new value must be 'larger' (newer)
      this.to = to;
    } else {
      throw new Error("Internal Error (L59)") // we should not be inserting 'older' values
    }
    if (this.isLeaf) {
      if (DBG0) console.log("We are a leaf, ergo we insert the value as a child")
      if (DBG1) console.log(value)
      this.childrenValues.push(value);
      if (this.childrenValues.length === root.branchFactor) {
        if (DBG0) console.log("... that was the last value child we have room for, so, we freeze ('leaf')")
        this.isFull = true;
        const x = this.export()
        this.frozenChunkId = await root.freeze(x)
        this.childrenValues.length = 0; // coldsleep, all of them, look out for Steel
        if (DBG1) console.log(SEP, "How 'we' look like after freezing:\n", this, SEP)
      }
      if (DBG2) console.log("... done, result:\n", this)
    } else if (this.childrenNodes.length === 0 || this.childrenNodes[this.childrenNodes.length - 1].isFull) {
      if (DBG0) console.log("We either have no children, or they're all full")
      if (this.childrenNodes.length === root.branchFactor)
        throw new Error("Internal Error (L77)")
      const newNode = new HistoryTreeNode<FrozenType>(true); // always start with leaf node
      await newNode.insertTreeNodeValue(root, value);
      this.childrenNodes.push(newNode);
    } else {
      if (DBG0) console.log("We have children, and the last one is not full, pick last on our list and insert")
      await this.childrenNodes[this.childrenNodes.length - 1].insertTreeNodeValue(root, value);
      if (this.childrenNodes[this.childrenNodes.length - 1].isFull && this.childrenNodes.length === root.branchFactor) {
        if (DBG0) console.log("That filled up our last child, and we have a full set of children ...")
        let allEqual = true;
        let i = 0;
        for (i = 0; i < this.childrenNodes.length - 1; i++)
          if (this.childrenNodes[i].height !== this.childrenNodes[i + 1].height) {
            allEqual = false;
            break;
          }
        if (allEqual) {
          if (DBG0) console.log("... and they are all the same height, thus, we freeze ('node')")
          if (DBG1) console.log("... here is what we look like before freezing:\n", this)
          this.isFull = true;
          this.frozenChunkId = await root.freeze(this.export());
          this.childrenNodes.length = 0; // coldsleep, all of them, look out for Steel
        } else {
          if (DBG0) console.log("... but they are not all the same height, so the 'right' side are shiftedn 'down'")
          // we know that child 'i+1' onwards are shorter than child 'i'; merge those into a new node
          const newChild = new HistoryTreeNode<FrozenType>();
          newChild.childrenNodes = this.childrenNodes.splice(i + 1);
          // we leverage that the leaves are always sorted 'left to right'
          newChild.count = newChild.childrenNodes.map(child => child.count).reduce((acc, val) => acc + val, 0);
          const newChildHeight = newChild.childrenNodes.map(child => child.height).reduce((acc, val) => Math.max(acc, val!), 0) + 1
          newChild.height = newChildHeight;
          newChild.from = newChild.childrenNodes[0].from;
          newChild.to = newChild.childrenNodes[newChild.childrenNodes.length - 1].to;
          this.childrenNodes.push(newChild);
        }
      }
    }
  }

  // this will traverse all entries, deFrost along the way as needed, and call the callback
  async traverse(
    root: HistoryTree<FrozenType>,
    callback: (node: HistoryTreeNode<FrozenType>) => Promise<void>,
    reverse = false
  ): Promise<void> {
    if (!reverse) await callback(this);
    if (!isNil(this.frozenChunkId)) {
      HistoryTreeNode.import<FrozenType>(await root.deFrost(this.frozenChunkId)).traverse(root, callback, reverse);
    } else {
      if (!reverse) for (const child of this.childrenNodes)
        await child.traverse(root, callback, reverse);
      else for (let i = this.childrenNodes.length - 1; i >= 0; i--)
        await this.childrenNodes[i].traverse(root, callback, reverse);
    }
    if (reverse) await callback(this);
  }

  async* _iterateValues(
    node: this,
    reverse = false,
    residualSkip: number
  ): AsyncIterableIterator<TreeNodeValueType> {
    if (DBG0) console.log("HistoryTreeNode._iterateValues")
    if (node.childrenValues.length > 0) {
      if (residualSkip > node.childrenValues.length)
        return residualSkip - node.childrenValues.length;
      if (node.childrenValues.length > 0) {
        const valuesArray = (reverse ? node.childrenValues.slice().reverse() : node.childrenValues).slice(residualSkip);
        for (const value of valuesArray)
          yield value;
        return 0;
      }
    }
    return residualSkip;
  }

  /**
   * Asynchronously traverses all entries in the tree, defrosting
   * as needed, calling _iterateValues() on each.
   */
  async *traverseGenerator(
    root: HistoryTree<FrozenType>,
    from: string,
    to: string,
    reverse: boolean = false,
    residualSkip: number /* = 0 */
  ): AsyncIterableIterator<TreeNodeValueType> {
    if (!root) throw new Error("Internal Error (L165)")
    if (DBG0) console.log("HistoryTreeNode.traverseGenerator")
    if (residualSkip >= this.count) return residualSkip - this.count;
    if (!reverse) residualSkip = yield* this._iterateValues(this, reverse, residualSkip);
    if (!isNil(this.frozenChunkId)) {
      const frozenData = await root.deFrost(this.frozenChunkId);
      const importedNode = HistoryTreeNode.import<FrozenType>(frozenData);
      return residualSkip = yield* importedNode.traverseGenerator(root, from, to, reverse, residualSkip);
    } else {
      if (DBG0) console.log("HistoryTreeNode.traverseGenerator, childrenNodes.length", this.childrenNodes.length)
      if (reverse) {
        for (let i = this.childrenNodes.length - 1; i >= 0; i--)
          return yield* this.childrenNodes[i].traverseGenerator(root, from, to, reverse, residualSkip);
      } else {
        for (const child of this.childrenNodes)
          return yield* child.traverseGenerator(root, from, to, reverse, residualSkip);
      }
    }
    if (reverse) residualSkip = yield* this._iterateValues(this, reverse, residualSkip);
    return 0;
  }

  async *traverseValuesGenerator(
    root: HistoryTree<FrozenType>,
    from: string,
    to: string,
    reverse: boolean = false,
    residualSkip: number = 0
  ): AsyncIterableIterator<TreeNodeValueType> {
    if (!root) throw new Error("Internal Error (L192)")
    if (DBG0) console.log("HistoryTreeNode.traverseValuesGenerator")
    yield* this.traverseGenerator(root, from, to, reverse, residualSkip)
  }


  // very picky validator, available for test suites (not called during normal
  // operation). Will throw an error if anything is amiss. note that this will
  // not recurse into frozen nodes.
  async validate(root: HistoryTree<FrozenType>, valueSize: number = 1): Promise<void> {

    // but checks if height is unnecessarily high; the log of count to the
    // base of branch factor should be within '1' of height.
    function heightError(height: number, count: number): boolean {
      if (isNil(count) || count <= 1) return false;
      const actualCount = count / valueSize; // account for TreeNodeValueType count of items
      const exponent = Math.log(actualCount) / Math.log(root.branchFactor)
      const result = (Math.abs(exponent - height) > (1 + 1e-10)) // avoid floating point imperfections
      if (result)
        console.log(SEP, "Height error found.\nheight =", height, ", count =", count,
          ", actualCount =", actualCount, ", exponent =",
          exponent, ", Math.floor(exponent) =", Math.floor(exponent),
          ", branch =", root.branchFactor, ", branch ** height =", root.branchFactor ** height, SEP);
      return result;
    }

    let errorList = "";
    if (isNil(this.from) !== isNil(this.to)) errorList += "[1]"
    if ((this.childrenValues.length > 0) && (this.childrenNodes.length > 0)) errorList += "[2]" // can't both be empty
    if (this.childrenValues.length !== 0 || this.childrenNodes.length !== 0) {
      if (isNil(this.from)) errorList += "[3]"
      if (this.count === 0) errorList += "[4]"
    }
    if (this.childrenValues.length > 0) {
      const childrenCount = this.childrenValues.map(child => child.count).reduce((acc, val) => acc + val, 0);
      if (this.count !== childrenCount) errorList += "[5]"
      if (this.height !== 1) errorList += "[6]"
    }
    if (this.childrenNodes.length > 0) {
      // check that all children have a height value
      if (this.childrenNodes.map(child => child.height).some(height => isNil(height) || height === 0)) errorList += "[7]"
      // traverse all children and calculate MAX height among them
      const maxChildHeight = this.childrenNodes.map(child => child.height).reduce((acc, val) => Math.max(acc, val!), 0);
      if (this.height !== maxChildHeight + 1) errorList += "[8]"
    }
    if (!isNil(this.frozenChunkId)) {
      if (this.childrenValues.length > 0) errorList += "[9]"
      if (this.childrenNodes.length > 0) errorList += "[10]"
    }
    if (this.count === (root.branchFactor ** this.height)) {
      // if it's a 'perfect' node, then it should have ended up perfectly
      // balanced, and full, ergo frozen.
      if (this.childrenValues.length > 0) errorList += "[11]"
      if (this.childrenNodes.length > 0) errorList += "[12]"
      if (isNil(this.frozenChunkId)) errorList += "[13]"
      if (!this.isFull) errorList += "[14]"
    }

    if (heightError(this.height, this.count)) errorList += "[15]"
    if (this.childrenNodes.length >= 2) {
      // check that all 'from' and 'to' values make sense
      for (let i = 0; i < this.childrenNodes.length - 1; i++) {
        if (isNil(this.childrenNodes[i].to) || isNil(this.childrenNodes[i + 1].to)) errorList += "[16]"
        if (isNil(this.childrenNodes[i].from) || isNil(this.childrenNodes[i + 1].from)) errorList += "[17]"
        if (this.childrenNodes[i].to! >= this.childrenNodes[i + 1].from!) errorList += "[18]"
      }
    }
    if (errorList !== "") {
      console.error(SEP, "Validation failed: " + errorList, SEP)
      if (DBG0) console.log(this, SEP)
      throw new Error("Validation failed: " + errorList)
    }
    if (this.childrenNodes.length > 0) {
      for (const child of this.childrenNodes)
        await child.validate(root, valueSize);
    }
  }

  async _callbackValues(
    node: HistoryTreeNode<FrozenType>,
    _nodeCallback?: (value: TreeNodeValueType) => Promise<void>,
    reverse = false
  ): Promise<void> {
    if (node.childrenValues.length > 0) {
      const valuesArray = reverse ? node.childrenValues.slice().reverse() : node.childrenValues;
      for (const value of valuesArray) {
        if (!isNil(_nodeCallback)) {
          await _nodeCallback(value);
        } else {
          if (DBG0) console.log(value);
        }
      }
    }
  }

  async traverseValues(
    root: HistoryTree<FrozenType>,
    callback?: (value: TreeNodeValueType) => Promise<void>,
    reverse = false
  ): Promise<void> {
    return this.traverse(root, async node => await this._callbackValues(node, callback, reverse), reverse);
  }



  export(): any {
    let retVal: any = { from: this.from, to: this.to, count: this.count, height: this.height }
    if (this.isFull) retVal.isFull = true; // omit if false (default)
    if (!isNil(this.frozenChunkId)) {
      retVal = { ...retVal, frozenChunkId: this.frozenChunkId }
    } else if (this.childrenValues.length > 0) {
      retVal = { ...retVal, isLeaf: true, children: this.childrenValues }
    } else if (this.childrenNodes.length > 0)
      retVal = {
        ...retVal, children: this.childrenNodes.map(child => child.export())
      }
    return retVal;
  }

  static import<FrozenType>(
    data: any
  ): HistoryTreeNode<FrozenType> {
    if (DBG1) console.log("importing data:", data)
    const node = new HistoryTreeNode<FrozenType>(data.isLeaf);
    node.from = data.from;
    node.to = data.to;
    node.count = data.count;
    node.height = data.height;
    if (!isNil(data.frozenChunkId)) {
      node.frozenChunkId = data.frozenChunkId;
      node.isFull = true;
    } else if (data.isLeaf) {
      node.isFull = data.isFull;
      node.childrenValues = data.children;
    } else {
      node.isFull = data.isFull;
      if (data.children && data.children.length > 0)
        node.childrenNodes = data.children.map((child: any) => HistoryTreeNode.import(child));
    }
    return node;
  }

}

// true if value is null or undefined. less confusing than using '==' in code.
function isNil(value: any): value is null | undefined {
  return value == null; // deliberate use of '==' (do not use '===')
}

/**
* Handles an arbitrary number of entries. An entry is of type 'TreeNodeValueType'; it
* will contain, or reference, some set of items, which 'HistoryTree' doesn't
* care about per se. Every set is characterized by having a population count
* ('count'), and a range of index (key) values, ranging from 'from' to 'to',
* inclusive. These indexes are of type 'string' (typically number or
* string).
* 
* 'count' of zero is not permitted, and similarly both 'from' and 'to' must
* have values (they are allowed to be the same).
*
* Note that 'TreeNodeValueType' is assumed to be compact.
*
* Only insertion of 'larger' values are permitted; the 'from' index must be
* greater than the highest 'to' value in the tree, and also may not overlap.
* 
* 'branchFactor' is self explanatory. If created with 'data', that in turn
* is assumed to be the (exact) same format as a previously exported tree.
*
* @internal
*/
export abstract class HistoryTree<FrozenType> {
  root: HistoryTreeNode<FrozenType> = new HistoryTreeNode<FrozenType>(true)
  abstract freeze(data: HistoryTreeNode<FrozenType>): Promise<FrozenType>
  abstract deFrost(data: FrozenType): Promise<HistoryTreeNode<FrozenType>>
  private insertOrValidateLock = false;
  private residualSkip = 0;
  constructor(public branchFactor: number, data?: any) {
    if (DBG2) console.log("branchFactor", branchFactor, "data", data)
    // super({
    //   [Symbol.asyncIterator]: () => this.spawn(),
    // });
    if (data)
      this.root = HistoryTreeNode.import(data);

  }
  async insertTreeNodeValue(value: TreeNodeValueType): Promise<void> {
    if (this.insertOrValidateLock) throw new Error("Insertion or validation already in progress (these operations are not parallelized, are you missing an 'await'?)")
    this.insertOrValidateLock = true;
    const { count, from, to } = value;
    if (DBG1) console.log("inserting value:", value, "count:", count, "from:", from, "to:", to)
    if (!isNil(this.root.to) && from <= this.root.to)
      throw new Error(`Insertion 'from' index ('${from}') must be greater than the highest 'to' value in the tree (currently '${this.root.to}')`)
    if (this.root.isFull) {
      if (DBG0) console.log("ROOT is full, we need to create a new root, push current root to first child")
      const newRoot = new HistoryTreeNode<FrozenType>();
      newRoot.from = this.root.from;
      newRoot.to = this.root.to;
      newRoot.count = this.root.count;
      newRoot.height = this.root.height + 1;
      newRoot.childrenNodes.push(this.root);
      this.root = newRoot;
    }
    if (DBG1) console.log("... inserting value from root on down")
    await this.root.insertTreeNodeValue(this, value);
    this.insertOrValidateLock = false;
  }
  async traverse(callback: (node: HistoryTreeNode<FrozenType>) => Promise<void>, reverse = false): Promise<void> {
    return this.root.traverse(this, callback, reverse);
  }
  async traverseValues(callback?: (value: TreeNodeValueType) => Promise<void>, reverse = false): Promise<void> {
    return this.root.traverseValues(this, callback, reverse);
  }
  async *traverseValuesGenerator(
    from: string,
    to: string,
    reverse = false
  ): AsyncIterableIterator<TreeNodeValueType> {
    if (DBG0) console.log("HistoryTree.traverseValuesGenerator")
    yield* this.root.traverseValuesGenerator(this, from, to, reverse, this.residualSkip);
  }

  skip(count: number): HistoryTree<FrozenType> {
    this.residualSkip += count;
    return this;
  }

  // async *spawn() {
  //   yield* this.traverseValuesGenerator();
  // }

  async validate(valueSize?: number): Promise<void> {
    if (this.insertOrValidateLock) throw new Error("Validation or insertion already in progress (these operations are not parallelized, are you missing an 'await'?)")
    this.insertOrValidateLock = true;
    if (isNil(this.root)) throw new Error("Root missing (Internal Error)")
    await this.root.validate(this, valueSize);
    this.insertOrValidateLock = false;
  }
  get from(): string | undefined {
    if (isNil(this.root)) return undefined;
    return this.root.from;
  }
  get to(): string | undefined {
    if (isNil(this.root)) return undefined;
    return this.root.to;
  }
  export(): any {
    if (this.root)
      return this.root.export();
    else return {};
  }
}
