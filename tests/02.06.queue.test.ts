#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

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
import { MessageQueue } from "../dist/384.esm.js";

import { assert, assertEquals } from "@std/assert";

const VERBOSE = false;

async function testQueueEnqueueDequeue() {
    console.log("Test: Enqueue and Dequeue Operations");

    const queue = new MessageQueue<number>();
    queue.enqueue(1);
    queue.enqueue(2);

    const firstItem = await queue.dequeue();
    const secondItem = await queue.dequeue();

    if (firstItem !== 1 || secondItem !== 2) {
        console.error("Failed: Items dequeued do not match items enqueued.");
        return;
    }

    console.log("Passed: Enqueue and Dequeue Operations");
}

async function testQueueClose() {
    console.log("Test: Close Operation");

    const queue = new MessageQueue<string>();
    queue.enqueue("test");
    queue.close();

    try {
        await queue.enqueue("should fail");
    } catch (error) {
        console.log("Passed: Close Operation (cannot enqueue to closed queue)");
        return;
    }

    console.error("Failed: Was able to enqueue to a closed queue.");
}

async function testQueueStress() {
    console.log("Test: Stress Test");

    const queue = new MessageQueue<number>();
    const enqueueCount = 10000;
    // const dequeuePromises = [];
    const dequeuePromises: Promise<number | null>[] = [];


    for (let i = 0; i < enqueueCount; i++) {
        queue.enqueue(i);
    }

    for (let i = 0; i < enqueueCount; i++) {
        dequeuePromises.push(queue.dequeue());
    }

    const results = await Promise.all(dequeuePromises);
    for (let i = 0; i < enqueueCount; i++) {
        if (results[i] !== i) {
            console.error(`Failed: Stress Test, item mismatch at index ${i}`);
            return;
        }
    }

    console.log("Passed: Stress Test");
}

async function testRandomEnqueueDequeue() {
    const queue = new MessageQueue<number>();
    let COUNT = 100;
    let enqueueCount = 0;
    let dequeueCount = 0;
    console.log("Random Enqueue or Dequeue Stress Test")

    while (enqueueCount < COUNT || dequeueCount < COUNT) {
        if (Math.random() > 0.5) {
            if (enqueueCount < COUNT) {
                // console.log(`Enqueued: ${enqueueCount}`)
                queue.enqueue(enqueueCount++);
            }
        } else {
            if (dequeueCount < enqueueCount && dequeueCount < COUNT) {
                const item = await queue.dequeue();
                // console.log(`Dequeued: ${item}`)
                assert(item !== null, "Dequeue attempted on empty queue.")
                assert(item === dequeueCount, `Dequeued item not correct: ${item}`);
                dequeueCount++;
            }
        }
    }

    // Assertions
    console.log(`Final counts - Enqueued: ${enqueueCount}, Dequeued: ${dequeueCount}`);
    assertEquals(enqueueCount, dequeueCount, "The number of enqueued items should equal the number of dequeued items.");

    // Optionally, assert the queue is empty at the end
    assert(queue.isEmpty(), "The queue should be empty at the end of the test.")

    console.log("Done")
}

async function testConcurrentEnqueueDequeue() {
    const queue = new MessageQueue<number>();
    const itemCount = 100; // Total number of items to enqueue and dequeue
    // const operations = [];
    const operations = new Array<Promise<void>>();

    // Prepare enqueue operations
    for (let i = 0; i < itemCount; i++) {
        operations.push((async () => {
            // console.log(`Enqueueing item: ${i}`);
            queue.enqueue(i);
        })());
    }

    // Prepare dequeue operations
    for (let i = 0; i < itemCount; i++) {
        operations.push((async () => {
            const item = await queue.dequeue();
            // console.log(`Dequeued item: ${item}`);
        })());
    }

    // Run all operations concurrently
    await Promise.all(operations);

    console.log(`Completed ${operations.length} operations.`);
}

async function testMixedConcurrentEnqueueDequeue() {
    const queue = new MessageQueue<number>();
    const COUNT = 200; // Total number of operations, including both enqueue and dequeue
    const operations = new Array<Promise<void | number>>(); // Adjusted for enqueue (void) and dequeue (number)

    let enqueueCount = 0;
    let dequeueCount = 0;

    console.log("Random Enqueue or Dequeue Stress Test")

    while (enqueueCount < COUNT || dequeueCount < COUNT) {
        if (Math.random() > 0.5) {
            if (enqueueCount < COUNT) {
                operations.push((async (count) => {
                    // console.log(`Enqueueing item: ${count}`);
                    queue.enqueue(count);
                })(enqueueCount++));
            }
        } else {
            if (dequeueCount < enqueueCount && dequeueCount < COUNT) {
                operations.push((async (dequeueCount) => {
                    const item = await queue.dequeue();
                    assert(item !== null, "Dequeue attempted on empty queue.")
                    assert(item === dequeueCount, `Dequeued item not correct: ${item}, expected ${dequeueCount}`);
                })(dequeueCount++));
            }
        }
    }

    // Wait for all operations to complete
    const results = await Promise.all(operations);
    const dequeuedItems = results.filter(item => item !== undefined);

    console.log(`Operations completed. Enqueued: ${enqueueCount}, Dequeued: ${dequeueCount}, Dequeue attempts: ${dequeuedItems.length}`);

    // Assertions
    // Ensure all enqueued items have been dequeued
    assertEquals(enqueueCount, dequeueCount, "The number of enqueued items should equal the number of dequeued items.");
    // Optionally, verify the sequence of dequeued items if necessary
    // This part is left as an exercise since it depends on the expected behavior of your queue
    // For a FIFO queue, you could check if dequeuedItems are in sequence

    // Optionally, assert the queue is empty at the end
    assert(queue.isEmpty(), "The queue should be empty at the end of the test.");

    console.log("Done");
}

Deno.test("[fast] 02.06 Concurrency Test: Simultaneous Enqueues and Dequeues", async () => {
    await testConcurrentEnqueueDequeue();
});

// Add this test to Deno's test suite
Deno.test("[fast] 02.06 Concurrency Test: Simultaneous Enqueues and Dequeues", async () => {
    await testConcurrentEnqueueDequeue();
});


// Add this test to Deno's test suite
Deno.test("[fast] 02.06 Random Enqueue or Dequeue Stress Test", async () => {
    await testRandomEnqueueDequeue();
});

// Deno test integration
Deno.test("[fast] 02.06 MessageQueue Enqueue and Dequeue Operations", async () => {
    await testQueueEnqueueDequeue();
});

Deno.test("[fast] 02.06 MessageQueue Close Operation", async () => {
    await testQueueClose();
});

Deno.test("[fast] 02.06 MessageQueue Stress Test", async () => {
    await testQueueStress();
});



if (import.meta.main) {
    console.log('\n===================== 02.06 MessageQueue Tests Start =====================');
    await testMixedConcurrentEnqueueDequeue();
    await testConcurrentEnqueueDequeue();
    await testQueueEnqueueDequeue();
    await testQueueClose();
    await testQueueStress();
    await testRandomEnqueueDequeue();
    console.log('\n===================== 02.06 MessageQueue Tests End =====================');
}
