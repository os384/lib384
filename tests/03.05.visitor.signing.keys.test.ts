#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write

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

import { ChannelApi, SB384, ChannelHandle, ChannelKeys, sbCrypto, assemblePayload, extractPayload, base62ToArrayBuffer, arrayBufferToBase62 } from "../dist/384.esm.js"
import type { ChannelMessage, SBUserId, SBUserPublicKey } from '../dist/384.esm.js'

import { inspectBinaryData, printChannelKeys, deriveKey } from "./test.utils.ts"
import type { PubKeyMessage, ChannelKeyMessage, ChatMessage } from "./test.utils.ts"
import { assert } from '../../deno_std/assert/assert.ts'

const configuration = (globalThis as any).configuration

const DBG0 = true

interface VisitorSigningKey {
    channelId: string
    publicKey: string
    signedBy: string
    expires: number
    signature: string
}

async function signVisitorSigningKey(channel: ChannelKeys, publicKey: string, expires: number): Promise<VisitorSigningKey> {
    assert(channel.channelId, "[VSK] Sign: Channel ID is not set")
    assert(channel.signKey, "[VSK] Sign: Signing key is not set")
    const buffer = new TextEncoder().encode(`${channel.channelId} ${publicKey} ${expires | 0}`);
    const signature = arrayBufferToBase62(await sbCrypto.sign(channel.signKey, buffer))
    return {
        channelId: channel.channelId,
        publicKey: publicKey,
        signedBy: channel.userPublicKey,
        expires: expires,
        signature: signature,
    }
}

async function validateVisitorSigningKey(channel: SB384, vsk: VisitorSigningKey): Promise<boolean> {
    if (vsk.expires < 1000 * Date.now()) {
        if (DBG0) console.warn("[VSK] Validate: VSK is expired")
        return false
    }
    if (vsk.channelId !== channel.userId) {
        if (DBG0) console.warn("[VSK] Validate: VSK is not for the correct channel!  Got", vsk.channelId, "- should be", channel.userId)
        return false
    }
    if (vsk.signedBy !== channel.userPublicKey) {
        if (DBG0) console.warn("[VSK] Validate: VSK is not signed by the channel owner public key")
        return false
    }

    const buffer = new TextEncoder().encode(`${vsk.channelId} ${vsk.publicKey} ${vsk.expires | 0}`);
    const valid = await sbCrypto.verify(channel.signKey, base62ToArrayBuffer(vsk.signature), buffer);
    if (!valid && DBG0) console.warn("[VSK] Validate: Signature is invalid")
    return valid;
}

