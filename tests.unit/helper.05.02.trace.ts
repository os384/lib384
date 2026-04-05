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
    ChannelApi, ChannelSocket, Message,
} from '../dist/384.esm.js'

import { getOwnerHandle, getVisitorHandle } from './test.utils.ts'

const SEP = '\n' + '='.repeat(76) + '\n'

const ourChannelName = 'test_05_02_run031'

new ChannelApi(configuration.channelServer, configuration.DBG)

async function traceChannel() {
    // not needed, but it forces initialization if needed
    const ownerHandle = await getOwnerHandle(ourChannelName)
    console.log("[helper.05.02] Got ownerhandle for channel ", ownerHandle.channelId)

    const handle = await getVisitorHandle(ourChannelName, 'visitor.05.02')

    // and now join that channel
    const myOnMessage = (msg: Message | string) => { console.log('[helper.05.02] message received:', msg) }
    const s = await new ChannelSocket(handle!, myOnMessage).ready
    console.log(SEP, "We are now listening for messages on:", SEP, s.channelId, SEP)
}

await traceChannel()
