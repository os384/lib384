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

// we work with our own channel
const ourChannelName = 'test_08_02_run030'

import {
    ChannelApi,
    Channel,
    ChannelHandle,
    Message,
    ClientDeepHistory,
} from '../dist/384.esm.js'

import {
    _check_ObjectHandle,
} from "../dist/384.esm.js"

import { aesTestProtocol, getOwnerHandle, getVisitorHandle } from './test.utils.ts'

let ownerHandle: ChannelHandle | null = null
let visitorHandle: ChannelHandle | null = null

const _SEP_ = '='.repeat(76)
const _SEP = '\n' + _SEP_
const SEP_ = _SEP_ + '\n'
const SEP = '\n' + _SEP_ + '\n'

let SB: ChannelApi

async function getHistory(h: ChannelHandle, operation: 'count' | 'print' | 'reverse' | 'validatePings') {
    console.log("Getting history for channel: ", h.channelId)
    const channelHistory = await (await new Channel(h, await aesTestProtocol()).ready).getHistory()

    console.log('\n.', SEP, "Validating channel history ...")
    channelHistory.validate()
    console.log("... if there were no errors above, then channelHistory.validate() passed", SEP)

    let messageCount = 0
    let latestPingTimestamp = 0

    async function printMessage(msg: Message) {
        if (msg.body.type && msg.body.type === 'ping') {
            console.log("PING message: ", msg.body.payload)
        } else {
            console.log("Message: ", msg.body)
        }
    }

    async function validatePings(msg: Message) {
        if (msg.body.type && msg.body.type === 'ping') {
            const p = msg.body.payload;
            // payload will be a string like "[126] hello world! (time: 1717615744877);
            const t1 = p.match(/\((time: (\d+))\)/)
            const t2 = t1 ? parseInt(t1[2]) : 0
            if (t2 < latestPingTimestamp)
                throw new Error("Ping messages are not in order")
            else
                latestPingTimestamp = t2
        } else { /* ignore */ }
    }

    async function countMessage(msg: Message) {
        // console.log("Counting message: ", msg.body)
        messageCount++
    }

    async function timeAndCountMessages(h: ClientDeepHistory) {
        messageCount = 0
        const start = performance.now()
        await h.traverseMessages(countMessage)
        const end = performance.now()
        console.log(SEP, "Time and count messages, results:", _SEP)
        console.log('', "Message count        :", messageCount)
        console.log('', "Time taken           :", end - start, "ms")
        // console.log("Messages per second  :", messageCount / ((end - start) / 1000))
        console.log('', "Messages per second  :", Math.round((messageCount / ((end - start) / 1000)) * 10) / 10)    
        console.log(SEP_)
    }

    if (operation === 'print' || operation === 'reverse') {
        console.log(SEP, "Print out all the historical messages:", SEP)
        await channelHistory.traverseMessages(printMessage)
    }
    if (operation === 'reverse') {
        console.log(SEP, "Print out all the historical messages in reverse order:", SEP)
        await channelHistory.traverseMessages(printMessage, true)
    }
    if (operation === 'count') {
        await timeAndCountMessages(channelHistory)
    }

    // 'pings' come from socket messaging, eg helper.08.02.generate.history.withSocket.ts
    if (operation === 'validatePings') {
        console.log(SEP, "Validate all 'ping' messages are in order ... (if there are any, comes from socket unit tests)")
        await channelHistory.traverseMessages(validatePings)
        console.log("... if there were no errors above, then they're fine", SEP)
    }

    // if (operation === 'count') {
    //     console.log(SEP, "Count the number of messages in the channel SECOND TIME:", SEP)
    //     await timeAndCountMessages(channelHistory)
    // }
}

async function setup(channelName: string) {
    // SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    SB = new ChannelApi(configuration.channelServer, true)

    // ownerHandle = await getOwnerHandle(channelName)
    // console.log(SEP, "Owner handle:", ownerHandle?.channelId)
    // visitorHandle = await getVisitorHandle(channelName, 'visitor02')

    visitorHandle = await getOwnerHandle(channelName, true) // update: to align with 04.06 socket performance tests
    console.log(SEP, "Using channel with private key:\n", visitorHandle?.userPrivateKey, SEP)
}

async function tearDown() {
    await ChannelApi.closeAll()
}

// // todo: this test doesn't fully clean up after itself, we override for now
// Deno.test({
//     name: "[fast] [channel] basic history test 08.02",
//     sanitizeOps: false,  // Ignores unfinished async operations
//     sanitizeResources: false,  // Ignores open resources like WebSockets
//     async fn() {
//         console.log('\n===================== 08.02 START channel HISTORY test =====================')
//         await setup(ourChannelName)
//         await getHistory(visitorHandle!, 'count')
//         console.log("... cleaning up ...")
//         await tearDown()
//         console.log('\n===================== 08.02 END channel test   =====================')
//     }
// });
    
    

if (import.meta.main) { // tells Deno not to run this in the test suite
    console.log('\n===================== 08.02 START channel HISTORY test =====================')
    await setup(ourChannelName)

    // await getHistory(visitorHandle!, 'print') // prints ALL messages, briefly

    await getHistory(visitorHandle!, 'validatePings')

    await getHistory(visitorHandle!, 'count')

    // await getLatestMessages(visitorHandle!)
    // await feedSocket(visitorHandle!, COUNT, INTERVAL)
    // await tearDown()
}




