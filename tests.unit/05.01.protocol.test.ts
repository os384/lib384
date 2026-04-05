#!/usr/bin/env -S deno run --allow-net --allow-read

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
const configuration = (globalThis as any).configuration

import { ChannelApi, SB384, Channel, arrayBufferToBase62, Protocol_ECDH,
    Protocol_AES_GCM_256, hydrateKey, ChannelHandle } from "../dist/384.esm.js"
import type { Protocol_KeyInfo, SBUserPrivateKey, SBUserPublicKey } from '../dist/384.esm.js'

import { SEP, SEP_ } from "./test.utils.ts"

// import type { PubKeyMessage, ChannelKeyMessage, ChatMessage } from "./test.utils.ts"

import { assert, /* assertThrows, assertRejects */ } from "@std/assert";

// this is the minimum info a channel owner needs to keep track of
// (we're not 'using' them here, just demonstrating rehydration)
var ownerPrivateKey: SBUserPrivateKey = "Xj3xL7s4Dz0LYRX8bt4E6CKfnBZqi2KOKlkQUftd1b0Q6pFBz0gsJb1y6vRGazyuYiGqC"
var ownerPublicKey: SBUserPublicKey = "PNk2REGPKGEYRCvXERSzmacmLUQfcNWyM4PM6N5xOthvupZGmR1aY9bKXRqI1HHrd2BiD"

let SB

async function test01() {
    // create a fresh channel
    const budgetChannel = await new Channel(configuration.budgetKey).ready

    // SB.create() returns a handle
    const newChannelHandle = await SB.create(budgetChannel)

    // we can then create a separate channel object for the new channel
    const newChannel = await new Channel(newChannelHandle).ready

    // note that channel is a child class of ChannelKeys, so it has all the key operations as well
    ownerPrivateKey = newChannel.userPrivateKeyDehydrated
    ownerPublicKey = newChannel.userPublicKey

    console.log(
        "\n",
        "======================================================================================\n",
        "New channel, full handle:\n",
        "======================================================================================\n",
        newChannel, "\n",
        "======================================================================================\n",
        "But you just need to keep track of dehydrated private key and public key:\n",
        "======================================================================================\n",
        " Private key:", ownerPrivateKey, "\n",
        "  Public key:", ownerPublicKey, "\n",
        "======================================================================================\n",
        "It has an implied channelId that somebody else can use to connect to it:\n",
        "======================================================================================\n",
        newChannel.channelId, "\n",
        "======================================================================================\n",
    )

}

var inviteAccessToken = "Xj33XcjtSnvKjquLctSF1T3Q0zJOxe62NJ3mu9DPuWQQf6KV7dWrgleXGJ"
    + "jb7pMikIJ2FMzLCMjKqsCp4ozGLiThR0QoYnGRn8fITovgGoVOUdmj9JTmgxONOdsn4PshfpIH8"

async function test02() {
    // owner creates an "access token"; this is simply a private key
    // that the owner configures the channel to accept connections from.

    const accessToken = await (new SB384()).ready
    inviteAccessToken = accessToken.userPrivateKey

    // we need to recover the channelId to tell this visitor to use

    // since we have minimal info, we first rehydrate a full key
    const fullOwnerKey = hydrateKey(ownerPrivateKey, ownerPublicKey)

    // we can create the channel straight off that, actually
    const newChannel = await new Channel(fullOwnerKey!).ready

    // and that object knows what channelId it would be
    const channelId = newChannel.channelId

    console.log(
        "\n",
        "++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "Send this to human/app VISITOR, through some means:", "\n",
        "++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "  ChannelId: ", channelId, "\n",
        " oneTimeKey: ", inviteAccessToken, "\n",
        "++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
    )

}

