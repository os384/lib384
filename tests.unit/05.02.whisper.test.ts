#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

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
import '../keys.js'
import '../config.js'

export const ourChannelName = 'test_05_02_run039'

import {
    ChannelApi, SB384, ChannelStream, Protocol_ECDH,
} from "../dist/384.esm.js"

import { SEP, getOwnerHandle, getVisitorHandle } from "./test.utils.ts"

const configuration = (globalThis as any).configuration

const ownerHandle = await getOwnerHandle(ourChannelName, true)
const aliceHandle = await getVisitorHandle(ourChannelName, "Alice")
const bobHandle = await getVisitorHandle(ourChannelName, "Bob")


// since we're in a unit test, we have the private keys of all the parties.
// however, 'other' parties won't. we we first proceed to create separate
// SB384 objects for all parties.

// first, 384 objects that only the respective parties would have
const alice384private = await new SB384(aliceHandle.userPrivateKey).ready
const bob384private = await new SB384(bobHandle.userPrivateKey).ready
const owner384private = await new SB384(ownerHandle.userPrivateKey).ready

const alicePublicKey = alice384private.userPublicKey
const bobPublicKey = bob384private.userPublicKey
const ownerPublicKey = owner384private.userPublicKey

// sanity check. everybody's channelData.ownerPublicKey should be the same
if ((ownerHandle.channelData?.ownerPublicKey !== ownerPublicKey)
    || (aliceHandle.channelData?.ownerPublicKey !== ownerPublicKey)
    || (bobHandle.channelData?.ownerPublicKey !== ownerPublicKey))
    throw new Error("Owner public key mismatch")

// these are the 384 objects that everybody would have
const alice384public = await new SB384(alicePublicKey).ready
const bob384public = await new SB384(bobPublicKey).ready
const owner384public = await new SB384(ownerPublicKey).ready

// these are the short form user identities. Channels can convert these to
// full public keys as needed. these IDs are what you would use in directed
// (routed) messages, or internally for tracking. they're unique for any user.
const aliceID = alice384public.userId
const bobID = bob384public.userId
const ownerID = owner384public.userId

// if Protocol.ts is in DBG0/DBG2 mode, it will output more easily readable names
Protocol_ECDH.keyToName = new Map([
    [aliceID, "Alice"],
    [bobID, "Bob"],
    [ownerID, "Owner"],
    [alicePublicKey, "<Alice's Public Key>"],
    [bobPublicKey, "<Bob's Public Key>"],
    [ownerPublicKey, "<Owner's Public Key>"],
])

// const prefix = "[05.02] [whisper] "
const prefix = ""

let SB: ChannelApi;

// we omit the protocol, since ECDH (whisper) is default
const aliceStream = await new ChannelStream(aliceHandle).ready
const bobStream = await new ChannelStream(bobHandle).ready
const ownerStream = await new ChannelStream(ownerHandle).ready

async function closeStreams() {
    return Promise.all([
        aliceStream.close(),
        bobStream.close(),
        ownerStream.close()
    ])
}

function helloMessage(fromName: string, toName: string) {
    return `Hello ${toName}! This is ${fromName}! ` + new Date().toISOString() + ` ${Date.now()}`
}

console.log(SEP)
console.log(prefix + "           Channel ID:", ownerHandle.channelId)
console.log(prefix + " Owner ID, public key:", ownerID, ownerPublicKey.slice(4))
console.log(prefix + " Alice ID, public key:", aliceID, alicePublicKey.slice(4))
console.log(prefix + "   Bob ID, public key:", bobID, bobPublicKey.slice(4))
console.log(SEP)

// visitors will join, and say hello, which will only be seen by Owner
async function visitorReader(name: string, c: ChannelStream, sendMessage: string, expectMessage: string) {
    await c.send(sendMessage)
    console.log(prefix + `[${name}] Sent PRIVATE message, should only get to Owner. Awaiting response.`)
    for await (const message of c.start({ prefix: '0' })) {
        console.log(prefix + `[${name}] Received PRIVATE message: "${message.body}"`)
        if (message.body === expectMessage) {
            console.log(prefix + `[${name}] Received expected message, exiting visitorReader()`)
            return
        }
    }
}

