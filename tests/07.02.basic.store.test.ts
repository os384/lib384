#!/usr/bin/env -S deno run --allow-net --allow-read

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, StorageApi, compareBuffers } from "../dist/384.esm.js"
import { assert } from "@std/assert";
import { SEP } from './test.utils.ts'

let SB: ChannelApi;

async function test01() {
    // set up our budget channel
    const budgetChannel =  SB.connect(configuration.budgetKey)

    // create a test buffer that we will store
    const testBlock = crypto.getRandomValues(new Uint8Array(63 * 1024))
    console.log("Generated test buffer: ", testBlock.buffer)

    // do the store, wait for it to complete (which is when verification resolves)
    const shardHandle_1 = await SB.storage.storeData(testBlock, budgetChannel)
    await shardHandle_1.verification
    console.log('\n', SEP, "Reply from 'SB.storage.storeData()': \n", shardHandle_1, '\n', SEP)

    // now we try to fetch the data back
    const shardHandle_2 = await SB.storage.fetchData(shardHandle_1)

    // note that fetchData() 'accumulates' data into the handle, so above we could just
    // have 'reused' shardHandle_1, but since we're doing some testing/learning here,
    // we'll keep them separate

    console.log('\n', SEP, "Fetching the data, result: \n", shardHandle_2, '\n', SEP)

    // we can access the raw contents of the shardHandle, but this is the safe way:
    console.log(SEP, "Will compare:", SEP, shardHandle_1.payload, SEP, shardHandle_2.payload, SEP)
    const payload_1 = shardHandle_1.payload
    const payload_2 = shardHandle_2.payload // StorageApi.get Payload(shardHandle_2)

    // now compare results
    if (!compareBuffers(payload_1, payload_2)) {
        console.error(`ugh - buffer did not come back the same (sent, returned):`)
        console.log(payload_1)
        console.log(payload_2)
        assert(false, "Data fetched is not the same as data stored")
    } else {
        console.log("test08: SUCCESS")
    }
}

// if used by "deno test ...", calls this:
Deno.test("[fast] [storage] basic storage test 07.02", async () => {
    console.log('\n===================== 07.02 START channel test =====================')
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await test01()
    await ChannelApi.closeAll()
    console.log('\n===================== 07.02 END channel test   =====================')
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    // called if used from command line
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await test01()
}
