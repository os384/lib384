#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// tests 'deploying' latest 384 lib to it's Page; but only if it has changed
// since last deployment. note that if lib384 'channel' runs out of storage,
// then run 09.03.topup.lib384.test.ts

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, Channel } from "../dist/384.esm.js"

let testBuffer: ArrayBuffer = new ArrayBuffer(0)

new ChannelApi(configuration.channelServer, configuration.DBG)

function arrayBufferToText(arrayBuffer: ArrayBuffer) {
    const decoder = new TextDecoder('utf-8'); // Create a new TextDecoder instance for UTF-8 encoded text
    return decoder.decode(new Uint8Array(arrayBuffer)); // Decode an ArrayBuffer to text
}

async function loadTheLibrary(libName: string) {
    const dir = new URL('.', import.meta.url).pathname.replace(/^file:\/+/, '');
    const lib = await Deno.readFile(dir + `../dist/${libName}`);
    testBuffer = lib.buffer;
    console.log("library loaded!\n", testBuffer);
    console.log("library loaded!\n", arrayBufferToText(testBuffer).slice(0, 100) + "...");
}

async function testPages31(libName: string, libKey: string) {

    const lib384channel = await new Channel(libKey).ready
    lib384channel.channelServer = configuration.channelServer

    console.log("lib384channel: ", lib384channel)
    console.log("       handle: ", lib384channel.handle)

    const prefix = lib384channel.hashB32.slice(0, 12)
    const lib384url = configuration.channelServer + "/api/v2/page/" + prefix + "/" + libName
    const result = await fetch(lib384url)

    console.log("lib384channel: ", lib384channel)
    console.log("       handle: ", lib384channel.handle)
    console.log("    lib384url: ", lib384url)

    const fetchedLib = await result.text()
    const currentLib = arrayBufferToText(testBuffer)

    // compare them
    if (fetchedLib === currentLib) {
        console.log("Library is already deployed")
    } else {
        console.log("Library is not deployed, deploying now")
        const rez = await lib384channel.setPage({ page: testBuffer, type: 'application/javascript' })
        console.log("rez: \n", rez)
    }
}

// if used by "deno test ...", calls this:
Deno.test({
    name: "[fast] [pages] deploying lib384 if it needs updating",
    async fn() {
        console.log('\n===================== 09.04 START channel test =====================')
        if (!configuration.lib384key) {
            console.log("No lib384key in configuration, skipping test")
            return
        }    
        await loadTheLibrary('384.iife.js')
        await testPages31('384.iife.js', configuration.lib384key)
        await loadTheLibrary('384.esm.js')
        await testPages31('384.esm.js', configuration.lib384esmKey)
        console.log('===================== 09.04 END channel test   =====================')
    },
    sanitizeOps: false,
    sanitizeResources: false,
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    await loadTheLibrary('384.iife.js')
    await testPages31('384.iife.js', configuration.lib384key)
    await loadTheLibrary('384.esm.js')
    await testPages31('384.esm.js', configuration.lib384esmKey)}
