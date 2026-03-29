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

import { ChannelApi } from "../dist/384.esm.js"
import { getOwnerHandle, SEP } from './test.utils.ts'

let SB: ChannelApi

const ourChannelName = 'test_10_run05'

async function testGLobalKv01() {

    const useKey = 'testKey 14'

    const ownerHandle = await getOwnerHandle(ourChannelName)
    console.log(SEP, "Will operate against channel:", ownerHandle.channelId, SEP)

    const c = SB.connect(ownerHandle)

    console.log("Reading current value")
    const x = await c.get(useKey)
    console.log(SEP, "Current value is:", SEP, x, SEP)

    if (!x) {
        console.log("Initial value not found, setting it ...")
        await c.put(useKey, {
            type: 'MyObject',
            description: 'MyObject test object, can be anything',
            counter: 0,
            lastUpdated: new Date().toISOString() })
    } else {
        // increase the counter by one and update the lastUpdated field
        x.counter++
        x.lastUpdated = new Date().toISOString()
        console.log("Updating the value ...")
        await c.put(useKey, x)
    }

    console.log("testGLobalKv01() done!")
}

// under development
// // if used by "deno test ...", calls this:
// Deno.test("[fast] [kv] basic global KV test", async () => {
//     console.log('\n===================== 10.01 START Pages test =====================')
//     SB = new ChannelApi(configuration.channelServer, configuration.DBG)
//     await testGLobalKv01()
//     await ChannelApi.closeAll()
//     // await testPages02()
//     console.log('\n===================== 10.01 END Pages test   =====================')
// });

if (import.meta.main) { // tells Deno not to run this in the test suite
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await testGLobalKv01()
    // await testPages02()
}
