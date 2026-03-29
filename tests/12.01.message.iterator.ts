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
const runName = "unit_test_12_01_run06"

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, Channel, Message, ChannelHandle, SBUserPrivateKey } from "../dist/384.esm.js"

const SEP = '\n' + '='.repeat(76) + '\n'
// const SEP_ = '='.repeat(76) + '\n'

let SB: ChannelApi

import { LocalStorage } from './test.utils.ts'
const localStorage = new LocalStorage('./.local.data.json');

async function getTest_12_01_handle(budgetKey: SBUserPrivateKey): Promise<ChannelHandle> {
    console.log("getTest_12_01_handle budget key (if needed)", budgetKey)
    let testHandle = localStorage.getItem(configuration.channelServer + '_' + runName)
    if (testHandle) {
        console.log("getTest_12_01_handle (found in local storage)", testHandle)
        return JSON.parse(testHandle)
    }
    else {
        const budgetChannel = await (new Channel(budgetKey)).ready
        const newHandle = await budgetChannel.budd()
        localStorage.setItem(configuration.channelServer + '_' + runName, JSON.stringify(newHandle))
        return newHandle
    }
}

let channelHandle: ChannelHandle

async function connectToChannel() {
    channelHandle = await getTest_12_01_handle(configuration.budgetKey)
    console.log(SEP, "Channel handle:", channelHandle)
}

interface MessageStreamOptions {
    start?: number;
    end?: number;
    live?: boolean;
}

// Lazy generator to produce messages based on given options
async function* messageStream(
    messageMap: Map<string, Message>,
    options: MessageStreamOptions
): AsyncIterable<Message> {
    const { start = 0, end = Infinity } = options;
    const forward = end >= start;

    const messages = Array.from(messageMap.values());

    console.log(SEP, "messageStream() options:", options, ".. forward?", forward, SEP);

    const filteredMessages = messages.filter(
        (msg) => {
            if (forward) {
                return (msg.serverTimestamp >= start) && (msg.serverTimestamp <= end);
            } else {
                return (msg.serverTimestamp <= start) && (msg.serverTimestamp >= end);
            }
        }
    );

    const sortedMessages = forward
        ? filteredMessages.sort((a, b) => a.serverTimestamp - b.serverTimestamp)
        : filteredMessages.sort((a, b) => b.serverTimestamp - a.serverTimestamp);

    // console.log(SEP, "Filtered and sorted messages:", sortedMessages);

    for (const message of sortedMessages)
        yield message;

    // TODO: and here we'll add web socket
    // if (forward && options.live) {
    //     while (true) {
    //         const liveMessage = await waitForNewMessage(); // Simulate new incoming message
    //         yield liveMessage;
    //     }
    // }
}


// // Simulated function to fetch new live messages
// async function waitForNewMessage(): Promise<TestMessage> {
//     await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate delay
//     const newMessage = {
//         timestamp: Date.now(),
//         content: `Live message at ${Date.now()}`,
//     };
//     messages.push(newMessage); // Add to the global message list
//     return newMessage;
// }

