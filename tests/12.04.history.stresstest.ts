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
export const runName = "unit_test_12_04_run02"

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, Channel, ChannelHandle, ChannelStream, SBUserPrivateKey } from "../dist/384.esm.js"

const SEP = '\n' + '='.repeat(76) + '\n'

let SB: ChannelApi

import { LocalStorage } from './test.utils.ts'
const localStorage = new LocalStorage('./.local.data.json');

async function getTest_12_04_handle(budgetKey: SBUserPrivateKey): Promise<ChannelHandle> {
    console.log("getTest_12_04_handle budget key (if needed)", budgetKey)
    let testHandle = localStorage.getItem(configuration.channelServer + '_' + runName)
    if (testHandle) {
        console.log("getTest_12_04_handle (found in local storage)", testHandle)
        return JSON.parse(testHandle)
    }
    else {
        const budgetChannel = await (new Channel(budgetKey)).ready
        const newHandle = await budgetChannel.budd()
        localStorage.setItem(configuration.channelServer + '_' + runName, JSON.stringify(newHandle))
        return newHandle
    }
}

let channelHandle: ChannelHandle

async function connectToChannel() {
    channelHandle = await getTest_12_04_handle(configuration.budgetKey)
    console.log(SEP, "Channel handle:", channelHandle)
}

interface MessageStreamOptions {
    start?: number;
    end?: number;
    live?: boolean;
}

import { addSomeMessages } from './12.02.message.iterator.ts'

async function getState(ch: ChannelStream, r = runName) {
    const stateKey = r + '_kv_state';
    let state = await ch.get(stateKey)
    if (!state) {
        console.log(SEP, "State not found, creating ...")
        state = { counter: 0 }
        await ch.put(stateKey, state)
    }
    console.log(SEP, `State ['${stateKey}']:`, '\n', state)
    return state
}

/**
 * Validate messages in order, no duplicates, no missing messages. startIndex
 * is always the *lowest* ndx we expect, and expectedCount is the number of
 * messages we expect to see. If forward is false, we expect the messages to
 * be in reverse order.
 */
function valid01(startIndex: number, expectedCount: number, forward: boolean) {
    const startingPoint = forward ? startIndex : startIndex + expectedCount - 1; // tracks expected next ndx
    let n = startingPoint
    let errorFound = false;
    let c = 0; // raw count of (unique) messages received
    const seen = new Array(expectedCount).fill(false)
    const D = forward ? 1 : -1;

    return async function (m: any) {
        if (seen[m.body.ndx - startIndex]) {
            console.error("Duplicate message found:", m.body.ndx);
            errorFound = true;
            n = m.body.ndx + D;
        } else {
            seen[m.body.ndx - startIndex] = true;
            c += D;
            if (c > expectedCount) throw new Error("Too many messages")
            if (n === startingPoint && m.body.ndx !== startingPoint) {
                console.error(`First message not ${startingPoint}, got:`, m.body.ndx);
                errorFound = true;
                n = m.body.ndx + D;
            } else if (m.body.ndx < n) {
                console.error("Message out of order, expected:", n, "got:", m.body.ndx);
                errorFound = true;
            } else if (m.body.ndx !== n) {
                errorFound = true;
                n = m.body.ndx + D;
            } else {
                n++;
            }
        }

        return { errorFound, n, c, seen };  // Return current state
    };
}

function validateSeen(seen: boolean[], startingPoint: number) {
    let errorFound = false
    for (let i = 0; i < seen.length; i++) {
        if (!seen[i]) {
            console.error("Message not found (dropped):", i + startingPoint)
            errorFound = true
        }
    }
    return errorFound
}


async function runTest03() {
    const ch = await new ChannelStream(channelHandle).ready
    try {
        // await addSomeMessages(93, ch, runName)

        let state = await getState(ch, runName)
        console.log(SEP, "State after adding messages:", '\n', state)

        // top up to at least 1500 messages
        if (state.counter < 1500) {
            await addSomeMessages(1500 - state.counter, ch, runName)
            state = await getState(ch, runName)
        }

        // optionally provide range(s), direction, and whether to keep getting new messages
        let options: MessageStreamOptions = {
            start: 1729223898084, // ndx 1626
            // end: Infinity,
            // live: true,
        };

        const skipNumber = 17
        const startingPoint = 1643 // 1626 + 17
        const expectedCount = state.counter - skipNumber - 1626
        let messageValidator = valid01(startingPoint, expectedCount, false);

        // first, we look at all the messages, make sure we have the number we are supposed to have,
        // and that we get them in the right order
        console.log(SEP, "Starting FULL FORWARD test", SEP)
        let result
        await (await ch.spawn(options))
            .skip(skipNumber)
            .take(expectedCount)
            .forEach(async (m) => {
                // console.log("Message index:", m.body.ndx, m.serverTimestamp);
                result = await messageValidator(m);
            });

        if (result.errorFound || validateSeen(result.seen, startingPoint))
            console.error(SEP, "Error found in FULL FORWARD test", SEP)
        else
            console.log(SEP, "Total messages read (correctly):", result.c, SEP)

    } catch (e) {
        console.error(SEP, "[runTest03] Caught exception (ending test):", SEP, e, SEP, "Channel (ch):", ch.handle, SEP)
    }

}


// @ts-ignore
if (import.meta.main) {
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await connectToChannel()

    // await runTest01()
    // await runTest02()
    await runTest03()
    // await runTest04()
    // await runTest05()
    // await runTest06()

    // inspectAPIEndpoint(crypto, 'crypto');
    // inspectAPIEndpoint(crypto.subtle, 'crypto.subtle');


    console.log(SEP, "Main done ...", SEP)


}




