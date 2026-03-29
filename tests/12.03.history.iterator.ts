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
export const runName = "unit_test_12_01_run09"

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, Channel, Message, ChannelHandle, ChannelStream, SBUserPrivateKey, AsyncSequence } from "../dist/384.esm.js"

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

// // Lazy generator to produce messages based on given options
// async function* messageStream(
//     messageMap: Map<string, Message>,
//     options: MessageStreamOptions
// ): AsyncIterable<Message> {
//     const { start = 0, end = Infinity } = options;
//     const forward = end >= start;

//     const messages = Array.from(messageMap.values());

//     console.log(SEP, "messageStream() options:", options, ".. forward?", forward, SEP);

//     const filteredMessages = messages.filter(
//         (msg) => {
//             if (forward) {
//                 return (msg.serverTimestamp >= start) && (msg.serverTimestamp <= end);
//             } else {
//                 return (msg.serverTimestamp <= start) && (msg.serverTimestamp >= end);
//             }
//         }
//     );

//     const sortedMessages = forward
//         ? filteredMessages.sort((a, b) => a.serverTimestamp - b.serverTimestamp)
//         : filteredMessages.sort((a, b) => b.serverTimestamp - a.serverTimestamp);

//     // console.log(SEP, "Filtered and sorted messages:", sortedMessages);

//     for (const message of sortedMessages)
//         yield message;

//     // TODO: and here we'll add web socket
//     // if (forward && options.live) {
//     //     while (true) {
//     //         const liveMessage = await waitForNewMessage(); // Simulate new incoming message
//     //         yield liveMessage;
//     //     }
//     // }
// }

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

    }

}

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

import { addSomeMessages } from './12.02.message.iterator.ts'

// async function runTest01() {
//     const COUNT = 3 // number of new messages to add each time
//     console.log(SEP, "Running test 01 ...")
//     try {
//         const channel = await SB.connect(channelHandle).ready
//         // add some messages
//         await addSomeMessages(channel, COUNT)
//         // lets fetch all messages
//         console.log(SEP, "Fetching all message keys using getMessageKeys() ...", SEP)
//         const messageKeys = await channel.getMessageKeys()
//         console.log(SEP, `Found ${messageKeys.size} recent messages`, SEP)
//         if (messageKeys.size > 15) {
//             const firstFive = Array.from(messageKeys.keys()).slice(0, 5)
//             const lastFive = Array.from(messageKeys.keys()).slice(-5)
//             // convert them back to sets
//             const firstFiveSet = new Set(firstFive)
//             const lastFiveSet = new Set(lastFive)
//             const subset = new Set([...firstFiveSet, '...  ', `... another ${messageKeys.size - 10} keys ...`, '...   ', ...lastFiveSet])
//             console.log(SEP, `Fetching messages using getMessageMap(.. ${messageKeys.size} entries ..) ...`, SEP, subset, SEP)
//         } else {
//             console.log(SEP, `Fetching messages using getMessageMap(.. ${messageKeys.size} entries ..) ...`, SEP, messageKeys, SEP)
//         }
//         // 'getMessageMap' is limited to no more than ChannelApi.MAX_MESSAGE_REQUEST_SIZE (100) keys per query, so we need to do it in chunks
//         let messages = new Map<string, Message>()
//         const chunkSize = 64
//         const keyArray = Array.from(messageKeys.keys())
//         for (let i = 0; i < keyArray.length; i += chunkSize) {
//             // note: currently not much point doing this in parallel since it'll hit the same DO
//             const chunk = keyArray.slice(i, i + chunkSize)
//             const chunkMessages = await channel.getMessageMap(new Set(chunk))
//             // console.log(SEP, `Received ${chunkMessages.size} messages in chunk ${i / chunkSize + 1} of ${Math.ceil(keyArray.length / chunkSize)} ...`, SEP, chunkMessages, SEP)
//             messages = new Map([...messages, ...chunkMessages])
//         }
//         console.log(SEP, `Received ${messages.size} recent messages:`, SEP)
//     } catch (e) {
//         console.error("[runTest01] Caught exception:", e)
//     }
// }

async function runTest02() {

    // wrapper inherits from Channel, just adds 'spawn()' method
    const chWrapper = await new ChannelWrapper(channelHandle).ready

    // every time we run the test, add some messages
    await addSomeMessages(3, chWrapper)

    // tell spawn() what time period we want to look at (server time stamps),
    // and whether we want to keep getting new messages as they arrive (in case
    // we end up at the 'current' endpoint)
    const options: MessageStreamOptions = {
        // start: 1728768726250,
        // end: Infinity,
        live: true,
    };

    // const messageGen = await chWrapper.spawn(options)

    // you can just create a sequence on the fly
    (await chWrapper.spawn(options))

        // // restricts to messages BEFORE the given time (inclusive)
        // .takeWhile(async (m) => m.serverTimestamp <= 1728768889477)

        // restricts to messages AFTER the given time
        // .skipWhile(async (m) => m.serverTimestamp <= 1728768889477)

        // note, above is just to demonstrate, if you were actually constraining
        // on time stamp you should use the options in the 'spawn()' call

        .skip(230)

        // you can modify things along the way
        .map(async (m) => {
            m.body.msg += ` [${m.serverTimestamp - m.senderTimestamp}ms]`
            return m;
        })

        // // actually we want to skip a few
        // .skip(6)

        // // and wherever we end up, just want to look at 8 of them
        // .take(8)

        // you'll need a 'consumer' at the end
        .forEach(async (m) => {
            console.log("Reading message:", m.body);
        });

    // if you want to store the sequence for later use, you can use the for-await patterns:
    // for await (const m of messageGen) {
    //     console.log("Reading message:", m.body);
    // }
}



