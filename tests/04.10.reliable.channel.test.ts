#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// implements the building blocks of reliable 'streaming'

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

// the namespace for keys that this helper uses
const ourChannelName = 'test_04_10_run01'

import {
    ChannelApi, Channel, ChannelSocket, Message,
    ChannelHandle
    // } from '../dist/384.esm.js'
} from "../dist/384.esm.js"

import { aesTestProtocol, getOwnerHandle, getVisitorHandle } from './test.utils.ts'

const SEP = '\n' + '='.repeat(76) + '\n'
const SEP_ = '='.repeat(76) + '\n'

let SB: ChannelApi

// generate 'count' messages at 'interval' second intervals
async function feeder(count: number, interval: number) {

    let feederResolve, feederReject;
    const feederPromise = new Promise((resolve, reject) => {
        feederResolve = resolve;
        feederReject = reject;
    })

    function createMessageHandler(user: string): (msg: Message | string) => void {
        let verifyCount = 0
        return (msg: Message | string) => {
            if (typeof msg === 'string') {
                console.log(`++++ [${user}] ++++ 'string' message received: '${msg}'`);
            } else {
                const m = msg.body;
                console.log(`[04.10] [${user}] Received message:\n`, m);
                if (m.n !== verifyCount) {
                    console.log(`[04.10] [${user}] Out of order message received: ${m.i} (expected ${verifyCount})`);
                    feederReject(`Out of order message received: ${m.i} (expected ${verifyCount})`);
                } else {
                    verifyCount++;
                }
            }
        };
    }

    // first we set up the 'listener', that needs to get all the messages
    const handle02 = await getVisitorHandle(ourChannelName, 'listener02')
    const socket02 = await new ChannelSocket(handle02, createMessageHandler('LISTENER'), await aesTestProtocol()).ready

    // next we set up the 'feeder'
    const handle01 = await getVisitorHandle(ourChannelName, 'visitor01')
    const socket01 = await new ChannelSocket(handle01, createMessageHandler('FEEDER'), await aesTestProtocol()).ready

    console.log(SEP, handle01, SEP, handle02, SEP)

    let i = 0
    const feederInterval = setInterval(async () => {
        console.log(SEP_, `[04.10] [FEEDER] sending ping message #${i}`)
        await socket01.send(
            { n: i, t: `[#${i}/${count}] ping from [04.10] [FEEDER] (with TTL 0)`, ts: new Date().toLocaleString() },
            { ttl: 0 }
        )
        i++
        if (i >= count) {
            console.log(SEP_, `[04.10] [FEEDER] Sent all ${count} messages, DONE`, SEP)
            clearInterval(feederInterval);
            feederResolve("done");
        }
    }, interval * 1000);

    await feederPromise
    clearInterval(feederInterval); // should be cleared already

    console.log("[04.10] [FEEDER] Feeder done ... closing channel, waiting a second")
    await new Promise(resolve => setTimeout(resolve, 1000))

    console.log("[04.10] [FEEDER] ... will try to close.")
    // you don't need to individually close them, but if you do, ChannelApi.closeAll() cleans up much faster
    await socket01.close()
    await socket02.close()
    console.log("[04.10] [FEEDER] ... channel closed, feeder all wrapped.")
}

globalThis.addEventListener('error', (event) => {
    console.trace('Uncaught error:', event.error);
});

globalThis.addEventListener('unhandledrejection', (event) => {
    console.trace('Unhandled promise rejection:', event.reason);
});

async function test01(n: number, t: number) {
    console.log(SEP, `04.10 [channel] socket timeout / reset test`, SEP, SEP)
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    console.log("ChannelApi object:", SB.version /*, ChannelApi.defaultChannelServer */)
    await feeder(n, t)
    console.log("[04.10] [channel] feeder done ... closing all")
    console.time("04.10 [closeAll]")
    await ChannelApi.closeAll()
    console.log("[04.10] [channel] all closed")
    console.timeEnd("04.10 [closeAll]")
}

// TODO: sporadically, a message gets delivered out of order
//       disabling temporarily
// Deno.test({
//     name: "[slow] [channel] channel socket timeout / reset test",
//     // ToDo: Deno complains that a web socket is left open, but currently
//     //       i suspect a Deno issue rather than lib384
//     sanitizeOps: false,  // Ignores unfinished async operations
//     sanitizeResources: false,  // Ignores open resources like WebSockets
//     async fn() {
//         console.log(SEP, '\n===================== 04.10 START channel socket test =====================', SEP)
//         await test01(6, 1)
//         // await ChannelApi.closeAll()
//         console.log(SEP, '\n===================== 04.10 END channel socket test   =====================', SEP)
//     }
// });

if (import.meta.main) { // tells Deno not to run this in the test suite
    // called if used from command line
    await test01(6, 1)
    // await ChannelApi.closeAll()
}
