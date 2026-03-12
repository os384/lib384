#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// performance benchmark. NOTE: this will set TTL to 0, so messages will not be stored

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

const COUNT = 512 * 8

import {
    ChannelApi, Channel, MessageOptions, ChannelSocket, Message, ChannelHandle, SBUserPrivateKey
// } from "../dist/384.esm.js"
} from '../dist/384.esm.js'

const SEP_ = '='.repeat(76) + '\n'

const prefix = "[04.06] [socket bench test]] "

const ourTestHandleName = configuration.channelServer + '_unit_test_04_06_handle_run005'

const ourChannelName = 'test_04_06_bench_run001'

import {
    getOwnerHandle, aesTestProtocol, SEP,
} from './test.utils.ts'

// if budget key provided, creates a new one-time handle for the test; otherwise
// it will reuse the same handle used by 08.02 (history) test cases
async function getTestHandle(budgetKey?: SBUserPrivateKey): Promise<ChannelHandle> {
    if (budgetKey) {
        let testHandle = localStorage.getItem(ourTestHandleName)
        if (testHandle) return JSON.parse(testHandle)
        else {
            const budgetChannel = await (new Channel(budgetKey)).ready
            const newHandle = await budgetChannel.budd()
            localStorage.setItem(ourTestHandleName, JSON.stringify(newHandle))
            return newHandle
        }
    } else {
        // const ownerHandle = await getOwnerHandle(ourTestHandleName, true)
        // const protocol = await aesTestProtocol()
        // const testChannel = await new Channel(ownerHandle, protocol).ready
        // console.log(prefix + "Using channelID for test:", testChannel.channelId)

        return getOwnerHandle(ourChannelName, true)
    }
}

type pingMsgType = { type: 'ping', i: number, payload: string }

let SB;

async function bench01(count: number, budgetKey?: SBUserPrivateKey): Promise<void> {

    const payloadLength = 64;

    let feederResolve, feederReject;
    const feederPromise = new Promise((resolve, reject) => {
        feederResolve = resolve;
        feederReject = reject;
    })

    const extraLoad = 'x'.repeat(payloadLength - 20) // 20 is the length of 'hello world! (time: 1234567890)

    // we have tried sending 10% more messages than we will count, to see if
    // that gives greater throughput, but it doesn't seem to make much a
    // difference, and of course will just stress the 'closeAll'
    
    // functionality const sendCount = Math.ceil(count * 1.1);

    const sendCount = count;
    let receivedCount = 0;
    const myOnMessage = (_msg: Message | string) => {
        if (++receivedCount === count) {
            const performanceEndTime = performance.now();
            console.log(SEP, `**** ${count} messages received in ${performanceEndTime - performanceStartTime}ms`, SEP);
            // calculate messages per second
            const messagesPerSecond = count / ((performanceEndTime - performanceStartTime) / 1000);
            console.log(`**** ${messagesPerSecond.toFixed(2)} messages per second`, SEP_);
            feederResolve(void 0); // Resolve the promise when benchmark is complete
        }
    };
    const h = await getTestHandle(budgetKey);
    const s = await new ChannelSocket(h, myOnMessage, await aesTestProtocol()).ready;
    console.log(SEP, 'Starting performance test on channel:', SEP, JSON.stringify(h, null, 2), SEP);
    const msgOptions: MessageOptions = { ttl: 0 };
    const performanceStartTime = performance.now();
    for (let i = 0; i < sendCount; i++) {
        s.send(
            { type: 'ping', i: i, payload: `[${i}] hello world! (time: ` + Date.now() + ')', extra: extraLoad },
            msgOptions
        )
            .catch((e) => console.error("Error sending message: ", e));
    }
    console.log(prefix + "We are done sending");
    await feederPromise;
    await s.close();
    console.log(prefix + "Channel closed");
}

Deno.test({
    name: "[slow] [channel] some basic ChannelSocket tests",
    // ToDo: Deno complains that a web socket is left open, but currently
    //       i suspect a Deno issue rather than lib384
    sanitizeOps: false,  // Ignores unfinished async operations
    sanitizeResources: false,  // Ignores open resources like WebSockets
    async fn() {
        console.log('\n===================== 04.06 START channel benchmark =====================')
        SB = new ChannelApi(configuration.channelServer, configuration.DBG);
        // test suite 'mode' always uses new test handles
        await bench01(100, configuration.budgetKey) // does not actually benchmark
        console.log("Tests done ... calling ChannelApi.closeAll() ... this might take >10 seconds")
        await ChannelApi.closeAll();
        console.log('\n===================== 04.06 END channel benchmark   =====================')
    }
});


if (import.meta.main) { // tells Deno not to run this in the test suite
    // called if used from command line
    SB = new ChannelApi(configuration.channelServer, configuration.DBG);
    await bench01(COUNT)
    console.log(prefix + "Tests initiated ... calling ChannelApi.closeAll() ... this might take >10 seconds")
    await ChannelApi.closeAll();
    console.log("TEST 04.06 DONE");
}
