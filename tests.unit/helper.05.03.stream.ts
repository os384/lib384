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
import '../keys.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import {
    ChannelApi,
    channel
} from '../dist/384.esm.js'

import { aesTestProtocol, getOwnerHandle, getVisitorHandle } from './test.utils.ts'

const SEP = '\n' + '='.repeat(76) + '\n'

// the namespace for keys that this helper uses
const ourChannelName = 'test_08_xx' // overlaps with 08.* tests

new ChannelApi(configuration.channelServer, configuration.DBG) // side effects

async function traceChannelWithStream() {
    try {

        const ownerHandle = await getOwnerHandle(ourChannelName)
        console.log(SEP, "Will operate against channel:", ownerHandle.channelId, SEP)
        
        const handle = await getVisitorHandle(ourChannelName, 'visitor.05.03')

        console.log("We will be listening on stream:", SEP, handle, SEP, "with key:", SEP, handle.userPrivateKey, SEP)
        const c = await (new channel.stream(handle, await aesTestProtocol())).ready

        await c.send({ message: "test message from helper.05.03 stream tracer!", date: new Date().toISOString()})

        // now let's read all the messages
        for await (const message of await c.stream({ prefix: '0'}))
            console.log(SEP, "[05.03] [traceChannelWithStream] received:\n", message.body, SEP)
        
        console.log(SEP, "We are now listening for new messages", SEP)
    } catch (e: any) {
        console.trace("Error in traceChannel:", e)
    }
}

try {
    await traceChannelWithStream()
} catch (e: any) {
    console.trace("Error in traceChannelWithStream:", e)
}