class MessageSequence extends AsyncSequence<Message> {
    constructor(private channelWrapper: ChannelWrapper, options: MessageStreamOptions = {}) {
        // Define the source as an async generator
        const source = (async function* () {

            const channel = await SB.connect(channelHandle).ready

            const messageKeys = await channel.getMessageKeys()

            const { start = 0, end = Infinity } = options;
            const forward = end >= start;

            console.log(SEP, "[MessageSequence] messageStream() options:", options, ".. forward?", forward, SEP);
            let messages = new Map<string, Message>()
            const chunkSize = 64
            const keyArray = Array.from(messageKeys.keys())
            for (let i = 0; i < keyArray.length; i += chunkSize) {
                // note: currently not much point doing this in parallel since it'll hit the same DO
                const chunk = keyArray.slice(i, i + chunkSize)
                const chunkMessages = await channel.getMessageMap(new Set(chunk))
                // console.log(SEP, `Received ${chunkMessages.size} messages in chunk ${i / chunkSize + 1} of ${Math.ceil(keyArray.length / chunkSize)} ...`, SEP, chunkMessages, SEP)
                messages = new Map([...messages, ...chunkMessages])
            }
            console.log(SEP, `[MessageSequence] Received ${messages.size} recent messages`, SEP)

            const messageArray = Array.from(messages.values());

            const filteredMessages = messageArray.filter(
                (msg) => {
                    if (forward) {
                        return (msg.serverTimestamp >= start) && (msg.serverTimestamp <= end);
                    } else {
                        return (msg.serverTimestamp <= start) && (msg.serverTimestamp >= end);
                    }
                }
            );

            const sortedMessages = forward
                ? filteredMessages.sort((a, b) => a.serverTimestamp - b.serverTimestamp)
                : filteredMessages.sort((a, b) => b.serverTimestamp - a.serverTimestamp);

            // console.log(SEP, "Filtered and sorted messages:", sortedMessages);

            for (const message of sortedMessages)
                yield message;


        })();

        // Initialize the base AsyncSequence with the custom source
        super(source);
    }

    // You can add MessageSequence-specific methods here if needed
}


class ChannelWrapper extends Channel {
    channelWrapperReady: Promise<ChannelWrapper>
    static ReadyFlag = Symbol('ChannelWrapperReadyFlag');
    constructor(h: ChannelHandle) {
        super(h);
        this.channelWrapperReady =
            this.channelReady
                .then(async () => {
                    (this as any)[ChannelWrapper.ReadyFlag] = true;
                    return this;
                })
                .catch((e) => { throw e; });
    }
    get ready() { return this.channelWrapperReady }

    async spawn(options: MessageStreamOptions = {}): Promise<AsyncSequence<Message>> {
        // const messageMap = await this.channel.getMessageMap()
        // return new AsyncSequence(messageStream(messageMap, options))

        return new MessageSequence(this, options);

        // const options: MessageStreamOptions = {
        //     start: 1728683628542,
        //     end: 0,
        //     count : 5
        // };

        // const options: MessageStreamOptions = {
        //     start: 1728683628542,
        // };


    }

}

async function addSomeMessages(channel: Channel | ChannelWrapper, count = 5) {
    const stateKey = runName + '_kv_state';

    // make sure state is set up
    let state = await channel.get(stateKey)
    if (!state) {
        console.log(SEP, "State not found, creating ...")
        state = { counter: 0 }
        await channel.put(stateKey, state)
    }
    console.log(SEP, `State ['${stateKey}']:`, '\n', state)

    console.log(SEP, "Sending messages ...")
    for (let i = state.counter; i < state.counter + count; i++) {
        // const msgText = `Message ${i} - ` + Date.now()
        const msgText = `Message ${i.toString().padStart(6, ' ')} - [client timestamp ` + Date.now() + ']'
        console.log("... sending message:", msgText)
        const r = await channel.send({ msg: msgText })
        console.log("... sent message, return code:", r)
    }
    state.counter += count
    await channel.put(stateKey, state)
}

