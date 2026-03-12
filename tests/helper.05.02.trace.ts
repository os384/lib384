#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// 'helpers' are not unit tests, they are utilities to help with testing

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import {
    ChannelApi, ChannelSocket, Message,
} from '../dist/384.esm.js'

import { getOwnerHandle, getVisitorHandle } from './test.utils.ts'

const SEP = '\n' + '='.repeat(76) + '\n'

const ourChannelName = 'test_05_02_run031'

new ChannelApi(configuration.channelServer, configuration.DBG)

async function traceChannel() {
    // not needed, but it forces initialization if needed
    const ownerHandle = await getOwnerHandle(ourChannelName)
    console.log("[helper.05.02] Got ownerhandle for channel ", ownerHandle.channelId)

    const handle = await getVisitorHandle(ourChannelName, 'visitor.05.02')

    // and now join that channel
    const myOnMessage = (msg: Message | string) => { console.log('[helper.05.02] message received:', msg) }
    const s = await new ChannelSocket(handle!, myOnMessage).ready
    console.log(SEP, "We are now listening for messages on:", SEP, s.channelId, SEP)
}

await traceChannel()
