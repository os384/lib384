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
import { runName } from './12.03.history.iterator.ts'

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, Channel, ChannelStream, Message, ChannelHandle, SBUserPrivateKey, ChannelStreamOptions } from "../dist/384.esm.js"

const SEP = '\n' + '='.repeat(76) + '\n'
// const SEP_ = '='.repeat(76) + '\n'

let SB: ChannelApi

import { LocalStorage } from './test.utils.ts'
const localStorage = new LocalStorage('./.local.data.json');

export async function getTest_12_01_handle(budgetKey: SBUserPrivateKey, r = runName): Promise<ChannelHandle> {
    console.log("getTest_12_01_handle budget key (if needed)", budgetKey)
    const k = configuration.channelServer + '_' + r
    let testHandle = localStorage.getItem(k)
    if (testHandle) {
        console.log(`'${k}' entry (found in local storage)`, testHandle)
        return JSON.parse(testHandle)
    }
    else {
        const budgetChannel = await (new Channel(budgetKey)).ready
        const newHandle = await budgetChannel.budd()
        localStorage.setItem(configuration.channelServer + '_' + r, JSON.stringify(newHandle))
        return newHandle
    }
}

let channelHandle: ChannelHandle

export async function connectToChannel() {
    if (!SB)
        SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    channelHandle = await getTest_12_01_handle(configuration.budgetKey)
    console.log(SEP, "Channel handle:", channelHandle)
}

// NOTE: this is also exported and used by some other test scripts;
// carefully adds messages making sure a state is maintained on KV.
// it will handle errors like out of budget.
export async function addSomeMessages(count = 5, channel?: Channel, r = runName) {
    const stateKey = r + '_kv_state';
    if (!channelHandle) {
        await connectToChannel()
        console.log(SEP, channelHandle, SEP)
    }

    if (!SB) throw new Error("ChannelApi not initialized")

    if (!channel) {
        channel = await SB.connect(channelHandle).ready
    }

    // make sure state is set up
    let state = await channel.get(stateKey)
    if (!state) {
        console.log(SEP, "State not found, creating ...")
        state = { counter: 0 }
        await channel.put(stateKey, state)
    }
    console.log(SEP, `State ['${stateKey}']:`, '\n', state)

    let actuallySent = 0
    try {
        console.log(SEP, `Sending/adding ${count} new messages ...`)
        for (let i = state.counter; i < state.counter + count; i++) {
            // const msgText = `Message ${i} - ` + Date.now()
            const msgText = `Message ${i.toString().padStart(6, ' ')} - [client timestamp ` + Date.now() + ']'
            // console.log("... sending message:", msgText)
            const r = await channel.send({ msg: msgText, ndx: i })
            actuallySent++
            console.log(`... sent message (#${actuallySent}, ndx ${i}), return code:`, r)
        }
    } catch (e) {
        console.error("[addSomeMessages] Caught exception:", e, SEP, "Channel handle:\n", channel.handle, SEP)
        throw e
    } finally {
        if (actuallySent > 0) {
            state.counter += actuallySent
            await channel.put(stateKey, state)
            console.log(SEP, `State updated:`, '\n', state)
        }
        if (actuallySent !== count)
            console.log(SEP, `WARNING: sent ${actuallySent} instead of ${count} messages`, SEP)
    }
}

