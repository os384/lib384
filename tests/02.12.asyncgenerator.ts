#!/usr/bin/env -S deno run

// an 'essential' demonstration/test of using the AsyncSequence class
// including an optimized skip method

// Define the type for elements stored in the tree
interface ElementType {
    id: number;
    data: string;
}

// Define the TreeNode interface
interface TreeNode {
    count: number; // Total number of elements in this subtree
    children?: TreeNode[]; // Child nodes (for internal nodes)
    elements?: ElementType[]; // Elements (for leaf nodes)
}

// Example Tree Structure
const exampleTree: TreeNode = {
    count: 10,
    children: [
        {
            count: 4,
            elements: [
                { id: 1, data: "A" },
                { id: 2, data: "B" },
                { id: 3, data: "C" },
                { id: 4, data: "D" },
            ],
        },
        {
            count: 6,
            children: [
                {
                    count: 3,
                    elements: [
                        { id: 5, data: "E" },
                        { id: 6, data: "F" },
                        { id: 7, data: "G" },
                    ],
                },
                {
                    count: 3,
                    elements: [
                        { id: 8, data: "H" },
                        { id: 9, data: "I" },
                        { id: 10, data: "J" },
                    ],
                },
            ],
        },
    ],
};

// generate a second tree that is same structure but different data,
// and particularly, ids start with 11 and the 'data' fields are double digit numbers
const exampleTree2: TreeNode = {
    count: 10,
    children: [
        {
            count: 4,
            elements: [
                { id: 11, data: "11" },
                { id: 12, data: "12" },
                { id: 13, data: "13" },
                { id: 14, data: "14" },
            ],
        },
        {
            count: 6,
            children: [
                {
                    count: 3,
                    elements: [
                        { id: 15, data: "15" },
                        { id: 16, data: "16" },
                        { id: 17, data: "17" },
                    ],
                },
                {
                    count: 3,
                    elements: [
                        { id: 18, data: "18" },
                        { id: 19, data: "19" },
                        { id: 20, data: "20" },
                    ],
                },
            ],
        },
    ],
};



import { AsyncSequence } from '../dist/384.esm.js';

/**
 * TreeSequence class that extends AsyncSequence to provide optimized skip functionality.
 */
class TreeSequence extends AsyncSequence<ElementType> {
    // private _skipUntil: number = 0; // Counter for elements to skip

    constructor(private tree: TreeNode) {
        // Initialize AsyncSequence with a custom iterator from spawn()
        super({
            [Symbol.asyncIterator]: () => this.spawn(),
        });
    }

    /**
     * Updates the skipUntil counter to skip the next 'count' elements.
     * @param count Number of elements to skip.
     * @returns The TreeSequence instance for chaining.
     */
    skip(count: number): TreeSequence {
        this.residualSkip += count;
        return this;
    }

    /**
     * Returns an AsyncGenerator that efficiently skips elements based on the skipUntil counter.
     */
    async *spawn(): AsyncGenerator<ElementType> {
        const stack: TreeNode[] = [this.tree]; // Stack for iterative traversal

        while (stack.length > 0) {
            const currentNode = stack.pop()!; // Get the last node from the stack

            if (currentNode.elements) {
                if (this.residualSkip > 0) console.log("[DEBUG] [TreeSequence] ... working through residual skip:", this.residualSkip);
                if (this.residualSkip >= currentNode.elements.length) {
                    // Skip entire chunk
                    this.residualSkip -= currentNode.elements.length;
                    continue;
                } else if (this.residualSkip > 0) {
                    // Skip part of the chunk
                    const skipCount = this.residualSkip;
                    this.residualSkip = 0;
                    for (let i = skipCount; i < currentNode.elements.length; i++) {
                        yield currentNode.elements[i] as ElementType; // Type assertion
                    }
                } else {
                    // No skipping needed, yield all elements
                    for (let i = 0; i < currentNode.elements.length; i++) {
                        yield currentNode.elements[i] as ElementType; // Type assertion
                    }
                }
            }

            if (currentNode.children) {
                // Push children to the stack in reverse order for correct traversal
                for (let i = currentNode.children.length - 1; i >= 0; i--) {
                    stack.push(currentNode.children[i]);
                }
            }
        }
    }

}

const SEP = '\n' + '='.repeat(76) + '\n'

async function test03() {
    console.log(SEP, "Test 03: Skip first 5 elements and then iterate, using 'for-await' syntax", SEP);
    for await (const element of (new TreeSequence(exampleTree).skip(5))) {
        console.log(element);
    }
}

async function test04() {
    console.log(SEP, "Test 05: inline TreeSequence", SEP);
    const sequence = new TreeSequence(exampleTree);
    sequence.skip(5); // Efficiently skips the first 5 elements

    await sequence.forEach((element) => {
        console.log(element);
    });
}

