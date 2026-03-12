#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// this does similar to 04.05, using stream (queues)

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

// the namespace for keys that this test uses
const ourChannelName = 'test_08_xx_run02'

import {
    ChannelApi,
    Message,
    channel,
} from '../dist/384.esm.js'

import {
    getVisitorHandle, getOwnerHandle, aesTestProtocol, SEP, SEP_,
} from './test.utils.ts'

import { assert } from "../../deno_std/assert/assert.ts";

type pingMsgType = { i: number, t: string, ts: string, tag: string }


async function testStream01(PREFIX: string = '') {
    console.log("Starting testStream01")
    const TEST_COUNT = 4

    // generate a random 6 character alphanumeric string
    const randomString = Math.random().toString(36).substring(2, 8)

    // const PREFIX = '' // or '0' if we want history

    console.log("[08.01] Setting up owner ... ")
    const ownerHandle = await getOwnerHandle(ourChannelName)

    let lastReceived = -1;
    let outOfOrderCount = 0;
    const verbose = true

    const protocol = await aesTestProtocol()

    console.log("[08.01] Setting up visitor ... ")
    const visitorHandle = await getVisitorHandle(ourChannelName, 'visitor_08_01')

    console.log("[08.01] Setting up VISITOR stream ... ")
    const visitorChannelStream = await (new channel.stream(visitorHandle, protocol)).ready

    const messageHandler = (msg: Message | string) => {
        if (typeof msg === 'string') return;
        // console.log(`[${new Date(msg.senderTimestamp).toISOString()}] [08.01] VISITOR Got message: `, msg.body)
        const message = msg.body as pingMsgType;
        if (message.tag !== randomString) {
            console.log("[08.01] ++++ visitor skipping older message:\n", message)
        } else if (message.i) {
            if (lastReceived < 0) lastReceived = message.i - 1;
            lastReceived += 1
            if (message.i !== lastReceived) {
                console.log(SEP_, `[${new Date(msg.senderTimestamp).toISOString()}] [08.01] **** message ${message.i} received out of order:`, message);
                console.log("(sender, server timestamps): ", msg.senderTimestamp, msg.serverTimestamp);
                outOfOrderCount += 1;
            } else
                if (verbose) console.log(SEP_, `[${new Date(msg.senderTimestamp).toISOString()}] [08.01] [VISITOR] message ${message.i} received correctly:`, message, '\n', SEP_);
            // resolves[message.i](undefined);
        }
    };
    

    const visitorStream = visitorChannelStream.start({ prefix: PREFIX })
    const visitorPromise = new Promise<void>(async (resolve) => {
        for await (const message of visitorStream) {
            // if (verbose) console.log(SEP, "[08.01] [testStream01] message received:\n", message, SEP)
            messageHandler(message)
            if (lastReceived === TEST_COUNT - 1) {
                console.log(SEP, "[08.01] [testStream01] Visitor has received all messages, done", SEP)
                resolve(void 0)
            }
        }
    });

    console.log("[08.01] [testStream01] Visitor should be connected now, will start listening for messages on channelId: ", visitorHandle.channelId)

    // send a message from visitor to just kick tires
    await visitorChannelStream.send({ greeting: `[08.01] test message from 08.01 VISITOR on testStream01`, tag: randomString })

    // for await (const message of visitorChannelStream.start({ prefix: PREFIX })) {
    //     if (verbose) console.log(SEP, "[08.01] [testStream01] message received:\n", message, SEP)
    //     messageHandler(message)
    //     if (lastReceived === TEST_COUNT - 1) {
    //         console.log("[08.01] [testStream01] Visitor has received all messages, done")
    //         // break out of the for await ...
    //         break
    //     }
    // }

    // console.log("[08.01] [testStream01] Visitor has received all messages, done")


    // // OWNER will also listen in, on it's own stream object
    // const ownerChannelStream = await (new channel.stream(ownerHandle, protocol)).ready

    // const ownerPromise = new Promise<void>(async (resolve) => {
    //     for await (const message of ownerChannelStream.start({ prefix: PREFIX })) {
    //         if (verbose) console.log(SEP, "[08.01] [testStream01] OWNER received:\n", message, SEP)
    //     }
    //     resolve(void 0)
    // });

    // now let's set up owner and send a test message
    console.log("[testStream01] Connecting owner to channelID:", SEP, JSON.stringify(ownerHandle, null, 2), SEP)

    const owner = await (new channel.stream(ownerHandle, protocol)).ready
    console.log("[08.01] [testStream01] ... OWNER should be connected now, sending test message\n")
    for (let i = 0; i < TEST_COUNT; i++) {
        console.log(SEP, `[08.01] [OWNER] sending test message #${i} from 08.01 testStream01`, SEP)
        await owner.send({
            greeting: `[08.01] test message #${i} from 08.01 OWNER on testStream01`,
            i: i, // message counter
            tag: randomString,
        })
        // wait for one second here
        await new Promise((resolve) => setTimeout(resolve, 1000))
        if (verbose) console.log(SEP_, `[08.01] [OWNER] message ${i} sent`)
    }

    console.log("[08.01] [testStream01] Owner sent all test messages, now we wait and make sure visitor has received")

    await visitorPromise
    console.log("[08.01] ... visitorPromise resolved")

    await visitorChannelStream.close()
    await owner.close()

    console.log(SEP, "[08.01] [testStream01] All streams closed, done", SEP)
}

