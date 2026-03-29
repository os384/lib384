#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/*
 * Copyright (C) 2019-2021 Magnusson Institute
 * Copyright (C) 2022-2026 384, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

// the namespace for keys that this helper uses
const ourChannelName = 'test_08_xx' // overlaps with 08.* tests

const messageIntervals = 12     // seconds between messages (over 10 to test hibernation)
const numberOfMessages = 3      // number of messages to send

import {
    ChannelApi, ChannelSocket, Message, // Protocol_AES_GCM_256,
    ChannelHandle,
} from '../dist/384.esm.js'
    // ...

import { aesTestProtocol, getOwnerHandle, getVisitorHandle } from './test.utils.ts'

const SEP = '\n' + '='.repeat(76) + '\n'
const SEP_ = '='.repeat(76) + '\n'

let SB: ChannelApi

async function feedSocket(h: ChannelHandle, count: number, interval: number) {
    return new Promise(async (resolve, reject) => {
        try {
            let messageCounter = 0
            let messagesLeft = count
            let messagesReceived = 0
            let s: ChannelSocket

            const myOnMessage = (msg: Message | string) => {
                const m = (typeof msg === 'string') ? msg : msg.body
                console.log(SEP_, `++++ [#${messagesReceived}] ++++ [helper.05.01] message received:\n`, m);
                if (m.ts) {
                    if (messagesReceived++ >= count) {
                        console.log(SEP_, '[helper.05.01] We have received enough messages, done')
                        resolve("done");
                        return
                    }
                }
            }

            s = await new ChannelSocket(h, myOnMessage, await aesTestProtocol()).ready
            console.log(SEP_, '[helper.05.01] We are now listening for messages on channel:', h.channelId, SEP, /* JSON.stringify(h, null, 2), SEP */)

            /* const r = */ await s.send('hello there from [helper.05.01], we should be ready now = ' + new Date().toISOString())
                .catch((e: any) => { throw e })

            const intervalId = setInterval(async () => {
                console.log(SEP_, `[helper.05.01] sending ping message #${messageCounter}`)

                await s.send({ i: messageCounter, t: `[#${messageCounter}] ping from [helper.05.01] (${messagesLeft} left)`, ts: new Date().toLocaleString() })
                if (messagesLeft-- <= 0) {
                    console.log(SEP_, '[helper.05.01] Time is up, closing channel', SEP)
                    clearInterval(intervalId);
                }

                // let retries = 0
                // let keepTrying = true
                // while (keepTrying) {
                //     await s.send({ i: messageCounter, t: `[#${messageCounter}] ping from [helper.05.01] (${messagesLeft} left)`, ts: new Date().toLocaleString() })
                //         .then(() => {
                //             keepTrying = false
                //         })
                //         .catch(async (e: any) => {
                //             if (retries++ > 2) {
                //                 keepTrying = false
                //                 throw e
                //             }
                //             else {
                //                 s.reset()
                //                 await s.ready
                //             }

                //         })
                //         .finally(() => {
                //             if (keepTrying) {
                //                 console.log(SEP_, `[helper.05.01] Retrying (#${retries}) message #${messageCounter}`)
                //             }
                //         });
                //     }
                //     messageCounter++
                // if (messagesLeft-- <= 0) {
                //     console.log(SEP_, '[helper.05.01] Time is up, closing channel', SEP)
                //     // s.close()
                //     clearInterval(intervalId);
                // }


            }, interval * 1000);

        } catch (e: any) {
            console.error("[helper.05.01] Error in feedSocket:", e)
            // let's print stack trace here
            console.error(e.stack)
            reject(e)
        }
    });
}

window.addEventListener('error', (event) => {
    console.trace('Uncaught error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.trace('Unhandled promise rejection:', event.reason);
});

async function runTheCommand() {
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    const ownerHandle = await getOwnerHandle(ourChannelName) // for side-effect
    console.log("Ownerchannel ID: ", ownerHandle.channelId)
    const handle = await getVisitorHandle(ourChannelName, 'visitor01')
    console.log("Starting feedsocket ...")
    await feedSocket(handle, numberOfMessages, messageIntervals)
    console.log("Done ... closing all channels")
    await ChannelApi.closeAll()
}

(async () => {
    try {
        await runTheCommand();
    } catch (e) {
        console.error("[helper.05.01] Error in runTheCommand:", e);
        console.error(e.stack);
    }
})();
