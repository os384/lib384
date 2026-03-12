#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// connects to a channel, then sends a few messages over channel socket with
// 'worst possible' timing (every 12 seconds); that timer should be set to
// whatever time *exceeds* how long the remote web socket stays open, eg this
// tests hibernation

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

// the namespace for keys that this helper uses
const ourChannelName = 'test_04_07'

// seconds between messages; currently, cloudflare hibernateable websockets will
// hibernate at 10 seconds
const messageIntervals = 12
const numberOfMessages = 3 // number of messages to send


import {
    ChannelApi, ChannelSocket, Message,
    ChannelHandle
    // } from '../dist/384.esm.js'
} from "../dist/384.esm.js"

import { aesTestProtocol, getOwnerHandle, getVisitorHandle } from './test.utils.ts'

const SEP = '\n' + '='.repeat(76) + '\n'
const SEP_ = '='.repeat(76) + '\n'

let SB: ChannelApi

async function test01(count: number, interval: number) {
    let messagesLeft = count
    let messagesReceived = 0

    console.log("SEP, [04.07] Starting test01 ...  this will send messages at intervals that prompt hibernation each time", SEP)

    let feederResolve, feederReject;
    const feederPromise = new Promise((resolve, reject) => {
        feederResolve = resolve;
        feederReject = reject;
    })

    const myOnMessage = (msg: Message | string) => {
        const m = (typeof msg === 'string') ? msg : msg.body
        console.log(SEP_, `++++ [#${messagesReceived}] ++++ [04.07] message received:\n`, m);
        if (m.ts) {
            if (messagesReceived++ >= count) {
                console.log(SEP_, '[04.07] We have received enough messages, done')
                feederResolve("done");
            }
        }
    }

    const h = await getVisitorHandle(ourChannelName, 'visitor01')

    const s = await new ChannelSocket(h, myOnMessage, await aesTestProtocol()).ready
    console.log(SEP_, '[04.07] We are now listening for messages on channel:', h.channelId, SEP, /* JSON.stringify(h, null, 2), SEP */)

    await s.send('hello there from [04.07], we should be ready now = ' + new Date().toISOString())
        .catch((e: any) => { throw e })

    const intervalId = setInterval(() => {
        console.log(SEP_, `[04.07] sending message, counting down: #${messagesLeft}`)
        s.send({ t: `[#${messagesLeft}] ping from [04.07]`, ts: new Date().toLocaleString() })
            .catch((e: any) => { throw e })
        if (messagesLeft-- <= 0) {
            console.log(SEP_, '[04.07] Time is up, closing channel', SEP)
            clearInterval(intervalId);
            feederResolve("done");
        }
    }, interval * 1000);

    await feederPromise
    clearInterval(intervalId); // should be cleared already

    console.log("[04.07] [FEEDER] Feeder done ... closing channel, waiting a second")
    await new Promise(resolve => setTimeout(resolve, 1000))

    console.log("[04.07] [FEEDER] ... will try to close.")
    // you don't need to individually close them, but if you do, ChannelApi.closeAll() cleans up much faster
    await s.close()

    console.log("[04.07] [FEEDER] ... channel closed, feeder all wrapped.")


}

globalThis.addEventListener('error', (event) => {
    console.trace('Uncaught error:', event.error);
});

globalThis.addEventListener('unhandledrejection', (event) => {
    console.trace('Unhandled promise rejection:', event.reason);
});

// async function runTheCommand() {
//     SB = new ChannelApi(configuration.channelServer, configuration.DBG)
//     console.log(SB)
//     const ownerHandle = await getOwnerHandle(ourChannelName)
//     console.log(SEP_, "Owner handle:", ownerHandle.channelId, SEP)
//     await test01(numberOfMessages, messageIntervals)
//     console.log("Done ... closing all channels")
//     await ChannelApi.closeAll()
// }



Deno.test({
    name: "[slow] [channel] channel socket timeout / reset test",
    // ToDo: Deno complains that a web socket is left open, but currently
    //       i suspect a Deno issue rather than lib384
    sanitizeOps: false,  // Ignores unfinished async operations
    sanitizeResources: false,  // Ignores open resources like WebSockets
    async fn() {
        console.log('\n===================== 04.07 START channel socket test =====================')
        SB = new ChannelApi(configuration.channelServer, configuration.DBG)
        await test01(numberOfMessages, messageIntervals)
        console.log("[04.07] Tests done ... all went well ... calling ChannelApi.closeAll() ...")
        await ChannelApi.closeAll()
        console.log('\n===================== 04.07 END channel socket test   =====================')
    }
});


if (import.meta.main) { // tells Deno not to run this in the test suite
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await test01(numberOfMessages, messageIntervals)
    console.log("[04.07] Tests done ... all went well ... calling ChannelApi.closeAll() ...")
    await ChannelApi.closeAll()

}
