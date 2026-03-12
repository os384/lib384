#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// ToDo: this test hasn't been 'testified' yet

// this connects to a channel and generates messages

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

// the namespace for keys that this helper uses
const ourChannelName = 'test_08_xx'

const totalRuntime = 3 * 60 * 1000 // 3 minutes
const messageIntervals = 9.5 // seconds between messages

import {
    ChannelApi, ChannelSocket, Message, // Protocol_AES_GCM_256,
    ChannelHandle
// } from '../dist/384.esm.js'
} from "../dist/384.esm.js"

import { aesTestProtocol, getVisitorHandle } from './test.utils.ts'

const SEP = '\n' + '='.repeat(76) + '\n'
const SEP_ = '='.repeat(76) + '\n'

let SB: ChannelApi

async function feedSocket(h: ChannelHandle, runtime: number, interval: number)
{
    try {
        let timeLeft = runtime
        if (runtime < interval) {
            console.log("[test.08.03] Runtime is less than interval ... cancelling test")
            return
        }
        const myOnMessage = (msg: Message | string) => 
        {
            const m = (typeof msg === 'string') ? msg : msg.body
            console.log(SEP_, '[test.08.03] message received:', m);
        }

        const s = await new ChannelSocket(h, myOnMessage, await aesTestProtocol()).ready
        console.log(SEP_, '[test.08.03] We are now listening for messages on channel:', h.channelId, SEP, /* JSON.stringify(h, null, 2), SEP */)

        /* const r = */ await s.send('hello there from [test.08.03], we should be ready now' )

        const intervalId = setInterval(() => {
            console.log(SEP_, "[test.08.03] sending ping message")
            s.send({t: 'ping from [test.08.03]', ts: new Date().toLocaleString()});
            timeLeft -= interval * 1000
            if (timeLeft <= 0) {
                console.log(SEP_, '[test.08.03] Time is up, closing channel', SEP)
                s.close()
                clearInterval(intervalId);
            }
        }, interval * 1000);
        
    } catch (e: any) {
        console.error("[test.08.03] Error in feedSocket:", e)
        // let's print stack trace here
        console.error(e.stack)
    }
}

async function runTheCommand() {
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    const handle = await getVisitorHandle(ourChannelName, 'visitor_helper_05_01')
    await feedSocket(handle, totalRuntime, messageIntervals)
    await ChannelApi.closeAll()
}

// await runTheCommand()

console.log("[test.08.03] This test is not yet updated")