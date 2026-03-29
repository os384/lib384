#!/usr/bin/env -S deno run --allow-net

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

import { ChannelApi, Channel } from "../dist/384.esm.js"

async function connectToChannel() {

    new ChannelApi(configuration.channelServer, configuration.DBG) // side effects

    const budgetChannel = new Channel(configuration.budgetKey) // create channel object
    const newHandle = await budgetChannel.budd() // ... and 'spin off' a new channel

    console.log("Created new channel using budd:\n", JSON.stringify(newHandle, null, 2))

    // now we just sanity check that the channel 'is there'
    const channelKeys = await (new Channel(newHandle)).getChannelKeys() // channel object for new channel
    console.log("Channel keys (from new channel):\n", JSON.stringify(channelKeys, null, 2))
}

// if used by "deno test ...", calls this:
Deno.test("[fast] [channel] minimalist budd test", async () => {
    console.log('\n===================== 06.01 START channel test =====================')
    await connectToChannel()
    console.log('\n===================== 06.01 END channel test   =====================')
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    // called if used from command line
    await connectToChannel()
}