async function runTest03() {
    const ch = await new ChannelStream(channelHandle).ready

    // optionally provide range(s), direction, and whether to keep getting new messages
    const options: MessageStreamOptions = {
        // start: 1729032901360,
        // start: 1729032901241 // first chunk covering this ends in 1288 [1729190642425]
        start: 1729032899954, // ndx 993
        // end: Infinity,
        // live: true,
    };

    // you can just create a sequence on the fly
    (await ch.spawn(options))
        // .skip(20)
        .forEach(async (m) => {
            console.log("[TEST 03] Reading message with index:", m.body.ndx, m.serverTimestamp);
        });

}

// async function runTest04() {
//     const c = await new ChannelStream(channelHandle).ready
//     const ch = await c.getHistory()
    
    // console.log(SEP, "[MessageSequence] Fetching channel history from", SEP, channelHistory, SEP)

    // // callback version, this works correctly
    // ch.traverseMessages(async (msg: Message) => {
    //     console.log("[runTest04] ", msg.body.ndx)
    // })
    

    // for await (const x of ch) {
    //     console.log("[runTeset04] ", x)
    // }

    // for await (const x of ch.traverseMessagesGenerator()) {
    //     console.log("[runTest04] ", x.body.ndx)
    // }

    // for await (const x of ch.traverseValuesGenerator()) {
    //     console.log("[runTest04] ", x)
    // }
// }

async function runTest05() {
    (await (await new ChannelStream(channelHandle).ready).spawn()).forEach(console.log)
}


async function runTest06() {
    (await (await new ChannelStream(channelHandle).ready).spawn({live: true})).forEach(console.log)
}



// // if used by "deno test ...", calls this:
// Deno.test("[slow] [channel] minimalist channel creation test", async () => {
//     console.log('\n===================== 04.04 START channel test =====================')
//     SB = new ChannelApi(configuration.channelServer, configuration.DBG)
//     await connectToChannel()
//     await ChannelApi.closeAll()
//     console.log('\n===================== 04.04 END channel test   =====================')
// });


// function getAllProperties(obj:any) {
//     const properties = new Set();
//     let currentObj = obj;
    
//     do {
//         Object.getOwnPropertyNames(currentObj).forEach(name => properties.add(name));
//     } while ((currentObj = Object.getPrototypeOf(currentObj)) && currentObj !== Object.prototype);
    
//     return Array.from(properties);
//   }
  
//   function inspectAPIEndpoint(obj:any, name:string) {
//     console.log(`Inspecting object: ${name}`);
//     console.log(`Type: ${typeof obj}`);
    
//     if (obj === null || obj === undefined) {
//         console.log(`The object ${name} is ${obj}`);
//         return;
//     }
  
//     if (typeof obj !== 'object' && typeof obj !== 'function') {
//         console.log(`Value: ${obj}`);
//         return;
//     }
    
//     const properties = getAllProperties(obj);
    
//     properties.forEach((prop:any) => {
//         try {
//             const descriptor = Object.getOwnPropertyDescriptor(obj, prop);
//             if (descriptor) {
//                 if (typeof descriptor.value === 'function') {
//                     console.log(`Method: ${prop}`);
//                 } else if (descriptor.get || descriptor.set) {
//                     console.log(`Accessor: ${prop}`);
//                 } else {
//                     console.log(`Property: ${prop}`);
//                     if (descriptor.value !== undefined && descriptor.value !== null) {
//                         console.log(`  Type: ${typeof descriptor.value}`);
//                         if (typeof descriptor.value !== 'object' && typeof descriptor.value !== 'function') {
//                             console.log(`  Value: ${descriptor.value}`);
//                         }
//                     }
//                 }
//             } else {
//                 console.log(`Inherited: ${prop}`);
//             }
//         } catch (error:any) {
//             console.log(`Unable to access: ${prop} (${error.message})`);
//         }
//     });
//   }
  
  

// @ts-ignore
if (import.meta.main) {
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await connectToChannel()

    // await runTest01()
    // await runTest02()
    // await runTest03()
    // await runTest04()
    // await runTest05()
    await runTest06()

    // inspectAPIEndpoint(crypto, 'crypto');
    // inspectAPIEndpoint(crypto.subtle, 'crypto.subtle');


    console.log(SEP, "Main done ...", SEP)


}




