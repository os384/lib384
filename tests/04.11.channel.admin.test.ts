#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env


import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, Channel } from "../dist/384.esm.js"

const SEP = '\n' + '='.repeat(76) + '\n'

let SB

async function connectToChannel() {
    const userPrivateKey = configuration.budgetKey
    const newChannel = await new Channel(userPrivateKey).ready
    const handle = newChannel.handle
    console.log(handle)
    const channelKeys = await newChannel.getChannelKeys()
    console.log(channelKeys)
    console.log(SEP, newChannel.userPublicKey, SEP)

    const x = await newChannel.getCapacity()

    if (x.capacity)
        console.log(SEP, "Channel capacity: ", x.capacity, SEP)
    else
        console.log(SEP, "Channel capacity, cannot parse result: ", x, SEP)

    // now let's try to set it to something higher
    const y = await newChannel.updateCapacity(x.capacity + 10)
    console.log("Channel capacity updated: ", y)

}


// if used by "deno test ...", calls this:
Deno.test("[fast] [channel] basic channel admin operations", async () => {
    console.log('\n===================== 04.11 START channel admin test =====================')
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await connectToChannel()
    await ChannelApi.closeAll()
    console.log('\n===================== 04.11 END channel test   =====================')
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    // called if used from command line
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await connectToChannel()
}
