#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

const prefix = "[08.02] [history helper - read channel messages] "

import {
    ChannelApi, Channel
    // ...
} from '../dist/384.esm.js'

import { aesTestProtocol, getOwnerHandle, SEP } from './test.utils.ts'

let SB: ChannelApi;

const ourChannelName = 'test_08_02_run030'
const visitorHandle = await getOwnerHandle(ourChannelName, true)

async function readChannel() {
    const c = await new Channel(visitorHandle, await aesTestProtocol()).ready

    console.log(SEP, prefix + "Reading channel messages form channelId: ", c.channelId, SEP)
    const channelKeys = await c.getMessageKeys('0')
    console.log(channelKeys.keys)
    console.log(SEP)
    console.log(channelKeys.historyShard)
    console.log(SEP)
}

if (import.meta.main) { // tells Deno not to run this in the test suite
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await readChannel()
}