async function runTest01() {
    const COUNT = 3 // number of new messages to add each time

    console.log(SEP, "Running test 01 ...")

    try {

        const channel = await SB.connect(channelHandle).ready

        // add some messages
        await addSomeMessages(channel, COUNT)

        // lets fetch all messages
        console.log(SEP, "Fetching all message keys using getMessageKeys() ...", SEP)
        const messageKeys = await channel.getMessageKeys()
        console.log(SEP, `Found ${messageKeys.size} recent messages`, SEP)

        if (messageKeys.size > 15) {
            const firstFive = Array.from(messageKeys.keys()).slice(0, 5)
            const lastFive = Array.from(messageKeys.keys()).slice(-5)
            // convert them back to sets
            const firstFiveSet = new Set(firstFive)
            const lastFiveSet = new Set(lastFive)
            const subset = new Set([...firstFiveSet, '...  ', `... another ${messageKeys.size - 10} keys ...`, '...   ', ...lastFiveSet])
            console.log(SEP, `Fetching messages using getMessageMap(.. ${messageKeys.size} entries ..) ...`, SEP, subset, SEP)
        } else {
            console.log(SEP, `Fetching messages using getMessageMap(.. ${messageKeys.size} entries ..) ...`, SEP, messageKeys, SEP)
        }

        // 'getMessageMap' is limited to no more than ChannelApi.MAX_MESSAGE_REQUEST_SIZE (100) keys per query, so we need to do it in chunks
        let messages = new Map<string, Message>()
        const chunkSize = 64
        const keyArray = Array.from(messageKeys.keys())
        for (let i = 0; i < keyArray.length; i += chunkSize) {
            // note: currently not much point doing this in parallel since it'll hit the same DO
            const chunk = keyArray.slice(i, i + chunkSize)
            const chunkMessages = await channel.getMessageMap(new Set(chunk))
            // console.log(SEP, `Received ${chunkMessages.size} messages in chunk ${i / chunkSize + 1} of ${Math.ceil(keyArray.length / chunkSize)} ...`, SEP, chunkMessages, SEP)
            messages = new Map([...messages, ...chunkMessages])
        }
        console.log(SEP, `Received ${messages.size} recent messages:`, SEP)



    } catch (e) {
        console.error("[runTest01] Caught exception:", e)
    }


}

async function runTest02() {

    // wrapper inherits from Channel, just adds 'spawn()' method
    const chWrapper = await new ChannelWrapper(channelHandle).ready

    // every time we run the test, add some messages
    await addSomeMessages(chWrapper, 5)

    // tell spawn() what time period we want to look at (server time stamps),
    // and whether we want to keep getting new messages as they arrive (in case
    // we end up at the 'current' endpoint)
    const options: MessageStreamOptions = {
        start: 1728768726250,
        // end: Infinity,
        // live: true,
    };

    // const messageGen = await chWrapper.spawn(options)

    // you can just create a sequence on the fly
    (await chWrapper.spawn(options))

        // restricts to messages BEFORE the given time (inclusive)
        .takeWhile(async (m) => m.serverTimestamp <= 1728768889477)

        // restricts to messages AFTER the given time
        // .skipWhile(async (m) => m.serverTimestamp <= 1728768889477)

        // note, above is just to demonstrate, if you were actually constraining
        // on time stamp you should use the options in the 'spawn()' call

        // you can modify things along the way
        .map(async (m) => {
            m.body.msg += ` [${m.serverTimestamp - m.senderTimestamp}ms]`
            return m;
        })

        // actually we want to skip a few
        .skip(6)

        // and wherever we end up, just want to look at 8 of them
        .take(8)

        // we want to insert a timeout here, so that if for some reason we
        // don't get any messages, we don't wait forever, but not otherwise
        // interfere with the stream, implement using map
        .map(async (m) => {
            const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
        })

        // you'll need a 'consumer' at the end
        .forEach(async (m) => {
            console.log("Reading message:", m.body);
        });

    // if you want to store the sequence for later use, you can use the for-await patterns:
    // for await (const m of messageGen) {
    //     console.log("Reading message:", m.body);
    // }
}




// // Usage example with functional composition
// async function runTestNN(options: MessageStreamOptions): Promise<void> {
//     console.log(SEP, "Running test ..."); console.log(SEP);

//     const messageGen = new AsyncSequence(messageStream(options))
//         // example of a processing pipeline, first a transformation
//         .map(async (msg) => ({
//             ...msg,
//             content: `Processed: ${msg.content}`,
//         }))
//         // then a filter
//         .filter(async (msg) => msg.timestamp > 0)
//         // // then a logger that does not change the message
//         // .map(async (msg) => {
//         //     console.log("... streaming processing of message:", msg);
//         //     return msg;
//         // })
//         // then a 'guard' to limit the number of messages (which might be 'infinte')
//         .take(options.count); // limit