async function test05() {
    console.log(SEP, "Test 05: skip 5, then transform to lower case", SEP);
    await (new TreeSequence(exampleTree))
        .skip(5)
        .map((element) => ({ id: element.id, data: element.data.toLowerCase() }))
        .forEach((element) => {
            console.log(element);
        });
}

async function test06() {
    console.log(SEP, "Test 06", SEP);
    await (new TreeSequence(exampleTree))
        .elementAt(7)
        .then(console.log); // you can also just use 'console.log' here
}

async function test07() {
    console.log(SEP, "Test 07: skipping 13, testing optimization, and should have a '3' residual", SEP);
    const seq = new TreeSequence(exampleTree);
    await seq
        .skip(13)
        .forEach(console.log);
    console.log("Any skip residual:", seq.residualSkip);
}

// used for tests 08 and 09
const SKIP_COUNT = 12;

async function test08() {
    console.log(SEP, `Test 08: skip ${SKIP_COUNT} elements`, SEP);
    const skipCount = SKIP_COUNT

    const seq1 = new TreeSequence(exampleTree);
    const seq2 = new TreeSequence(exampleTree2);

    await seq1
        .skip(skipCount)
        .forEach(console.log);
    console.log("Skip residual from '1':", seq1.residualSkip);

    await seq2
        .skip(seq1.residualSkip)
        .forEach(console.log);
    console.log("Skip residual from '2':", seq2.residualSkip);
}

// same as 08 but uses 'concat()' method; note that this will NOT
// take advantage of any skip optimization in TreeSequence
async function test09() {
    console.log(SEP, "Test 09:uses 'concat()', same as 08 but because of 'concat()' it won't optimize", SEP);
    const skipCount = SKIP_COUNT

    const seq1 = new TreeSequence(exampleTree);
    const seq2 = new TreeSequence(exampleTree2);
    const seq = seq1.concat(seq2);

    await seq
        .skip(skipCount)
        .forEach(console.log);
}

// @ts-ignore
if (import.meta.main) {
    await test03();
    await test04();
    await test05();
    await test06();
    await test07();
    await test08();
    await test09();
    console.log(SEP, "Main done ...", SEP)
}


// OLDER code

// // Optimized AsyncSequence class
// class OptimizedAsyncSequence<T extends ElementType> extends AsyncSequence<T> {
//     constructor(private tree: TreeNode, generator: AsyncIterable<T>) {
//         super(generator);
//     }

//     // Basic Async Generator to traverse the tree and yield elements
//     async* traverseTree(node: TreeNode): AsyncGenerator<ElementType> {
//         if (node.elements) {
//             for (const element of node.elements) {
//                 console.log("[DEBUG] [traverseTree] Yielding element:", element);
//                 yield element;
//             }
//         } else if (node.children) {
//             for (const child of node.children) {
//                 yield* this.traverseTree(child);
//             }
//         }
//     }

//     // Override the skip method for optimization
//     skip(count: number): OptimizedAsyncSequence<T> {
//         console.log("[DEBUG] [OptimizedAsyncSequence] Skipping", count, "elements");
//         if (count <= 0) return this;
//         const self = this;
//         async function* optimizedSkippedGenerator() {
//             let remaining = count;

//             // Internal helper to traverse and skip
//             async function* traverseAndSkip(node: TreeNode): AsyncGenerator<T> {
//                 if (remaining <= 0) {
//                     // ERROR: Type 'ElementType' is not assignable to type 'Awaited<T>'.ts
//                     yield* this.traverseTree(node) as AsyncGenerator<T>;
//                     return;
//                 }

//                 if (node.elements) {
//                     if (remaining >= node.count) {
//                         remaining -= node.count;
//                         // Skip entire chunk
//                         return;
//                     } else {
//                         // Skip within the chunk
//                         for (let i = remaining; i < node.elements.length; i++) {
//                             // ERROR: Type 'ElementType' is not assignable to type 'Awaited<T>'.ts
//                             yield node.elements[i] as T;
//                         }
//                         remaining = 0;
//                     }
//                 } else if (node.children) {
//                     for (const child of node.children) {
//                         if (remaining <= 0) {
//                             // ERROR: Type 'ElementType' is not assignable to type 'Awaited<T>'.
//                             yield* this.traverseTree(child) as AsyncGenerator<T>;
//                             continue;
//                         }

//                         if (remaining >= child.count) {
//                             remaining -= child.count;
//                             // Skip entire child subtree
//                             continue;
//                         } else {
//                             // Partially skip within the child
//                             yield* traverseAndSkip(child);
//                         }
//                     }
//                 }
//             }

//             yield* traverseAndSkip(self.tree);
//         }

//         return new OptimizedAsyncSequence<T>(this.tree, optimizedSkippedGenerator());
//     }
// }

