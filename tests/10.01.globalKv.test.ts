#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// basic global KV test

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