//     // now let's consume this iterator, but, we will only print out the first three, then stop (finish the stream)
//     console.log(SEP, "Consuming the message stream, with early exit:");
//     let count = 0;
//     for await (const m of messageGen) {
//         console.log("Consumed message:", m);
//         count++;
//         if (count >= 3) break;
//     }


//     // // To array to visualize processed results
//     // const result = await messageGen.toArray();
//     // console.log(SEP, "Result of getting it as an array:\n", result);

//     // // If we wanted to reduce, we could do:
//     // const reducedResult = await messageGen.reduce(
//     //     async (acc, msg) => acc + msg.timestamp,
//     //     0
//     // );
//     // console.log(SEP, `Reduced result (sum of timestamps): ${reducedResult}`);
// }



// // if used by "deno test ...", calls this:
// Deno.test("[slow] [channel] minimalist channel creation test", async () => {
//     console.log('\n===================== 04.04 START channel test =====================')
//     SB = new ChannelApi(configuration.channelServer, configuration.DBG)
//     await connectToChannel()
//     await ChannelApi.closeAll()
//     console.log('\n===================== 04.04 END channel test   =====================')
// });

// @ts-ignore
if (import.meta.main) {

    throw new Error("This is residual code")

    // SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    // await connectToChannel()

    // // await runTest01()
    // await runTest02()

    // console.log(SEP, "Main done ...", SEP)




    // let options: MessageStreamOptions = {}

    // // test 1
    // options = {
    //     start: 18,
    //     count: 5,
    //     live: true,
    // };
    // console.log(SEP, "Test 1:", options);
    // runTest(options);

    // // test 2
    // options = {
    //     start: 20,
    //     end: 12,
    // };
    // console.log(SEP, "Test 2:", options);
    // runTest(options);


}







/**
    *
    * More operations on an async sequence of items, to consider in the future:
    *
    * - fold()        : similar to 'reduce()', but with an initial value
    * - peek()        : allows to inspect each element in the sequence, without modifying it
    * - tap()         : alias for 'peek()'
    * - sum()         : sums the elements in the sequence
    * - average()     : calculates the average of the elements in the sequence
    * - min()         : finds the minimum element in the sequence
    * - max()         : finds the maximum element in the sequence
    * - findLast()    : finds the last element that matches a predicate
    * - indexOf()     : finds the index of the first element that matches a predicate
    * - lastIndexOf() : finds the index of the last element that matches a predicate
    * - contains()    : checks if the sequence contains an element (requires comparator)
    * - distinct()    : removes duplicates from the sequence
    * - distinctBy()  : removes duplicates from the sequence, based on a key selector
    * - groupBy()     : groups elements in the sequence by a key
    * - groupJoin()   : joins two sequences based on a key
    * - intersect()   : finds the intersection of two sequences
    * - except()      : finds the difference of two sequences
    * - union()       : finds the union of two sequences
    * - orderBy()     : orders the elements in the sequence
    * - orderByDescending() : orders the elements in the sequence in descending order
    * - reverse()     : reverses the elements in the sequence
    * - shuffle()     : shuffles the elements in the sequence
    * - first()       : finds the first element in the sequence
    * - last()        : finds the last element in the sequence
    * - single()      : finds the single element in the sequence
    * - elementAtOrDefault() : finds the element at a specific index, or a default value
    * - firstOrDefault()     : finds the first element in the sequence, or a default value
    * - lastOrDefault()      : finds the last element in the sequence, or a default value
    * - singleOrDefault()    : finds the single element in the sequence, or a default value
    * - elementAtOrElse()    : finds the element at a specific index, or a computed default value
    * - firstOrElse()        : finds the first element in the sequence, or a computed default value
    * - lastOrElse()         : finds the last element in the sequence, or a computed default value
    * - singleOrElse()       : finds the single element in the sequence, or a computed default value
    * - toList()     : converts the sequence to a list
    * - toSet()      : converts the sequence to a set
    * - toMap()      : converts the sequence to a map
 */
