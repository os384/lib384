#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// adds 128 MB from budget channel to the lib384 deploy channel

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, Channel } from "../dist/384.esm.js"
import { SEP } from './test.utils.ts'

async function testTopupChannel(libKey: string, amount: number = 128 * 1024 * 1024) {
    const budgetChannel = new ChannelApi(configuration.channelServer, configuration.DBG).connect(configuration.budgetKey)
    const lib384channel = await new Channel(libKey).ready
    console.log(SEP, "Topping up budget for:\n", libKey, '\n', "channelId:", lib384channel.handle.channelId, SEP)
    lib384channel.channelServer = configuration.channelServer
    console.log(SEP, "lib384channelKeys:\n", lib384channel, SEP)
    const reply = await budgetChannel.budd({ targetChannel: lib384channel.handle, size: amount })
    console.log(SEP, "Top up completed.", SEP)
}


// if used by "deno test ...", calls this:
Deno.test("[fast] [pages] topping up budget in lib384 channel", async () => {
    console.log('\n===================== 09.03 START Top Up Channel Budget Test =====================')
    if (!configuration.lib384key) {
        console.log("No lib384key in configuration, skipping test")
    } else {
        await testTopupChannel(configuration.lib384key)
        await testTopupChannel(configuration.lib384esmKey)
    }
    console.log('\n===================== 09.03 END Top Up Channel Budget Test   =====================')
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    if (true) {
        // default, works with keys from configuration
        if (!configuration.lib384key) {
            console.log("No lib384key in configuration, skipping test")
        } else {
            await testTopupChannel(configuration.lib384key)
            await testTopupChannel(configuration.lib384esmKey)
        }
    } else {
        // manual (local, not Deno) override, testing with specific key(s)
        await testTopupChannel(
            'Xj32tHcTUUPw08Qf5r0L5WTGDtWEhm2ZjM2TI893NIEnxQ8XY4qqmulBNxARZ6N2wcHFoGUrbtD7JftNPNaEMNQMOWwhxWnRrW8qYgOrhaWbMiImLhAPSz0ArkRmUc2n49Aew',
            64 * 1024 * 1024
        )
        console.warn("NOTE: Test was run with manual override, not with configuration keys.")
    }
}
