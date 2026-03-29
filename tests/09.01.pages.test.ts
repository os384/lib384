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

import { ChannelApi, Channel, extractPayload } from "../dist/384.esm.js"
import { assert, assertThrows } from "@std/assert";
import { compareArrayBuffers } from "./test.utils.ts"

let SB

let testBuffer: ArrayBuffer = new ArrayBuffer(0)

async function loadTheCat() {
    const dir = new URL('.', import.meta.url).pathname.replace(/^file:\/+/, '');
    const cat = await Deno.readFile(dir + 'smallCat.jpg');
    testBuffer = cat.buffer;
    console.log("cat loaded!\n", testBuffer);
}


async function testPages01() {

    const budgetChannel = await new Channel(configuration.budgetKey).ready

    const newChannelHandle = await SB.create(budgetChannel)
    const newChannel = await SB.connect(newChannelHandle).ready

    console.log(
        "New channel, full channel handle\n",
        "===========================================\n",
        JSON.stringify(newChannelHandle, null, 2), "\n",
        "===========================================\n",
        JSON.stringify(newChannel.handle, null, 2), "\n",
        "===========================================\n")

    // now let's upload a 'Page'
    const rez = await newChannel.setPage(
        { page:
            { 
                // these are looked at by the channel server
                locked: false,
                shortestPrefix: 6,

                // other than that you can put whatever you want
                motd: "hi there here is a cat!",

                // if you want SBFS to know what to do with it, add SBFile info:
                _SBFSVersion: "2024-02-01-0002", // remember SBFS is picky about this one
                sb384app: true,
                sb384appType: 'single', // singleton file of some sort
                sb384appVersion: 3,
                timeStame: Date.now(),
                fileLocation: 'inline', // that means it's embedded in 'file' property below
                name: "cat.jpg",
                type: "image/jpeg",
                size: testBuffer.byteLength,

                file: testBuffer, // our cat image

                // for example if the contents are encrypted, you might want to put
                // salt and iv here. 384loader would need that to show/display the
                // file.
                encrypted: false, // this is for your app usage, server ignores this
            }
        })

    console.log("rez: ", rez)

    // cool now let's read it back, we could get it from the channel:
    // const downloadedCat = await newChannel.getPage(rez.pageKey.slice(0,6))
    // but we can also get it from the SB object:
    const downloadedCat = await SB.getPage(rez.pageKey.slice(0,6))
 
    console.log("downloadedCat: ", downloadedCat)

    console.log("testPages01() done!")
}

// todo: update, is this fetching a mime object or not?
// async function testPages02() {
//     const prefix = "14BQcf"
//     let page: any
//     try {
//         page = await new ChannelApi(configuration.channelServer).getPage(prefix)
//         console.log("We got this page:\n\n", page, '\n\n')
//     } catch (e) {
//         console.log(`testPages02() caught error. You probably need to update the prefix info ('${prefix}').`)
//         return
//     }
//     // if we DID receive something, it should match
//     assert(compareArrayBuffers(testBuffer, page.payload.file),
//         "testPages02() failed: downloaded file doesn't match original")
//     console.log("TestPages02() done!")
// }

// if used by "deno test ...", calls this:
Deno.test("[fast] [pages] basic pages test", async () => {
    console.log('\n===================== 09.01 START Pages test =====================')
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await loadTheCat()
    await testPages01()
    await ChannelApi.closeAll()
    // await testPages02()
    console.log('\n===================== 09.01 END Pages test   =====================')
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await loadTheCat()
    await testPages01()
    // await testPages02()
}
