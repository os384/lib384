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
import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration


import {
    ChannelApi, Channel, channel, ChannelHandle, SBProtocol,
} from '../dist/384.esm.js'
// } from "../dist/384.esm.js"

const ourChannelName = 'test_08_04_run01'

// these are the number of messages that we want as a minimum
const TARGET_CHANNEL_MESSAGE_COUNT = 200

let SB: ChannelApi;

import {
    getVisitorHandle, getOwnerHandle, aesTestProtocol, SEP, SEP_,
} from './test.utils.ts'

// main channel we use, set up by test01()
let testChannel: Channel;
let testChannelHandle: ChannelHandle;
let testChannelProtocol: SBProtocol;

// this does all the setup
async function test01() {
    console.log("[08.04] [test01] Setting up owner ... ")
    const ownerHandle = await getOwnerHandle(ourChannelName, true)
    console.log("[08.04] [test01] Will use owner handle:\n",
        // ownerHandle
        JSON.stringify(ownerHandle, null, 2)
    )
    const protocol = await aesTestProtocol()
    const ownerChannel = await new Channel(ownerHandle, protocol).ready

    testChannel = ownerChannel
    testChannelHandle = ownerHandle
    testChannelProtocol = protocol

    console.log("[08.04] [test01] Getting message keys ... ")
    const oldMessages = await ownerChannel.getMessageKeys()
    console.log(oldMessages.keys)

    console.log("[08.04] [test01] test01 DONE, channelID:", ownerHandle.channelId)
    return oldMessages.keys.size
}

// send 'messageCount' messages to the channel, used to 'top up'
async function test02(messageCount: number) {
    console.log(`[08.04] [test02] START. Sending ${messageCount} messages.`)
    const interval = 1
    for (let i = 0; i < messageCount; i++) {
        const randomString = Math.random().toString(36).substring(2, 8)
        const todayDateString = new Date().toISOString()
        const message = `message number ${i.toString().padStart(4, '0')} [${randomString}] [${todayDateString}]`
        console.log("[08.04] [test02] sending message number:", i)
        await testChannel.send(message)
        await new Promise((resolve) => setTimeout(resolve, interval * 50))
    }
    console.log("[08.04] [test02] DONE")
}

// fetch message contents from the channel
async function test03() {
    console.log("[08.04] [test03] START. Getting messages (slice).")
    const messageKeys = await testChannel.getMessageKeys()
    // we actually just want 30 of these message keys
    const keys = Array.from(messageKeys.keys).slice(0, 30)
    // then we need to convert that back to a set
    const getSet = new Set(keys)
    const messages = await testChannel.getMessageMap(getSet)
    console.log("[08.04] [test03] Getting messages (first 30):")
    console.log(SEP)
    console.log(getSet)
    console.log(SEP)
    for (const [key, value] of messages.entries()) {
        // console.log(`[08.04] [test03] message[${key}]:`, value.body)
        console.log(value.body)
    }
    console.log(SEP)
    console.log("[08.04] [test03] DONE")
}

// fetch messages using channel stream
async function test04() {
    console.log("[08.04] [test04] START. Getting messages using channel stream. This does not stop.")
    const channelStream = await (new channel.stream(testChannelHandle, testChannelProtocol)).ready
    const stream = channelStream.start({ prefix: '0' });
    console.log(SEP)
    for await (const message of stream) {
        // console.log("[08.04] [test04] message received:", message.body)
        console.log( message.body)
    }
    console.log(SEP)
    console.log("[08.04] [test04] DONE")
}


async function allTests() {
    const targetCount = TARGET_CHANNEL_MESSAGE_COUNT
    const oldMessageCount = await test01()
    console.log(`[08.04] [allTests] oldMessageCount: ${oldMessageCount}`)
    if (oldMessageCount < targetCount) {
        console.log(`[08.04] [allTests] topping up to a count ${targetCount} total messages:`)
        await test02(targetCount - oldMessageCount)
        console.log(`[08.04] [allTests] confirming new message count: ${await test01()}`)
    } else {
        console.log(`[08.04] [allTests] message count already at ${oldMessageCount}, no need to top up`)
    }
    await test03()
    await test04()
    console.log("[08.04] allTests DONE")
}


// ToDo: currently this never stops waiting, we're using it for interactive testing;
//       at some point, possibly unit-test-ify this
// Deno.test("[slow] [channel] full stream test", async () => {
//     console.log('\n===================== 08.04 START channel test =====================')
//     SB = new ChannelApi(configuration.channelServer, configuration.DBG)
//     await allTests()
//     await ChannelApi.closeAll()
//     console.log('\n===================== 08.04 END channel test   =====================')
// });

if (import.meta.main) {
    // SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    SB = new ChannelApi(configuration.channelServer, true)
    await allTests()
}
