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

import { ChannelApi, Channel, extractPayload } from "../dist/384.esm.js"
import { assert, assertThrows } from "@std/assert";
import { compareArrayBuffers } from "./test.utils.ts"

let SB

let testBuffer: ArrayBuffer = new ArrayBuffer(0)

function textToArrayBuffer(text: string) {
    const encoder = new TextEncoder(); // Create a new TextEncoder instance
    return encoder.encode(text).buffer; // Encode a text string to Uint8Array and then get its ArrayBuffer
}

function arrayBufferToText(arrayBuffer: ArrayBuffer) {
    const decoder = new TextDecoder('utf-8'); // Create a new TextDecoder instance for UTF-8 encoded text
    return decoder.decode(new Uint8Array(arrayBuffer)); // Decode an ArrayBuffer to text
}

const libName = "384.iife.js"

async function loadTheLibrary() {
    const dir = new URL('.', import.meta.url).pathname.replace(/^file:\/+/, '');
    const lib = await Deno.readFile(dir + `../dist/${libName}`);
    testBuffer = lib.buffer;
    console.log("library loaded!\n", testBuffer);
    console.log("library loaded!\n", arrayBufferToText(testBuffer).slice(0, 100) + "...");
}

// we upload an unencrypted JS library example
async function testPages11() {

    const budgetChannel = await new Channel(configuration.budgetKey).ready

    const newChannelHandle = await SB.create(budgetChannel)
    const newChannel = await SB.connect(newChannelHandle).ready

    console.log(
        "New channel, full channel handle\n",
        "===========================================\n",
        JSON.stringify(newChannel.handle, null, 2), "\n",
        "===========================================\n")

    // buffer is in the right format already; now tell server to convert on fetch
    const rez = await newChannel.setPage({ page: testBuffer, type: 'application/javascript' })
    console.log("rez: \n", rez)
    console.log("Sample full URL: ", configuration.channelServer + "/api/v2/page/" + rez.pageKey.slice(0,12) + "/" + libName)

}


// if used by "deno test ...", calls this:
Deno.test("[fast] [pages] another pages test", async () => {
    console.log('\n===================== 09.02 START Pages test =====================')
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await loadTheLibrary()
    await testPages11()
    await ChannelApi.closeAll()
    // await testPages02()
    console.log('\n===================== 09.02 END Pages test   =====================')
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await loadTheLibrary()
    await testPages11()
    // await testPages02()
}
