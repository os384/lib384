#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// NOTE: refer to 04.01 for comments on the 04.* subset of tests

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, Channel } from "../dist/384.esm.js"

const SEP = '\n' + '='.repeat(76) + '\n'

// let SB: ChannelApi

// console.log(SEP, configuration, SEP)

// connects to a channel (not quite 'create')
async function simpleCreateChannel() {
    console.log(SEP, 'simpleCreateChannel() in 04.02.basic.channel.test.ts', SEP, configuration.budgetKey, SEP)

    // creates a channel object (but doesn't create a 'new' channel)
    const budgetChannel = await new Channel(configuration.budgetKey).ready
    console.log(SEP, 'Budget handle (from key):', SEP, budgetChannel.handle, SEP, budgetChannel.userPrivateKey, SEP)

    console.log(SEP, budgetChannel.handle, SEP)

    // and now API calls should just work. getChannelKeys() is a simple 'ping'
    console.log(SEP, 'Confirming channel keys:', SEP, await budgetChannel.getChannelKeys(), SEP)
}

Deno.test({
    name: "[fast] [channel] basic channel creation test",
    async fn() {
        console.log('\n===================== 04.02 START channel test =====================')
        // SB = new ChannelApi(configuration.channelServer, configuration.DBG)
        ChannelApi.defaultChannelServer = configuration.channelServer
        console.log(SEP, "Channel Server:", configuration.channelServer, SEP)
        await simpleCreateChannel()
        await ChannelApi.closeAll()
        console.log('===================== 04.02 END channel test   =====================')
    },
    // sanitizeOps: false,
    // sanitizeResources: false,
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    console.log(SEP, "Channel Server:", configuration.channelServer, SEP)
    // SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    ChannelApi.defaultChannelServer = configuration.channelServer
    console.log(SEP, "Channel Server:", configuration.channelServer, SEP)
    await simpleCreateChannel()
    await ChannelApi.closeAll()
}
