#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// current channel server 'small branch' settings:
// const MSG_HISTORY_BRANCHING = TEST_WITH_SMALL_BRANCHING ? 3 : DeepHistory.MESSAGE_HISTORY_BRANCH_FACTOR
// const MSG_HISTORY_SET_SIZE = TEST_WITH_SMALL_BRANCHING ? 5 : DeepHistory.MAX_MESSAGE_SET_SIZE

// history test helper - send a specific number of messages, depending on what you're testing

// const COUNT = 5 * (3 * 3 * 3 + 1)
// const COUNT = (5 * (3 * 3 * 3 * 3)) - (5 * (3 * 3 * 3 + 1))

// perfect levels are:
// 5 * 3 = 15
// 5 * 3 * 3 = 45
// 5 * 3 * 3 * 3 = 135
// 5 * 3 * 3 * 3 * 3 = 405
// 5 * 3 * 3 * 3 * 3 * 3 = 1215
// 5 * 3 * 3 * 3 * 3 * 3 * 3 = 3645

// const COUNT = 512 / 4

const COUNT = 7

// const COUNT = 5
// const COUNT = 45 - 15
// const COUNT = 135 - 45
// const COUNT = 405
// const COUNT = 405 - 135
// const COUNT = 1215 - 405  // used to break at this level for branch 3
// const COUNT = 3645 - 1215

// const COUNT = 3645 - 1400

// const COUNT = 405
// const COUNT = 1215 - 430
// const COUNT = 1215

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import {
    ChannelApi, Channel,
} from '../dist/384.esm.js'
    // ...

// we work with our own channel
const ourChannelName = 'test_08_02_run030'
const prefix = "[08.02] [history helper] "

let SB: ChannelApi;

import {
    getOwnerHandle, aesTestProtocol, SEP,
} from './test.utils.ts'

let testChannel: Channel;

async function setup() {
    const ownerHandle = await getOwnerHandle(ourChannelName, true)
    const protocol = await aesTestProtocol()
    testChannel = await new Channel(ownerHandle, protocol).ready
    console.log(prefix + "Set up, will use channelID:", testChannel.channelId)
}

// send messages on the channel then return
async function test02() {
    console.log(SEP, prefix + `START. Sending ${COUNT} messages.`, SEP)
    const interval = 1
    for (let i = 0; i < COUNT; i++) {
        const randomString = Math.random().toString(36).substring(2, 8)
        const todayDateString = new Date().toISOString()
        const message = `message number ${i.toString().padStart(4, '0')} [${randomString}] [${todayDateString}]`
        console.log(prefix + "sending message number:", i)
        await testChannel.send(message)
        await new Promise((resolve) => setTimeout(resolve, interval * 50))
    }
    console.log(prefix + "DONE")
}

async function allTests() {
    await setup()
    await test02()
    console.log(prefix + "DONE")
}

// only command line mode
if (import.meta.main) {
    // SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    SB = new ChannelApi(configuration.channelServer, true)
    await allTests()
}
