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
