#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// basic 'Pages' test

import '../env.js'
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