async function test03() {
    // now let's make sure our channel exists on the server, and that it's
    // working, and let's 'lock' it and then add the accessToken

    // ... we know what this is already ...
    const fullOwnerKey = hydrateKey(ownerPrivateKey, ownerPublicKey)
    const newChannel = await new Channel(fullOwnerKey!).ready

    newChannel.channelServer = configuration.channelServer
    const channelKeys = await newChannel.getChannelKeys()

    // some sanity checks
    assert(channelKeys.ownerPublicKey === ownerPublicKey)

    console.log(
        "\n", SEP,
        "Here are the channel keys we get back:",
        SEP,
        channelKeys,
        SEP
    )
}

async function test04() {
    // rehydrate our key, create channel, pick protocol and server

    const fullOwnerKey = hydrateKey(ownerPrivateKey, ownerPublicKey)
    const newChannel = await new Channel(fullOwnerKey!, new Protocol_ECDH()).ready
    newChannel.channelServer = configuration.channelServer
    await newChannel.send("Hello world! " + new Date().toISOString() + ` from Deno ${Date.now()}`)
    
    // now let's just send a few messages
    console.log("\n", SEP, "Let's try to send a few messages")
    await newChannel.send("Hello again world! " + new Date().toISOString() + ` from Deno ${Date.now()}`)
    await newChannel.send("Hello big world! " + new Date().toISOString() + ` from Deno ${Date.now()}`)
    await newChannel.send("Hello BIG world! " + new Date().toISOString() + ` from Deno ${Date.now()}`)
    console.log("... done sending messages")
}

async function test05() {
    const fullOwnerKey = hydrateKey(ownerPrivateKey, ownerPublicKey)
    const newChannel = await new Channel(fullOwnerKey!, new Protocol_ECDH()).ready
    newChannel.channelServer = configuration.channelServer

    console.log(
        "\n", SEP, 
        "Let's try to get pubkeys",
        SEP,
        await newChannel.getPubKeys(),
        SEP)

    const kh = await newChannel.getMessageKeys();
    const messageKeys = kh.keys
    console.log(
        "\n", SEP, 
        "Let's try to fetch message keys:",
        SEP,
        kh,
        SEP,
        messageKeys,
        SEP)

    const messages = await newChannel.getMessageMap(messageKeys)
    console.log(
        "\n", SEP, 
        "Now let's try to fetch and decrypt messages",
        SEP,
        messages,
        SEP)

    console.log("test05 done")
}

