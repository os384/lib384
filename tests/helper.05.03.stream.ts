#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// 'helpers' are not unit tests, they are utilities to help with testing

// this is similar to trace, except uses a stream library object

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import {
    ChannelApi,
    channel
} from '../dist/384.esm.js'

import { aesTestProtocol, getOwnerHandle, getVisitorHandle } from './test.utils.ts'

const SEP = '\n' + '='.repeat(76) + '\n'

// the namespace for keys that this helper uses
const ourChannelName = 'test_08_xx' // overlaps with 08.* tests

new ChannelApi(configuration.channelServer, configuration.DBG) // side effects

async function traceChannelWithStream() {
    try {

        const ownerHandle = await getOwnerHandle(ourChannelName)
        console.log(SEP, "Will operate against channel:", ownerHandle.channelId, SEP)
        
        const handle = await getVisitorHandle(ourChannelName, 'visitor.05.03')

        console.log("We will be listening on stream:", SEP, handle, SEP, "with key:", SEP, handle.userPrivateKey, SEP)
        const c = await (new channel.stream(handle, await aesTestProtocol())).ready

        await c.send({ message: "test message from helper.05.03 stream tracer!", date: new Date().toISOString()})

        // now let's read all the messages
        for await (const message of await c.stream({ prefix: '0'}))
            console.log(SEP, "[05.03] [traceChannelWithStream] received:\n", message.body, SEP)
        
        console.log(SEP, "We are now listening for new messages", SEP)
    } catch (e: any) {
        console.trace("Error in traceChannel:", e)
    }
}

try {
    await traceChannelWithStream()
} catch (e: any) {
    console.trace("Error in traceChannelWithStream:", e)
}
