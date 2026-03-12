#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// sends a bunch of messages on a channel, checks and verifies that they are
// received in order. NOTE: whether TTL:0 is set or not makes a difference

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, Channel, ChannelSocket, Message, ChannelHandle, SBUserPrivateKey } from "../dist/384.esm.js"

// import { assert, assertThrows } from "@std/assert";

const SEP = '\n' + '='.repeat(76) + '\n'
const SEP_ = '='.repeat(76) + '\n'

let SB: ChannelApi

import { LocalStorage } from './test.utils.ts'
const localStorage = new LocalStorage('./.local.data.json');

async function getTest_04_05_handle(budgetKey: SBUserPrivateKey): Promise<ChannelHandle> {
    console.log("getTest_04_05_handle budget key (if needed)", budgetKey)
    let testHandle = localStorage.getItem(configuration.channelServer + '_unit_test_04_05_handle_run02')
    if (testHandle) {
        console.log("getTest_04_05_handle (found in local storage)", testHandle)
        return JSON.parse(testHandle)
    }
    else {
        const budgetChannel = await (new Channel(budgetKey)).ready
        const newHandle = await budgetChannel.budd()
        localStorage.setItem(configuration.channelServer + '_unit_test_04_05_handle_run02', JSON.stringify(newHandle))
        return newHandle
    }
}

// Wrap setTimeout in a promise that resolves after the async operation completes
function delay(ms: number, task: () => Promise<void>): Promise<void> {
    return new Promise(resolve => setTimeout(() => resolve(task()), ms));
}

type pingMsgType = {type: 'ping', i: number, payload: string}

