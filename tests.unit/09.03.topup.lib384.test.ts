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