async function test06() {
    const privKey: SBUserPrivateKey = "Xj3xL7s4Dz0LYRX8bt4E6CKfnBZqi2KOKlkQUftd1b0Q6pFBz0gsJb1y6vRGazyuYiGqC"
    const pubKey: SBUserPublicKey   = "PNk2REGPKGEYRCvXERSzmacmLUQfcNWyM4PM6N5xOthvupZGmR1aY9bKXRqI1HHrd2BiD"

    // rehydrate our key, create channel, pick protocol and server
    const fullOwnerKey = hydrateKey(privKey, pubKey)

    const key = {
        salt1: new Uint8Array([179, 118, 123, 163, 161, 247, 188, 154, 75, 120, 116, 168, 126, 172, 251, 125]),
        iterations1: 100000,
        iterations2: 10000,
        hash1: "SHA-256",
        summary: "PBKDF2 - SHA-256 - AES-GCM"
    }

    // this allows me to send encrypted messages on any channel that only we can read

    // const budgetKey = "Xj32UgGbMee95wzU4FH6AiL2vLQ2csjgHsYUGmm04FTxpXXVbF8oegGZXQ"
    // + "8vtn5I97zembQkSu4CiBUXovmQRe1kj03qmhjD5iiPC87YYJngnA3xQoqko9rXGCZ4Oz7hzNzrN"

    // above is what it looks like
    const budgetKey = configuration.budgetKey

    const passPhrase = "this is a passphrase"

    const protocolWallet = new Protocol_AES_GCM_256(passPhrase, key)

    // const walletChannel = await new Channel(fullOwnerKey!, protocolWallet).ready

    // priv key of a budget channel

    const budgetChannel = await new Channel(budgetKey).ready

    // const SB = new ChannelApi(configuration.channelServer) // eb 'http://localhost:3845'

    const newChannelHandle = await SB.create(budgetChannel)
    console.log(
        "\n", SEP,
        "Create a fresh new channel:\n",
        SEP
    )

    // on new channel i use public key messaging
    const newChannel = await new Channel(newChannelHandle, new Protocol_ECDH()).ready
    console.log(
        "\n", SEP,
        "Let's try to send a few messages on the new channel\n",
        SEP
    )
    const m1 = await newChannel.send("Hello world! " + new Date().toISOString() + ` from Deno ${Date.now()}`)
    console.log("Response from first message sent was (should be 'success'):\n", m1)
    await newChannel.send("Hello again world! " + new Date().toISOString() + ` from Deno ${Date.now()}`)

    // now let's generate a session/ channel key
    const newChannelAESKey = arrayBufferToBase62(crypto.getRandomValues(new Uint8Array(48)))

    // share it on the channel
    await newChannel.send({ encryptionKey: newChannelAESKey})

    const messageKeys = await newChannel.getMessageKeys()
    console.log(
        "\n", SEP, 
        "Let's try to fetch message keys on our new channel:\n",
        SEP,
        messageKeys, "\n",
        SEP)

    const messages = await newChannel.getMessageMap(messageKeys.keys)
    console.log(
        "\n", SEP, 
        "Now let's try to fetch and decrypt the ECDH messages\n",
        SEP,
        messages, "\n",
        SEP)

    console.log("Sending special message with passphrase encryption")

    // // now we create a special test message encrypted with passphrase
    // const sbm = new SBMessage(newChannel, { message: `${Date.now()} sent using SBM object, and new key` }, { protocol: protocolWallet })
    // await sbm.send()

    await newChannel.send({ message: `${Date.now()} sent using channel.send` }, { protocol: protocolWallet })
    
    // we now create a different channel object, with the passphrase protocol, for the 'same' channel
    const newChannel2 = await new Channel(newChannelHandle, protocolWallet).ready

    // and we send passphrase on it
    await newChannel2.send({ message: `${Date.now()} sent using different protocol, using channel.send` })

    const messageKeys2 = await newChannel2.getMessageKeys()
    const messages2 = await newChannel2.getMessageMap(messageKeys2.keys)
    console.log(
        "\n", SEP, 
        "Here we should only get the AES256 protocol messages\n",
        SEP,
        messages2, "\n",
        SEP)

    console.log("test06 done")

}

async function test07a() {
    const channelServer = configuration.channelServer // eg "http://localhost:3845"

    // this is what we start with (the human)
    const passPhrase = "this is a passphrase"

    // create key 'info' (in this case salt, iterations, key length)
    const key = await Protocol_AES_GCM_256.genKey()
    console.log("key:", key)

    // this is a 'budget' channel, basically a channel we use as funding source, and record keeping

    // const budgetKey = "Xj32UgGbMee95wzU4FH6AiL2vLQ2csjgHsYUGmm04FTxpXXVbF8oegGZXQ"
    // + "8vtn5I97zembQkSu4CiBUXovmQRe1kj03qmhjD5iiPC87YYJngnA3xQoqko9rXGCZ4Oz7hzNzrN"

    // above is what it looks like
    const budgetKey = configuration.budgetKey

    // 'ECDH' protocol is the simplest, it just uses public/private keys
    
    const budgetChannel = await new Channel(budgetKey, new Protocol_ECDH()).ready

    // we now create a brand new channel
    // const SB = new ChannelApi(channelServer)
    const newChannelHandle = await SB.create(budgetChannel)
    
    // .. so we can messages 'ourselves' with the key parameters, so we know them next time
    budgetChannel.channelServer = channelServer
    await budgetChannel.send({
        type: 'channel_v2',
        channelId: newChannelHandle.channelId,
        keyParams: key,
        timeStamp: Date.now() })

    // .. and we need to store the keys to the new channel.
    // .. but .. hm, we want some additional protection on that, so let's wrap that with our passphrase
    const protocol = new Protocol_AES_GCM_256(passPhrase, key)
    const budgetChannel_2 = await new Channel(budgetKey, protocol).ready
    // it's fine do have different simultaneous 'views' on a channel (with different protocols)

    budgetChannel_2.channelServer = channelServer
    await budgetChannel_2.send({
        type: 'channelKeys_v2',
        channelId: newChannelHandle.channelId,
        handle: newChannelHandle,
        timeStamp: Date.now() })

}

