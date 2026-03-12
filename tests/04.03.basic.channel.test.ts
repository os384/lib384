#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, Channel, SB384 } from "../dist/384.esm.js"

// we 'connect' to the budget channel, so we use it as storage resource
let SB

async function simpleCreateChannel3() {

    // set up budget channel (from 04.01/04.02)
    const userPrivateKey = configuration.budgetKey

    // the above looks like this:
    // const userPrivateKey = "Xj32UgGbMee95wzU4FH6AiL2vLQ2csjgHsYUGmm04FTxpXXVbF8oegGZXQ"
    //     + "8vtn5I97zembQkSu4CiBUXovmQRe1kj03qmhjD5iiPC87YYJngnA3xQoqko9rXGCZ4Oz7hzNzrN"

    // of course the idea is that you should be able to do the above with:
    // const userPrivateKey = await privateKeyFromStrongpin("rR6y yMuR 536R 2QWX")

    const budgetChannel = await new Channel(userPrivateKey).ready

    // we don't need to set the budget channel server here; since we will be
    // creating a new channel using SB.create(), then 'SB' knows the server

    // using the budget channel as funding source, create a new channel
    const newChannel = await SB.create(budgetChannel)
    console.log(
        "New channel, full channel handle\n",
        "===========================================\n",
        JSON.stringify(newChannel, null, 2), "\n",
        "===========================================\n")

    // the new owner key of the returned channel is ours to use:
    const newChannelOwnerPrivateKey = newChannel.userPrivateKey

    // henceforth that new (owner) private key is all we need to keep track of
    
    // to reconnect to it, we would do something like this:
    // first, get an SB384 object
    const me = await (new SB384(newChannelOwnerPrivateKey)).ready

    // now we can connect directly, providing 'handle' format
    const myOwnChannel = await SB.connect({
        "channelId": me.ownerChannelId,
        "userPrivateKey": me.userPrivateKey,
    }).ready

    console.log(
        "My new channel, and recreated handle:\n",
        "===========================================\n",
        JSON.stringify(myOwnChannel.handle, null, 2), "\n",
        "===========================================\n")
}

Deno.test("[fast] [channel] basic channel creation test", async () => {
    console.log('\n===================== 04.03 START channel test =====================')
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await simpleCreateChannel3()
    await ChannelApi.closeAll()
    console.log('===================== 04.03 END channel test   =====================')
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await simpleCreateChannel3()
}
