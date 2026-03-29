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
    // ...

const ourChannelName = 'test_08_04_run01'
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
    console.log("[08.04] [helper] Setting up test channel ... ")
    const ownerHandle = await getOwnerHandle(ourChannelName, true)
    const protocol = await aesTestProtocol()
    const ownerChannel = await new Channel(ownerHandle, protocol).ready

    testChannel = ownerChannel
    testChannelHandle = ownerHandle
    testChannelProtocol = protocol

    console.log("[08.04] [helper] test01 DONE, channelID:", ownerHandle.channelId)
}

// send 4 messages on the channel then return
async function test02() {
    console.log(`[08.04] [helper] START. Sending 4 messages.`)
    const interval = 1
    for (let i = 0; i < 4; i++) {
        const randomString = Math.random().toString(36).substring(2, 8)
        const todayDateString = new Date().toISOString()
        const message = `message number ${i.toString().padStart(4, '0')} [${randomString}] [${todayDateString}]`
        console.log("[08.04] [helper] sending message number:", i)
        await testChannel.send(message)
        await new Promise((resolve) => setTimeout(resolve, interval * 50))
    }
    console.log("[08.04] [helper] DONE")
}

async function allTests() {
    await test01()
    await test02()
    console.log("[08.04] [helper]] DONE")
}


if (import.meta.main) {
    // SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    SB = new ChannelApi(configuration.channelServer, true)
    await allTests()
}