async function test01() {
    // pre-determined 'hello' messages and owner replies
    const aliceHello = helloMessage("Alice", "Owner")
    const bobHello = helloMessage("Bob", "Owner")
    const OwnerToAlice = helloMessage("Owner", "Alice")
    const OwnerToBob = helloMessage("Owner", "Bob")

    const specialOwnerMessage = "hello owner from owner - alice and bob are done! " + new Date().toISOString()

    console.log(
        SEP,
        "Expected messages:\n",
        "Alice -> Owner:", "'" + aliceHello + "'", "\n",
        "Bob -> Owner:", "'" + bobHello + "'", "\n",
        "Owner -> Alice:", "'" + OwnerToAlice + "'", "\n",
        "Owner -> Bob:", "'" + OwnerToBob + "'",
        SEP);

    const p1 = visitorReader("Alice", aliceStream, aliceHello, OwnerToAlice)
    const p2 = visitorReader("Bob", bobStream, bobHello, OwnerToBob)
    const p3 = visitorReader("Owner", ownerStream, "... <owner reader starting> ...", specialOwnerMessage)

    console.log(prefix + "Started test01(); fired up Alice and Bob, waiting for their hellos to Owner")

    console.log(prefix + ".... delaying a bit ...")
    // TODO: if i dial this delay down to a small number, then sometimes either Alice or Bob
    // do not pick up their wrap-up message. but ChannelStream should have eventual consistency
    // on all messages, so, that shouldn't happen.
    await new Promise(resolve => setTimeout(resolve, 600)) // wait a bit
    console.log(prefix + ".... continuing ...")

    console.log(prefix + "[Owner] Sending messages to Alice and Bob, waiting for sends to complete ...")
    await Promise.all([
        ownerStream.send(OwnerToAlice, { sendTo: aliceID }),
        ownerStream.send(OwnerToBob, { sendTo: bobID })
    ])
    console.log(prefix + "[Owner] ... messages sent ... owner telling owner listener to shut down")
    await ownerStream.send(specialOwnerMessage)

    console.log(prefix + "[Owner] ... messages sent ... awaiting all listeners to complete ...")
    await Promise.all([p1, p2, p3]);
    console.log(prefix + "Got expected messages from Alice and Bob. Shutting down streams ...")
    await closeStreams()
    console.log(prefix + "*+*+*+*+*+ test01() completed.")
}

// user's private key and 'other' parties' public key
async function deriveKey(privateKey: CryptoKey, publicKey: CryptoKey) {
    const k = await crypto.subtle.deriveKey(
        {
            name: 'ECDH',
            public: publicKey
        },
        privateKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    const v = (await crypto.subtle.exportKey('jwk', k)).k
    return v
}

async function test02() {
    console.log(SEP, "Verifying various key relationships (skipping prefixes)", SEP);
    console.log(`Alice [${alice384private.userId}] when sending/receiving:`, await deriveKey(alice384private.privateKey, owner384public.publicKey));
    console.log(`Owner [${owner384private.userId}] when sending/receiving:`, await deriveKey(owner384private.privateKey, alice384public.publicKey));
    console.log(SEP)
    console.log("Alice full public key:", alice384public.userPublicKey.slice(4))
    console.log("Alice full private key:", alice384private.userPrivateKey.slice(4))
    console.log("Bob full public key:", bob384public.userPublicKey.slice(4))
    console.log("Bob full private key:", bob384private.userPrivateKey.slice(4))
    console.log(SEP)
}


Deno.test("[slow] [channel] basic whisper (ECDH) test", async () => {
    console.log('\n===================== 05.02 START whisper =====================')
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await test02()
    await test01()
    await ChannelApi.closeAll()
    console.log('===================== 05.02 END whisper =====================')
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    // command line used for iterative unit test development
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await test02()
    await test01()
    await ChannelApi.closeAll()
}


// async function listen(s: ChannelStream, listener: string) {
//     for await (const message of s.start({ prefix: '0', live: true })) {
//         console.log(`[${listener}] Received message: "${message.body}"`);
//     }
// }


// async function privateSendSingle(senderHandle: ChannelHandle, senderName: string, recipientID: SBUserId, recipientName: string) {
//     const protocol = new Protocol_ECDH()
//     const s = await new ChannelStream(senderHandle, protocol).ready
//     listen(s, senderName)
//     // wait a bit
//     await new Promise(resolve => setTimeout(resolve, 500))
//     const msg = `Hello ${recipientName}! This is SINGLETON from ${senderName}! ` + new Date().toISOString() + ` ${Date.now()}`;
//     console.log("Sending SINGLETON to ALICE:", msg);
//     s.send(msg, { sendTo: recipientID, ttl: 8 });
// }


// async function privateSender(senderHandle: ChannelHandle, senderName: string, recipientID: SBUserId, recipientName: string) {
//     let keepRunning = true
//     const protocol = new Protocol_ECDH()
//     const s = await new ChannelStream(senderHandle, protocol).ready
//     const timeout = (ms: number) => new Promise(resolve => setTimeout(async () => {
//         keepRunning = false;  // Set the flag to false after the timeout
//         console.log("****** timing out ******")
//         await s.close()
//         resolve(void 0);
//     }, ms));
//     Promise.race([
//         (async () => {
//             let i = 0;
//             while (true) {
//                 const msg = `Hello ${recipientName}! This is ${senderName}! ` + new Date().toISOString() + ` from Deno ${Date.now()}` + ` #${i++}`;
//                 console.log("Sending to ALICE:", msg);
//                 s.send(msg, { sendTo: recipientID, ttl: 8 });
//                 await new Promise(resolve => setTimeout(resolve, 1000));
//                 if (!keepRunning) break;
//             }
//         })(),
//         (async () => {
//             for await (const message of s.start({ prefix: '0', live: true})) {
//                 console.log(`${senderName} received PRIVATE message: "${message.body}"`);
//                 if (!keepRunning) break;
//             }
//         })(),
//         timeout(3000)
//     ]);


// }

// async function ownerSendBroadcast() {
//     const ownerBroadcast = await new Channel(ownerHandle).ready
//     let i = 0
//     while (true) {
//         ownerBroadcast.send(
//             "Hello Everybody! " + new Date().toISOString() + ` from Deno ${Date.now()}` + ` #${i++}`)
//         await new Promise(resolve => setTimeout(resolve, 1000))
//     }
// }