// returns error message if there were issues, otherwise returns ''
async function testChannelSocket01(count: number = 4, interval: number = 500, verbose=false, ttlZero=false): Promise<string> {
    console.log("testChannelSocket01", count, interval, verbose)
    const TEST_COUNT = count;
    const MESSAGE_INTERVALS = interval;
    let nextExpected = 0;
    let previousServerTimestamp: number | undefined = undefined;
    let previousTimestamp: number | undefined = undefined;

    let errorFound = false
    

    const resolves: ((value: void | PromiseLike<void>) => void)[] = [];
    const messagesReceived = new Array(TEST_COUNT).fill(null).map((_, i) => 
        new Promise<void>(resolve => resolves[i] = resolve)
    );
    const messageReceivedFlag = new Array(TEST_COUNT).fill(false);

    const myOnMessage = (msg: Message | string) => {
        if (typeof msg === 'string') return;
        const message = msg.body as pingMsgType;

        if (messageReceivedFlag[message.i]) {
            // first check duplication
            console.log(SEP_, `**** ERROR: duplicate of message ${message.i} arrived, expected ${nextExpected}, delta ${nextExpected - message.i}:`, message.payload);
            errorFound = true;
        } else {
            // not a duplicate, check for ordering
            if (message.i !== nextExpected) {
                // out of order based on message internal counter
                console.log(SEP_, `**** message ${message.i} received out of order, expected ${nextExpected}, delta ${nextExpected - message.i}:`, message.payload);
                console.log("(sender, server timestamps): ", msg.senderTimestamp, msg.serverTimestamp);
                errorFound = true;
            } else {
                // it's in order so we can predict next one
                nextExpected = message.i + 1;
                // some (superfluous) lower level checks, these should never trigger
                if (previousServerTimestamp && msg.serverTimestamp < previousServerTimestamp)
                    console.log(SEP_, `**** ERROR: in order but message ${message.i} received with server timestamp ${msg.serverTimestamp} < previous timestamp ${previousServerTimestamp}`);
                if (previousTimestamp && msg.senderTimestamp < previousTimestamp)
                    console.log(SEP_, `**** ERROR: in order but message ${message.i} received with sender timestamp ${msg.senderTimestamp} < previous timestamp ${previousTimestamp}`);
            }
            // regardless of ordering issues, it's been received
            messageReceivedFlag[message.i] = true;
            resolves[message.i](undefined);
            previousServerTimestamp = msg.serverTimestamp;
            previousTimestamp = msg.senderTimestamp;
        }

    };

    const h = await getTest_04_05_handle(configuration.budgetKey);
    const s = await new ChannelSocket(h, myOnMessage).ready;

    console.log(SEP, `We are blasting out ${TEST_COUNT} messages on channel:`, SEP, JSON.stringify(h, null, 2), SEP);

    const tasks: Array<Promise<void>> = []
    if (MESSAGE_INTERVALS > 0) {
        for (let i = 0; i < TEST_COUNT; i++) {
            const task = delay(i * MESSAGE_INTERVALS, async () => {
                if (ttlZero) {
                    await s.send(
                        {type: 'ping', i: i, payload: `[${i}] hello world! (time: ` + Date.now() + ')'},
                        { ttl: 0 } // no history
                    );
                } else {
                    await s.send(
                        {type: 'ping', i: i, payload: `[${i}] hello world! (time: ` + Date.now() + ')'}
                    );
                }
                if (verbose) console.log(SEP_, `message ${i} sent`)
            });
            tasks.push(task);
        }

        console.log(SEP, `... waiting for all 'send' operations to have been started.`, SEP)
        await Promise.all(tasks);
    } else {
        for (let i = 0; i < TEST_COUNT; i++) {
            if (ttlZero) {
                await s.send(
                    {type: 'ping', i: i, payload: `[${i}] hello world! (time: ` + Date.now() + ')'},
                    { ttl: 0 } // no history
                );
            } else {
                await s.send(
                    {type: 'ping', i: i, payload: `[${i}] hello world! (time: ` + Date.now() + ')'}
                );
            }
            if (verbose) console.log(SEP_, `message ${i} sent`)
        }
        console.log(SEP, `... all 'send' operations have been started.`, SEP)
    }


    console.log(SEP, `... ${TEST_COUNT} messages have been sent. Waiting to check all of them coming back.`, SEP)
    await Promise.all(messagesReceived);
    console.log(SEP_, '\n')

    console.log("Closing channel socket ... (waiting)")
    await s.close()

    // if (outOfOrderCount > 0) {
    //     return `**** ERROR: ${outOfOrderCount} messages received out of order (${(outOfOrderCount / TEST_COUNT) * 100}% of messages received)`
    // } else if (duplicateMessages) {
    //     return `**** ERROR: some messages were received more than once`
    // } else {
    //     console.log(SEP, `**** SUCCESS: send and received ${TEST_COUNT} all messages received in order`, SEP);
    //     return ''
    // }

    if (errorFound) {
        return `**** ERROR: some messages (out of the ${TEST_COUNT}) were received out of order or more than once`
    } else {
        console.log(SEP, `**** SUCCESS: send and received ${TEST_COUNT} all messages received in order`, SEP);
        return ''
    }

}

Deno.test({
    name: "[DBG0] [slow] [channel] some basic ChannelSocket tests (TTL 0)",
    // ToDo: Deno complains that a web socket is left open, but currently
    //       i suspect a Deno issue rather than lib384
    sanitizeOps: false,  // Ignores unfinished async operations
    sanitizeResources: false,  // Ignores open resources like WebSockets
    async fn() {
        console.log('\n===================== 04.05 START channel test =====================')
        console.log(SEP, configuration, SEP)
        SB = new ChannelApi(configuration.channelServer, configuration.DBG)
        const result = await testChannelSocket01(100, 0, false, true)
        if (result) throw new Error(result);
        console.log("Tests done ... all went well ... calling ChannelApi.closeAll() ... ")
        await ChannelApi.closeAll()
        console.log('\n===================== 04.05 END channel test   =====================')

    }
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    // called if used from command line
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    const result = await testChannelSocket01(25000, 0, false, true) // for now testing with non-ephemeral
    if (result) console.log(SEP, result, SEP)
    // console.log(SEP, "Tests done ... calling ChannelApi.closeAll() ... ", SEP)
    // await ChannelApi.closeAll()
    // Deno.exit(0)
    console.log('done.')
}
