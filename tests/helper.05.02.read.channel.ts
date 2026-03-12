#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ourChannelName } from './05.02.whisper.test.ts'

const prefix = "[05.02] [history helper - read channel messages] "

import {
    ChannelApi, Channel, extractPayload, ChannelMessage,
} from '../dist/384.esm.js'

import { getOwnerHandle, SEP } from './test.utils.ts'

let SB: ChannelApi;

const visitorHandle = await getOwnerHandle(ourChannelName, true)

async function readChannel() {
    const c = await new Channel(visitorHandle).ready

    const v = await c.getPubKeys()
    console.log(SEP, prefix, "\n", "Channel public keys: \n", v, SEP)

    console.log(SEP, prefix, "\n", "Reading channel messages from channelId:", c.channelId, SEP)
    const channelKeys = await c.getMessageKeys('0')

    // console.log(channelKeys.historyShard)
    // console.log(SEP)

    if (!channelKeys.keys || channelKeys.keys.size === 0) {
        console.log(SEP, "No messages found", SEP)
    } else {
        console.log(channelKeys.keys)
        // now lets get the messages
        const messages = await c.getRawMessageMap(channelKeys.keys)
        console.log(SEP)
        for (const [key, value] of messages) {
            // console.log(`[${key}] `, extractPayload(value).payload)
            const m: ChannelMessage = extractPayload(value).payload;
            console.log(`[${key}] from:`, m.f, ' to:', m.t)
        }

        console.log(SEP)
        for (const [key, value] of messages) {
            // console.log(`[${key}] `, extractPayload(value).payload)
            const m: ChannelMessage = extractPayload(value).payload;
            console.log(`[${key}] from:`, await c.getVisitorKeyFromID(m.f!), ' to:', await c.getVisitorKeyFromID(m.t!))
        }

        console.log(SEP)
    }

}

if (import.meta.main) { // tells Deno not to run this in the test suite
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await readChannel()
}
