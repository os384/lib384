#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// history test helper - sends a bunch of messages

const TOTAL_COUNT = 7

// this is size of each set (sent in parallel)
const SET_SIZE = 12

// seconds interval between sets (if none wanted, set to 0)
const interval = 0

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
    console.log(prefix + "Setting up test channel ... ")
    const ownerHandle = await getOwnerHandle(ourChannelName, true)
    const protocol = await aesTestProtocol()
    testChannel = await new Channel(ownerHandle, protocol).ready
    console.log(prefix + "test01 DONE, channelID:", testChannel.channelId)
}

// send 4 messages on the channel then return
async function test02() {
    let totalSent = 0
    console.log(SEP, prefix + `START. Sending ${TOTAL_COUNT} messages in sets of ${SET_SIZE}.`, SEP)
    for (let i = 0; totalSent < TOTAL_COUNT; i++) {
        const randomString = Math.random().toString(36).substring(2, 8)
        const todayDateString = new Date().toISOString()
        const message = `message number ${i.toString().padStart(4, '0')} [${randomString}] [${todayDateString}]`
        console.log(prefix + "sending message set number:", i, " - messages per set:", SET_SIZE)
        const promises: Array<Promise<string>> = []
        for (let j = 0; j < SET_SIZE && totalSent < TOTAL_COUNT; j++) {
            promises.push(testChannel.send(message + ` [${j.toString().padStart(3, '0')}]`))
            totalSent++
        }
        await Promise.all(promises)
        if (interval > 0) await new Promise((resolve) => setTimeout(resolve, interval * 50))
    }
    console.log(prefix + "DONE, total messages sent:", totalSent)
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