async function demoVisitorSigningKeys() {

    console.log("\n\nVisitor signing keys demo\n\n")

    console.log("This demo shows how we can use visitor signing keys to authenticate a visitor to a channel.\n")

    console.log("In this demo, we simplify some things in order to focus on the use of the new \"visitor signing key\" idea.  We don't use the real Channel API to send and receive messages.  There is no encryption and the channelmessage format is greatly simplified.\n")

    console.log("The signing and validation of the visitors and VSKs is the important bit here.\n\n")

    // Initialize internal state -- We're not really calling the server APIs here, so we need to store what each party knows
    var ownerHasThisInfo: any = {}
    var visitorHasThisInfo: any = {}
    var channelServerHasThisInfo: any = {
        visitors: new Map<string, SBUserPublicKey>(),
        visitorSigningKeys: new Map<string, VisitorSigningKey>(),
    }

    // Owner creates the initial keypair for the channel
    const ownerKeys = await new ChannelKeys().ready
    const ownerPrivateKey = ownerKeys.userPrivateKey
    const channelId = ownerKeys.channelId
    console.log("[VSK] Owner: Created new channel keys")
    console.log("[VSK] Owner: channelId =", channelId)
    console.log("[VSK] Owner: owner private key =", ownerPrivateKey)

    // Owner creates a new visitor signing key
    const ownersVskKeypair = await new SB384().ready
    const expiration: number = 1000 * (Date.now() + 60 * 60 * 24 * 7) // 7 days from now
    const ownersVSK: VisitorSigningKey = await signVisitorSigningKey(ownerKeys, ownersVskKeypair.userPublicKey, expiration)
    console.log("[VSK] Owner: Signed visitor signing key with owner private key:", ownersVSK)

    // Save this stuff in the owner's internal state
    ownerHasThisInfo.channelKeys = ownerKeys
    ownerHasThisInfo.vskKeypair = ownersVskKeypair
    ownerHasThisInfo.vsk = ownersVSK

    // Owner creates the channel on the server
    // Here we skimp on the details because they're not relevant to the VSK test -- We just add the info to the server's internal state
    channelServerHasThisInfo.channelId = channelId
    channelServerHasThisInfo.ownerPublicKey = ownerKeys.userPublicKey
    channelServerHasThisInfo.channelKeys = await new SB384(ownerKeys.userPublicKey).ready // NOTE: The server only knows the *public* key of the owner

    // Owner authorizes the visitor signing key in the channel server, by sending the signed payload to the server
    console.log("[VSK] Owner: Authorizing visitor signing key in the channel server")

    const addVisitorSigningKeyRequest = {
        channelId: channelId,
        vsk: ownersVSK,
    }
    console.log("[VSK] Owner: Sending /addVisitorSigningKey request:", addVisitorSigningKeyRequest, "\n")

    const serversVsk = addVisitorSigningKeyRequest.vsk
    console.log("[VSK] Server: Received VSK from owner")
    
    console.log("[VSK] Server: Verifying the VSK")
    // Channel server verifies the VSK it receives in the API request
    assert(await validateVisitorSigningKey(channelServerHasThisInfo.channelKeys, serversVsk), "[VSK] Server: VSK is not valid")

    // Server saves the VSK in its internal state
    channelServerHasThisInfo.visitorSigningKeys.set(serversVsk.publicKey, serversVsk)
    console.log("[VSK] Server: Key", serversVsk.publicKey, "is a valid VSK with a valid signature from the channel owner, saving...\n")

    // Owner provides the channelId and the visitor signing key to the visitor -- This is done "out of band", outside the channel, eg via Signal or a QR code etc
    const outOfBandMessage = {
        channelId: channelId,
        signingKey: ownersVskKeypair.userPrivateKey,
    }
    console.log("[VSK] Owner: Providing the channelId and the visitor signing key to the visitor:", outOfBandMessage, "\n")

    // Visitor receives the channelId and the visitor signing key from the owner
    console.log("[VSK] Visitor: Received the channelId and the visitor signing key from the owner")
    visitorHasThisInfo.channelId = outOfBandMessage.channelId
    visitorHasThisInfo.signingKey = outOfBandMessage.signingKey

    // Visitor creates his own keypair
    const visitorKeypair = await new SB384().ready
    console.log("[VSK] Visitor: Created new keypair")
    console.log("[VSK] Visitor: Public key =", visitorKeypair.userPublicKey)
    console.log("[VSK] Visitor: User id =", visitorKeypair.userId)

    // Visitor reconstructs the visitor signing key from the out of band message
    const visitorsVskKeypair = await new SB384(outOfBandMessage.signingKey).ready
    // Sanity check that the visitor signing key is correct
    assert(visitorsVskKeypair.userPublicKey === ownersVskKeypair.userPublicKey, "[VSK] Visitor: Failed to reconstruct the correct visitor signing key")
    assert(visitorsVskKeypair.userId === ownersVskKeypair.userId, "[VSK] Visitor: Failed to reconstruct the correct visitor signing key")
    console.log("[VSK] Visitor: Reconstructed the visitor signing key successfully")

    // Visitor signs his own public key with the visitor signing key
    const vskSignature = await sbCrypto.sign(visitorsVskKeypair.signKey, new TextEncoder().encode(visitorKeypair.userPublicKey))
    console.log("[VSK] Visitor: Signing new public key with the visitor signing key")

    // Visitor calls /acceptVisitor using the VSK
    // - In reality, the visitor would create a temporary Channel object, with the channelId and the visitor signing key as its user private key
    // - Then the visitor would call /acceptVisitor on the temporary Channel object, to accept its own public key into the channel
    const acceptVisitorRequest = {
        channelId: channelId,
        visitorPublicKey: visitorKeypair.userPublicKey,
        visitorSignature: vskSignature,
        signedBy: visitorsVskKeypair.userPublicKey,
    }
    console.log("[VSK] Visitor: Calling /acceptVisitor:", acceptVisitorRequest, "\n")

    // The server verifies the API request
    // * the channelId is correct
    // * the signature is from a VSK for the channel
    // * the VSK's expiration time is still in the future
    // * the signature is valid
    console.log("[VSK] Server: Verifying the /acceptVisitor API request")
    assert(acceptVisitorRequest.channelId === channelServerHasThisInfo.channelId, "[VSK] Server: Channel ID is not valid")
    const serversMatchingVsk = channelServerHasThisInfo.visitorSigningKeys.get(acceptVisitorRequest.signedBy)
    assert(serversMatchingVsk, "[VSK] Server: No matching VSK found")
    assert(serversMatchingVsk.expires > 1000 * Date.now(), "[VSK] Server: VSK is expired")
    const serversVerifyKey = await new SB384(serversMatchingVsk.publicKey).ready
    assert(await sbCrypto.verify(serversVerifyKey.signKey, acceptVisitorRequest.visitorSignature, new TextEncoder().encode(acceptVisitorRequest.visitorPublicKey)), "[VSK] Server: Visitor signature is not valid")
    console.log("[VSK] Server: /acceptVisitor API request is valid")

    // The server saves the visitor's public key in its set of accepted visitors
    const serversVisitorKey = await new SB384(acceptVisitorRequest.visitorPublicKey).ready
    channelServerHasThisInfo.visitors.set(serversVisitorKey.userId, serversVisitorKey.userPublicKey)
    console.log("[VSK] Server: Saved visitor's public key in the set of accepted visitors:", channelServerHasThisInfo.visitors, "\n")
    
    // Visitor uses his own private key to sign a message
    console.log("[VSK] Visitor: Sending a message from our own private key")
    const messageBody = {
        type: "chat",
        text: "Hello, world!",
    }
    console.log("[VSK] Visitor: Message body =", messageBody)
    // NOTE: This part is horribly fake -- for simplicity we're not using the real ChannelMessage serialization or encryption at all here
    const messagePayload = assemblePayload(messageBody)
    assert(messagePayload, "[VSK] Visitor: Failed to assemble message payload")
    const messageSignature = await sbCrypto.sign(visitorKeypair.signKey, messagePayload!)
    const visitorMessage = {
        payload: messagePayload,
        signature: messageSignature,
        sender: visitorKeypair.userId,
        channelId: visitorHasThisInfo.channelId,
    }
    console.log("[VSK] Visitor: Pretending to encrypt and send message:", visitorMessage, "\n")

    // Server verifies that the message is signed by a valid member of the channel
    console.log("[VSK] Server: Verifying the message is signed by a valid member of the channel")
    const serversMessageSenderPublicKey = channelServerHasThisInfo.visitors.get(visitorMessage.sender)
    assert(serversMessageSenderPublicKey, "[VSK] Server: No matching visitor key found")
    console.log("[VSK] Server: Found matching visitor key:", serversMessageSenderPublicKey)
    const serversMessageSenderKeys = await new SB384(serversMessageSenderPublicKey).ready
    assert(await sbCrypto.verify(serversMessageSenderKeys.signKey, visitorMessage.signature, visitorMessage.payload), "[VSK] Server: Message signature is not valid")
    console.log("[VSK] Server: Message is valid, forwarding to channel\n")

    // Owner verifies the signed message with the visitor public key
    console.log("[VSK] Owner: Received message from", visitorMessage.sender);
    console.log("[VSK] Owner: Getting the list of accepted visitors from the server")
    const ownersVisitorMap = channelServerHasThisInfo.visitors // Pretend we got this from the server by calling /getPublicKeys
    assert(ownersVisitorMap.has(visitorMessage.sender), "[VSK] Owner: Visitor is not in the list of accepted visitors")
    const ownersVisitorKeys = await new SB384(ownersVisitorMap.get(visitorMessage.sender)).ready
    console.log("[VSK] Owner: Found sender's public key", ownersVisitorKeys.userPublicKey, "in the list of accepted visitors");
    assert(await sbCrypto.verify(ownersVisitorKeys.signKey, visitorMessage.signature, visitorMessage.payload), "[VSK] Owner: Message signature is not valid")
    console.log("[VSK] Owner: Message signature is valid")
    console.log("[VSK] Owner: Pretending to decrypt message (we're not really encrypting/decrypting in this test)");
    const ownersMessageBody = extractPayload(visitorMessage.payload).payload
    console.log("[VSK] Owner: Extracted message body from payload:", ownersMessageBody);
    console.log()
    
    console.log("✅ VSK demo successful!")
}

Deno.test({
    name: "[fast] basic visitor signing keys demo",
    // todo: Deno test complains about a timer that should have been cleaned up
    sanitizeOps: false,  // Ignores unfinished async operations
    sanitizeResources: false,  // Ignores open resources like WebSockets
    async fn() {
        console.log('\n===================== 03.05 START visitor signing keys demo =====================')
        await demoVisitorSigningKeys()
        console.log('===================== 03.05 END visitor signing keys demo   =====================')
        }
});

if (import.meta.main) {
    await demoVisitorSigningKeys()
    console.log("If nothing BROKE, then it passed, probably!")
}