async function test07b() {
    const channelServer = configuration.channelServer // eg "http://localhost:3845"

    // this is what we start with (the human)
    const passPhrase = "this is a passphrase"

    // we pick up the record from 07a
    // const budgetKey = "Xj32UgGbMee95wzU4FH6AiL2vLQ2csjgHsYUGmm04FTxpXXVbF8oegGZXQ"
    //     + "8vtn5I97zembQkSu4CiBUXovmQRe1kj03qmhjD5iiPC87YYJngnA3xQoqko9rXGCZ4Oz7hzNzrN"

    // above is what it looks like
    const budgetKey = configuration.budgetKey

    const budgetChannel = await new Channel(budgetKey, new Protocol_ECDH()).ready
    budgetChannel.channelServer = configuration.channelServer // eg 'http://localhost:3845'

    const messageKeys = await budgetChannel.getMessageKeys()
    console.log("\n", SEP, "Let's try to fetch message keys on our new channel:\n", SEP, messageKeys, "\n",  SEP)

    const messages = await budgetChannel.getMessageMap(messageKeys.keys)
    console.log(`Found ${messages.size} messages`)

    // let's find the channel key message
    var channelMessage: any
    for (const [_key, value] of messages.entries()) {
        console.log("value:", value.body)
        if (value.body.type === 'channel_v2') {
            channelMessage = value.body
            break
        }
    }

    console.log("Found channel message:\n", channelMessage)
    const keyInfo = channelMessage.keyParams as Protocol_KeyInfo
    console.log("Key info:\n", keyInfo)

    // so now we can open another 'channel' (connection) with those keys for protocol
    const protocol = new Protocol_AES_GCM_256(passPhrase, keyInfo)

    const budgetChannel_2 = await new Channel(budgetKey, protocol).ready
    budgetChannel_2.channelServer = channelServer
    // note that we can re-use the messageKeys .. the set of messages is the same
    const messages_2 = await budgetChannel_2.getMessageMap(messageKeys.keys)

    var channelKeyMessage: any
    for (const [key, value] of messages_2.entries()) {
        if (value.body.type === 'channelKeys_v2' && value.body.channelId === channelMessage.channelId) {
            channelKeyMessage = value.body
            break
        }
    }
    if (channelKeyMessage) {
        console.log("Found channel key message:\n", channelKeyMessage)
        const handle = channelKeyMessage.handle as ChannelHandle
        console.log("So if everything worked .. this should be a complete handle\n", handle)
    } else {
        console.log("**** No channel key message found")
    }

}


// TODO: DBG0
// Deno.test("[fast] [channel] basic SB384 crypto tests - part 2", async () => {
//     console.log('\n===================== 05.01 START protocol =====================')
//     SB = new ChannelApi(configuration.channelServer, configuration.DBG)
//     await test01()
//     await test02()
//     await test03()
//     await test04()
//     await test05()
//     await test06()
//     await ChannelApi.closeAll()
//     console.log('=====================   05.01 END protocol   =====================')
// });

if (import.meta.main) { // tells Deno not to run this in the test suite
    // command line used for iterative unit test development
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await test01()
    await test02()
    await test03()
    await test04()
    await test05()
    await test06()
    await test07a()
    await test07b()
}