async function runTest01() {
    const COUNT = 3 // number of new messages to add each time

    console.log(SEP, "Running test 01 ...")

    try {

        const channel = await SB.connect(channelHandle).ready

        // add some messages
        await addSomeMessages(COUNT, channel)

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
    const s = await new ChannelStream(channelHandle).ready

    // every time we run the test, add some messages
    await addSomeMessages(3, s)

    // tell spawn() what time period we want to look at (server time stamps),
    // and whether we want to keep getting new messages as they arrive (in case
    // we end up at the 'current' endpoint)

    // 's' is a ChannelStream object. 's.spawn()' can be run multiple times
    // to get an iterable on the same ChannelID

    // each spawn can take some 'low-level' settings for performance,
    const options: ChannelStreamOptions = {
        start: 1728856657105 + 1,  // start at this server timestamp
        // end: Infinity,          // end point, Inf means all of them
        live: true,
    };

    const messageGen = (await s.spawn(options))
        // wherever we are starting (based on options), we just want to look at 200
        .take(200)
        // but regardless, we don't care an 'ndx' value (which is custom to this message body)
        .takeWhile(async (m) => m.body.ndx <= 1690);

    // you can do the 'for-each' pattern, but using '.forEach()' allows you to easily
    // block on when it's 'done'
    console.log(SEP, "Reading messages ...", SEP)
    await messageGen.forEach(async (m) => {
        console.log("Reading message:", m.body);
    });
    console.log(SEP, "... end of reading messages", SEP)

}

// like runTest02, but demonstrates multiple 'spawn()' calls against the same ChannelStream
async function runTest03() {

    const s = await new ChannelStream(channelHandle).ready

    // every time we run any test, add some messages
    await addSomeMessages(3, s)

    // for simplicity, we'll just use the same options for each spawn
    const options: ChannelStreamOptions = {
        start: 1728856657105 + 1,  // start at this server timestamp
        // end: Infinity,          // end point, Inf means all of them
        live: true,
    };

    // create an array with 4 'spawn()' calls, storing the generators,
    // and with slightly different filters
    console.log(SEP, "Starting 4 'spawn()' calls ...", SEP)
    const messageGens = await Promise.all([
        s.spawn(options).then((gen) => gen.take(10)),
        s.spawn(options).then((gen) => gen.take(20)),
        s.spawn(options).then((gen) => gen.take(30)),
        s.spawn(options).then((gen) => gen.take(800)), // this one keeps going
    ]);
    console.log(SEP, "... DONE starting 4 'spawn()' calls", SEP)
    await Promise.all(messageGens.map(async (gen) => {
        const index = messageGens.indexOf(gen)
        console.log(SEP, `[${index}] Starting to read messages ...`, SEP)
        await gen.forEach(async (m) => {
            console.log(`[${index}] ... read message:`, m.body);
        });
        console.log(SEP, `[${index}] ... DONE reading message:`, SEP)
    }));
    console.log(SEP, "... end of reading messages", SEP)

}


async function runTest04() {

    // wrapper inherits from Channel, just adds 'spawn()' method
    const s = await new ChannelStream(channelHandle).ready

    // every time we run the test, add some messages
    await addSomeMessages(3, s)

    // // each spawn can take some 'low-level' settings for performance,
    // const options: ChannelStreamOptions = {
    //     start: 1728856657105 + 1,  // start at this server timestamp
    //     // end: Infinity,          // end point, Inf means all of them
    //     live: true,
    // };

    const messageGen = (await s.spawn())

    console.log(SEP, "[test 04] Reading messages ...", SEP)
    await messageGen.forEach(async (m) => {
        console.log("[test 04] Reading message:", m.body);
    });
    console.log(SEP, "[test 04 ]... end of reading messages", SEP)

}



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
    await connectToChannel()

    // await runTest01()
    // await runTest02()
    // await runTest03()
    await runTest04()

    console.log(SEP, "Main done ...", SEP)


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



// class MessageSequence extends AsyncSequence<Message> {
//     constructor(private channelWrapper: ChannelWrapper, options: MessageStreamOptions = {}) {
//         // Define the source as an async generator
//         const source = (async function* () {
//             console.log(SEP, "[MessageSequence] messageStream() options:", SEP, options, SEP);

//             const { start = 0, end = Infinity } = options;
//             const forward = end >= start;
//             const myChannelId = channelWrapper.channelId

//             const channel = await SB.connect(channelHandle).ready

//             let timeStamps: number[] = []
//             {
//                 const messageKeys = await channel.getMessageKeys()
//                 const keyArray = Array.from(messageKeys.keys())
//                 // console.log(SEP, `Found ${messageKeys.size} recent messages:`, SEP, messageKeys, SEP)
//                 // ToDo: handle non-'____' keys
//                 timeStamps = keyArray.map((k) => Channel.base4StringToTimestamp(Channel.deComposeMessageKey(k).timestamp))
//                 // sort the timeStamps array in accordance with 'forward'
//                 timeStamps.sort((a, b) => forward ? a - b : b - a)
//                 const n = timeStamps.length
//                 // remove any time stamps that are outside the range
//                 timeStamps = timeStamps.filter((ts) => forward ? ts >= start && ts <= end : ts <= start && ts >= end)
//                 // console.log(SEP, `Time stamps [${timeStamps.length} from ${n}] (note, forward is ${forward}, boundaries are ${start}, ${end}):`, '\n', timeStamps, SEP)
//             }

//             // let messages = new Map<string, Message>()

//             // create a 'keyArray' that reconstructs the id values from the timeStamps
//             const keyArray = timeStamps.map((ts) => Channel.composeMessageKey(myChannelId, ts))
//             // console.log(SEP, `Fetching messages using getMessageMap(.. ${keyArray.length} entries ..) ...`, SEP, keyArray, SEP)

//             const chunkSize = 64
//             for (let i = 0; i < keyArray.length; i += chunkSize) {
//                 // note: currently not much point doing this in parallel since it'll hit the same DO
//                 console.log(SEP, `Fetching chunk ${i / chunkSize + 1} of up to ${Math.ceil(keyArray.length / chunkSize)} ...`, SEP)
//                 const chunk = keyArray.slice(i, i + chunkSize)
//                 const chunkMessages = await channel.getMessageMap(new Set(chunk))
//                 // console.log(SEP, `Received ${chunkMessages.size} messages in chunk ${i / chunkSize + 1} of ${Math.ceil(keyArray.length / chunkSize)} ...`, SEP, chunkMessages, SEP)
//                 // messages = new Map([...messages, ...chunkMessages])
//                 const messageArray = Array.from(chunkMessages.values());

//                 for (const m of messageArray) {
//                     yield m
//                 }

//             }
//             // console.log(SEP, `[MessageSequence] Received ${messages.size} recent messages`, SEP)

//             // {
//             //     // test logging
//             //     // grab first message and look at it
//             //     const m = messages.get(keyArray[0])!
//             //     const ts1 = m.serverTimestamp;
//             //     const id = m._id
//             //     const x = Channel.deComposeMessageKey(id)
//             //     const ts2 = Channel.base4StringToTimestamp(x.timestamp)
//             //     console.log(
//             //         SEP,
//             //         "TEST looking at one of them", SEP,
//             //         m, SEP,
//             //         x, SEP,
//             //         `serverTimestamp: ${ts1} vs ${ts2} ${ts1 === ts2 ? '(ok)' : " ERROR MISMATCH"} `, SEP,
//             //     );
//             // }


//             // const messageArray = Array.from(messages.values());

//             // const filteredMessages = messageArray.filter(
//             //     (msg) => {
//             //         if (forward) {
//             //             return (msg.serverTimestamp >= start) && (msg.serverTimestamp <= end);
//             //         } else {
//             //             return (msg.serverTimestamp <= start) && (msg.serverTimestamp >= end);
//             //         }
//             //     }
//             // );

//             // const sortedMessages = forward
//             //     ? filteredMessages.sort((a, b) => a.serverTimestamp - b.serverTimestamp)
//             //     : filteredMessages.sort((a, b) => b.serverTimestamp - a.serverTimestamp);

//             // console.log(SEP, "Filtered and sorted messages:", sortedMessages);

//             // for (const message of sortedMessages)
//             //     yield message;


//         })();

//         // Initialize the base AsyncSequence with the custom source
//         super(source);
//     }

//     // You can add MessageSequence-specific methods here if needed
// }


// class ChannelWrapper extends Channel {
//     channelWrapperReady: Promise<ChannelWrapper>
//     static ReadyFlag = Symbol('ChannelWrapperReadyFlag');
//     constructor(h: ChannelHandle) {
//         super(h);
//         this.channelWrapperReady =
//             this.channelReady
//                 .then(async () => {
//                     (this as any)[ChannelWrapper.ReadyFlag] = true;
//                     return this;
//                 })
//                 .catch((e) => { throw e; });
//     }
//     get ready() { return this.channelWrapperReady }

//     async spawn(options: MessageStreamOptions = {}): Promise<AsyncSequence<Message>> {
//         // const messageMap = await this.channel.getMessageMap()
//         // return new AsyncSequence(messageStream(messageMap, options))

//         return new MessageSequence(this, options);

//     }

// }