// async function testStream01() {
//     console.log("Starting testStream01")
//     const protocol = aesTestProtocol
//     const visitorHandle = await getVisitorHandle(ourChannelName, 'visitor_08_01')

//     const visitorChannelStream = await (new channel.stream(visitorHandle, protocol)).ready
//     console.log("[08.01]  ... stream set up, 'streamStarted' status is:", visitorChannelStream.streamStarted)

//     const visitorMessageHandler = (msg: Message | string) => {
//         console.log(SEP, "[08.01] [Visitor] Got message: ", msg)
//     };

//     const visitorStream = await visitorChannelStream.start()
//     for await (const message of visitorStream()) {
//         visitorMessageHandler(message)
//     }

//     console.log("[08.01] [testStream01] Visitor has received all messages, done")
// }

// // if used by "deno test ...", calls this:
// Deno.test("[fast] [channel] basic history test", async () => {
//     console.log('\n===================== 08.01 START stream test =====================')
//     SB = new ChannelApi(configuration.channelServer, configuration.DBG)
//     await testStream01()
//     await ChannelApi.closeAll()
//     console.log('\n===================== 08.01 END stream test   =====================')
// });

if (import.meta.main) { // tells Deno not to run this in the test suite
    // called if used from command line
    // const SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    const SB = new ChannelApi(configuration.channelServer, false)
    await testStream01('0')
    await ChannelApi.closeAll()

}



// async function testChannelSocket01(count: number = 4, interval: number = 500, verbose=false): string {
//     const TEST_COUNT = count;
//     const MESSAGE_INTERVALS = interval;
//     let lastReceived = -1;
//     let outOfOrderCount = 0;
//     const resolves: ((value: void | PromiseLike<void>) => void)[] = [];
//     const messagesReceived = new Array(TEST_COUNT).fill(null).map((_, i) => 
//         new Promise<void>(resolve => resolves[i] = resolve)
//     );
//     const myOnMessage = (msg: Message | string) => {
//         if (typeof msg === 'string') return;
//         const message = msg.body as pingMsgType;
//         lastReceived += 1
//         if (message.i !== lastReceived) {
//             console.log(SEP_, `**** message ${message.i} received out of order:`, message.payload);
//             console.log("(sender, server timestamps): ", msg.senderTimestamp, msg.serverTimestamp);
//             outOfOrderCount += 1;
//         } else
//             if (verbose) console.log(SEP_, `message ${message.i} received:`, message.payload);
//         resolves[message.i](undefined);
//     };
//     const h = await getTest_04_05_handle(configuration.budgetKey);
//     const s = await new ChannelSocket(h, myOnMessage).ready;
//     console.log(SEP, 'We are now listening for messages on channel:', SEP, JSON.stringify(h, null, 2), SEP);
//     const tasks: Array<Promise<void>> = []
//     for (let i = 0; i < TEST_COUNT; i++) {
//         const task = delay(i * MESSAGE_INTERVALS, async () => {
//             await s.send({type: 'ping', i: i, payload: `[${i}] hello world! (time: ` + Date.now() + ')'});
//             if (verbose) console.log(SEP_, `message ${i} sent`)
//         });
//         tasks.push(task);
//     }
//     await Promise.all(tasks); // all 'send' operations have been started
//     await Promise.all(messagesReceived);
//     console.log(SEP_, '\n')
//     if (outOfOrderCount > 0) {
//         const msg = `**** ERROR: ${outOfOrderCount} messages received out of order (${(outOfOrderCount / TEST_COUNT) * 100}% of messages received)`
//         return msg
//     } else {
//         console.log(SEP, `**** SUCCESS: send and received ${TEST_COUNT} all messages received in order`, SEP);
//         return ''
//     }
// }
