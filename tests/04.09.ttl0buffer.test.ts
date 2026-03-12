#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// has a 'feeder' that keeps sending messages, and a 'listener' that drops in after
// a little bit and should get all messages (including TTL0)

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { assertEquals } from "@std/assert"

// the namespace for keys that this helper uses
const ourChannelName = 'test_04_09'

const messageIntervals = 11 // in seconds; set to over 10 to test hibernation
const numberOfMessages = 3 // number of messages to send (at least 3)


import {
    ChannelApi, Channel, ChannelSocket, Message,
    ChannelHandle
} from '../dist/384.esm.js'
// } from "../dist/384.esm.js"

import { aesTestProtocol, getOwnerHandle, getVisitorHandle } from './test.utils.ts'

const SEP = '\n' + '='.repeat(76) + '\n'
const SEP_ = '='.repeat(76) + '\n'

let SB: ChannelApi

async function test01(count: number, interval: number) {
    let messagesLeft = count
    let messagesReceivedByFeeder = 0
    let messagesReceivedByListener = 0

    const feeder = await getVisitorHandle(ourChannelName, 'visitor01')
    const listener = await getVisitorHandle(ourChannelName, 'visitor02')

    let feederInterval

    let feederResolve, feederReject;
    const feederPromise = new Promise((resolve, reject) => {
        feederResolve = resolve;
        feederReject = reject;
    })

    const feederOnMyMessage = (msg: Message | string) => {
        const m = (typeof msg === 'string') ? msg : msg.body
        // console.log(SEP_, `++++ [FEEDER] [#${messagesReceivedByFeeder}] ++++ [04.09] message received:\n`, m);
        if (m.ts) {
            if (messagesReceivedByFeeder++ >= count) {
                console.log(SEP_, '[04.09] [FEEDER] We have received enough messages, done')
                feederResolve("done");
                clearInterval(feederInterval);
            }
        }
    }

    const listenerChannel = await new Channel(listener, await aesTestProtocol()).ready

    const feederSocket = await new ChannelSocket(feeder, feederOnMyMessage, await aesTestProtocol()).ready
    console.log(SEP_, '[04.09][FEEDER] now listening for messages on channel:', feeder.channelId, SEP, /* JSON.stringify(h, null, 2), SEP */)

    await feederSocket.send(
        'hello there from [04.09] [FEEDER], we should be ready now = ' + new Date().toISOString(),
        { ttl: 0 }
    )

    // after a 5 second delay, we connect to listener channle
    setTimeout(async () => {
        const messageKeys = await listenerChannel.getMessageKeys()
        if (messageKeys.keys.size > 0) {
            const messages = await listenerChannel.getMessageMap(messageKeys.keys)
            console.log(SEP, SEP_, '[04.09] [LISTENER] messages received:', messages, SEP_, SEP)
        } else {
            console.log(SEP, SEP_, '[04.09] [LISTENER] no messages received', SEP_, SEP)
        }
    }, messageIntervals * (numberOfMessages - 2) * 1000)


    feederInterval = setInterval(async () => {
        console.log(SEP_, `[04.09] [FEEDER] sending ping message #${messagesLeft}`)
        await feederSocket.send(
            { t: `[#${messagesLeft}] ping from [04.09] [FEEDER] (with TTL 0)`, ts: new Date().toLocaleString() },
            { ttl: 0 }
        ).catch(() => { console.log("FEEDER was not able to send another message ... are we closed?") });
        if (messagesLeft-- <= 0) {
            console.log(SEP_, '[04.09] [FEEDER] Time is up, closing channel', SEP)
            clearInterval(feederInterval);
            feederResolve("done");
        }
        console.log(SEP_, `[04.09] ... FEEDER succeeded in sending #${messagesLeft}`)

    }, interval * 1000);

    await feederPromise
    clearInterval(feederInterval); // should be cleared already

    // delay (await) for one second here
    await new Promise(resolve => setTimeout(resolve, 1000))

    console.log("[04.09] [FEEDER] ... will try to close.")
    await feederSocket.close()
    console.log("[04.09] [FEEDER] ... closed, all wrapped.")


}

globalThis.addEventListener('error', (event) => {
    console.trace('Uncaught error:', event.error);
});

globalThis.addEventListener('unhandledrejection', (event) => {
    console.trace('Unhandled promise rejection:', event.reason);
});


Deno.test({
    name: "[slow] [channel] channel socket timeout / reset test",
    // ToDo: Deno complains that a web socket is left open, but currently
    //       i suspect a Deno issue rather than lib384
    sanitizeOps: false,  // Ignores unfinished async operations
    sanitizeResources: false,  // Ignores open resources like WebSockets
    async fn() {
        console.log('\n===================== 04.09 START channel socket test =====================')
        SB = new ChannelApi(configuration.channelServer, configuration.DBG)
        await test01(numberOfMessages, messageIntervals)
        await ChannelApi.closeAll()
        console.log('\n===================== 04.09 END channel socket test   =====================')
    }
});


if (import.meta.main) { // tells Deno not to run this in the test suite
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await test01(numberOfMessages, messageIntervals)
    await ChannelApi.closeAll()
    console.log('done.')
}
