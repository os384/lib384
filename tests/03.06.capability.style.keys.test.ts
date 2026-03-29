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
import '../env.js'
import '../config.js'

import { ChannelApi, ChannelId, SB384, ChannelHandle, ChannelKeys, sbCrypto, assemblePayload, extractPayload, base62ToArrayBuffer, arrayBufferToBase62 } from "../dist/384.esm.js"
import type { ChannelMessage, SBUserId, SBUserPublicKey } from '../dist/384.esm.js'

import { inspectBinaryData, printChannelKeys, deriveKey } from "./test.utils.ts"
import type { PubKeyMessage, ChannelKeyMessage, ChatMessage } from "./test.utils.ts"
import { assert } from '../../deno_std/assert/assert.ts'

const configuration = (globalThis as any).configuration

const DBG0 = true

interface SBUserInfo {
    channelId: string,
    publicKey: string,
    rights: string[],
    expires: number,
    signedBy: string,
    signature: string,
}

async function signUserInfo(signer: SB384, channelId: ChannelId, publicKey: string, rights: string[], expires: number): Promise<SBUserInfo> {
    assert(signer.signKey, "[User] Sign: Signing key is not set")
    assert(signer.userPrivateKey, "[User] Sign: Private key is not set")
    const rightsString = "[" + rights.join(" ") + "]"
    const buffer = new TextEncoder().encode(`channel: ${channelId} publicKey: ${publicKey} rights: ${rightsString} expires: ${expires | 0}`);
    const signature = arrayBufferToBase62(await sbCrypto.sign(signer.signKey, buffer))
    return {
        channelId: channelId,
        publicKey: publicKey,
        rights: rights,
        expires: expires,
        signedBy: signer.userPublicKey,
        signature: signature,
    }
}

async function validateUserInfo(channelId: ChannelId, signer: SBUserInfo, info: SBUserInfo): Promise<boolean> {
    if (info.expires < 1000 * Date.now()) {
        if (DBG0) console.warn("[User] Validate: User key is expired")
        return false
    }
    if (info.channelId !== channelId) {
        if (DBG0) console.warn("[User] Validate: User key is not for the correct channel!  Got", info.channelId, "- should be", channelId)
        return false
    }
    if (info.signedBy !== signer.publicKey) {
        if (DBG0) console.warn("[User] Validate: User key is not signed by the signer's public key")
        return false
    }
    if (!signer.rights.includes("accept") && !signer.rights.includes("admin")) {
        if (DBG0) console.warn("[User] Validate: Signer key is not authorized to accept visitors")
        return false
    }
    for (const right of info.rights) {
        if (!signer.rights.includes(right)) {
            if (DBG0) console.warn("[User] Validate: Signer does not have right:", right)
            return false
        }
    }
    
    const rightsString = "[" + info.rights.join(" ") + "]"
    const buffer = new TextEncoder().encode(`channel: ${channelId} publicKey: ${info.publicKey} rights: ${rightsString} expires: ${info.expires | 0}`);
    const verifyKeys = await new SB384(signer.publicKey).ready
    const valid = await sbCrypto.verify(verifyKeys.signKey, base62ToArrayBuffer(info.signature), buffer);
    if (!valid && DBG0) console.warn("[User] Validate: Signature is invalid")
    return valid;
}

async function verifyAcceptVisitorRequest(newVisitor: SBUserInfo, channelId: ChannelId, visitors: Map<string, SBUserInfo>): Promise<boolean> {
    console.log("Server: Verifying the /acceptVisitor API request")

    if (newVisitor.expires < 1000 * Date.now()) {
        if (DBG0) console.warn("Server: New visitor key is expired")
        return false
    }
    if (newVisitor.channelId !== channelId) {
        if (DBG0) console.warn("Server: New visitor key is not for the correct channel!  Got", newVisitor.channelId, "- should be", channelId)
        return false
    }

    const signerKeys = await new SB384(newVisitor.signedBy).ready
    const signer = visitors.get(signerKeys.userId)
    if (!signer) {
        if (DBG0) console.warn("Server: New visitor key is not signed by a valid member of the channel")
        return false
    }

    if (newVisitor.signedBy !== signer.publicKey) {
        if (DBG0) console.warn("Server: New visitor key is not signed by the signer's public key")
        return false
    }

    if (signer.expires < 1000 * Date.now()) {
        if (DBG0) console.warn("Server: Signer key is expired")
        return false
    }

    if (!signer.rights.includes("accept")) {
        if (DBG0) console.warn("Server: Signer does not have accept right")
        return false
    }

    for (const right of newVisitor.rights) {
        if (!signer.rights.includes(right)) {
            if (DBG0) console.warn("Server: Signer does not have requested right:", right)
            return false
        }
    }

    if (newVisitor.rights.includes("accept") && signerKeys.userId !== channelId) {
        if (DBG0) console.warn("Server: Only owner can grant accept right")
        return false
    }

    const valid = await validateUserInfo(channelId, signer, newVisitor)
    if (!valid) {
        if (DBG0) console.warn("Server: Signature is invalid")
        return false
    } else {
        console.log("Server: /acceptVisitor API request is valid")
    return true;
    }
}

async function demoCapabilityStyleKeys() {

    console.log("\n\nCapability style keys demo\n\n")

    console.log("This demo shows how we can use capability style keys to authenticate a visitor to a channel.\n")

    console.log("In this demo, we simplify some things in order to focus on the use of the new \"capability style keys\" idea.  We don't use the real Channel API to send and receive messages.  There is no encryption and the channelmessage format is greatly simplified.\n")

    console.log("The signing and validation of the visitor keys is the important bit here.\n\n")

    // Initialize internal state -- We're not really calling the server APIs here, so we need to store what each party knows
    var ownerHasThisInfo: any = {}
    var visitorHasThisInfo: any = {}
    var channelServerHasThisInfo: any = {
        visitors: new Map<string, SBUserInfo>(),
    }

    // Owner creates the initial keypair for the channel
    const ownerKeys = await new ChannelKeys().ready
    const ownerPrivateKey = ownerKeys.userPrivateKey
    const channelId = ownerKeys.channelId
    console.log("Owner: Created new channel keys")
    console.log("Owner: channelId =", channelId)
    console.log("Owner: public key =", ownerKeys.userPublicKey)
    console.log("Owner: private key =", ownerPrivateKey)

    // Owner signs his own public key with his private key
    const forever: number = Number.MAX_SAFE_INTEGER
    const ownerInfo = await signUserInfo(ownerKeys, channelId, ownerKeys.userPublicKey, ["accept", "read", "write", "admin"], forever)
    console.log("Owner: Signed own user info")

    // Owner creates a new "accept" key
    const ownersAcceptKeypair = await new SB384().ready
    const expiration: number = 1000 * (Date.now() + 60 * 60 * 24 * 7) // 7 days from now
    const ownersAkInfo: SBUserInfo = await signUserInfo(ownerKeys, channelId, ownersAcceptKeypair.userPublicKey, ["accept", "read", "write"], expiration)
    console.log("Owner: Signed accept key with owner public key:", ownersAkInfo.publicKey)

    // Save this stuff in the owner's internal state
    ownerHasThisInfo.channelKeys = ownerKeys
    ownerHasThisInfo.acceptKeypair = ownersAcceptKeypair
    ownerHasThisInfo.akInfo = ownersAkInfo
    ownerHasThisInfo.ownerInfo = ownerInfo

    // Owner creates the channel on the server
    // Here we skimp on the details because they're not relevant to the VSK test -- We just add the info to the server's internal state
    // But what happens is, the owner sends the signed ownerInfo to the server
    // Owner validates the signature on the ownerInfo
    console.log("Server: Validating owner user info")
    channelServerHasThisInfo.channelKeys = await new SB384(ownerInfo.publicKey).ready // NOTE: The server only knows the *public* key of the owner
    assert(await validateUserInfo(channelId, ownerInfo, ownerInfo), "Owner: Failed to validate owner user info")
    channelServerHasThisInfo.visitors.set(channelServerHasThisInfo.channelKeys.userId, ownerInfo) // Add the owner as the first "visitor" in the channel
    channelServerHasThisInfo.channelId = ownerInfo.channelId
    channelServerHasThisInfo.ownerInfo = ownerInfo

    // Owner authorizes the accept key in the channel server, by sending the signed payload to the server
    console.log("Owner: Authorizing accept key in the channel server")

    const addAcceptKeyRequest = {
        channelId: channelId,
        ak: ownersAkInfo,
    }
    console.log("Owner: Sending /acceptVisitor request:", addAcceptKeyRequest, "\n")

    const serversAkInfo = addAcceptKeyRequest.ak
    console.log("Server: Received AK from owner", serversAkInfo.publicKey)
    
    console.log("Server: Verifying the AK")
    // Channel server verifies the AK it receives in the API request
    //assert(await validateUserInfo(channelId, channelServerHasThisInfo.ownerInfo, serversAkInfo), "Server: Failed to validate accept key")
    assert(await verifyAcceptVisitorRequest(serversAkInfo, channelId, channelServerHasThisInfo.visitors), "Server: Failed to validate /acceptVisitor request for acceptance key")
    // Server adds the AK as a visitor in the channel
    const serversAkKeys = await new SB384(serversAkInfo.publicKey).ready
    channelServerHasThisInfo.visitors.set(serversAkKeys.userId, serversAkInfo)
    console.log("Server: Key", serversAkInfo.publicKey, "is a valid visitor key with a valid signature from the channel owner, saving...")
    console.log("Server: Current visitors:")
    for (const [userId, info] of channelServerHasThisInfo.visitors.entries()) {
        console.log("    Found visitor:", userId, info.publicKey)
    }
    console.log()

    // Owner provides the channelId and the acceptance key to the visitor -- This is done "out of band", outside the channel, eg via Signal or a QR code etc
    const invite: ChannelHandle = {
        channelId: channelId,
        userPrivateKey: ownersAcceptKeypair.userPrivateKey,
        channelServer: configuration.channelServer,
    }
    console.log("Owner: Providing the channelId and the acceptance private key to the visitor:", invite, "\n")

    // Visitor receives the channelId and the acceptance key from the owner
    console.log("Visitor: Received the channelId and the acceptance key from the owner")
    visitorHasThisInfo.channelId = invite.channelId
    visitorHasThisInfo.signingKey = invite.userPrivateKey

    // Visitor reconstructs the acceptance key from the out of band message
    // const visitorsTmpChannelKeys = await new ChannelKeys(invite).ready // FIXME: Don't try to create a ChannelKeys until we're ready to talk to real servers
    const visitorsTmpChannelKeys = await new SB384(invite.userPrivateKey).ready
    // Sanity check that the acceptance key is correct
    assert(visitorsTmpChannelKeys.userPublicKey === ownersAcceptKeypair.userPublicKey, "Visitor: Failed to reconstruct the correct acceptance key")
    assert(visitorsTmpChannelKeys.userId === ownersAcceptKeypair.userId, "Visitor: Failed to reconstruct the correct acceptance key")
    console.log("Visitor: Reconstructed the acceptance key successfully")

    // Visitor creates his own keypair
    const visitorKeypair = await new SB384().ready
    console.log("Visitor: Created new keypair")
    console.log("Visitor: Public key =", visitorKeypair.userPublicKey)
    console.log("Visitor: User id =", visitorKeypair.userId)

    // Visitor signs his own public key with the acceptance key
    const visitorInfo = await signUserInfo(visitorsTmpChannelKeys, channelId, visitorKeypair.userPublicKey, ["read", "write"], forever)
    console.log("Visitor: Signed own user info with acceptance key")

    // Visitor calls /acceptVisitor using the acceptance key
    // - Then the visitor would call /acceptVisitor on the temporary Channel object, to accept its own public key into the channel
    const acceptVisitorRequest = visitorInfo
    console.log("Visitor: Calling /acceptVisitor:", acceptVisitorRequest, "\n")

    // The server verifies the API request
    // * the channelId is correct
    // * the signature is from a valid key in the channel
    // * the signer's expiration time is still in the future
    // * the signature is valid
    assert(await verifyAcceptVisitorRequest(acceptVisitorRequest, channelId, channelServerHasThisInfo.visitors), "Server: Failed to validate /acceptVisitor request for the visitor key")
    const serversVisitorInfo = acceptVisitorRequest
     const serversVisitorKeys = await new SB384(acceptVisitorRequest.publicKey).ready
    channelServerHasThisInfo.visitors.set(serversVisitorKeys.userId, serversVisitorInfo)
    console.log("Server: Saved new visitor", serversVisitorInfo.publicKey, "in the set of accepted visitors")
    console.log("Server: Current visitors:")
    for (const [userId, info] of channelServerHasThisInfo.visitors.entries()) {
        console.log("    Found visitor:", userId, info.publicKey)
    }
    console.log()
    
    // Visitor uses his own private key to sign a message
    console.log("Visitor: Sending a message from our own private key")
    const messageBody = {
        type: "chat",
        text: "Hello, world!",
    }
    console.log("Visitor: Message body =", messageBody)
    // NOTE: This part is horribly fake -- for simplicity we're not using the real ChannelMessage serialization or encryption at all here
    const messagePayload = assemblePayload(messageBody)
    assert(messagePayload, "Visitor: Failed to assemble message payload")
    const messageSignature = await sbCrypto.sign(visitorKeypair.signKey, messagePayload!)
    const visitorMessage = {
        payload: messagePayload,
        signature: messageSignature,
        sender: visitorKeypair.userId,
        channelId: visitorHasThisInfo.channelId,
    }
    console.log("Visitor: Pretending to encrypt and send message:", visitorMessage, "\n")

    // Server verifies that the message is allowed to be sent by the visitor
    console.log("Server: Verify that the message is legitimate")
    const serversMessageSenderInfo = channelServerHasThisInfo.visitors.get(visitorMessage.sender)
    assert(serversMessageSenderInfo, "Server: Message sender is not a valid member of the channel")
    console.log("Server: Message sender is a valid member of the channel")
    assert(serversMessageSenderInfo.rights.includes("write"), "Server: Message sender does not have write permission")
    console.log("Server: Message sender has write permission")
    console.log("Server: Verifying message signature")
    const serversMessageSenderKeys = await new SB384(serversMessageSenderInfo.publicKey).ready
    assert(await sbCrypto.verify(serversMessageSenderKeys.signKey, visitorMessage.signature, visitorMessage.payload), "Server: Message signature is not valid")
    console.log("Server: Message is valid, forwarding to channel\n")

    // Owner verifies the signed message with the visitor public key
    console.log("Owner: Received message from", visitorMessage.sender);
    console.log("Owner: Getting the list of accepted visitors from the server")
    const ownersVisitorMap = channelServerHasThisInfo.visitors // Pretend we got this from the server by calling /getPublicKeys
    const ownersSenderInfo = ownersVisitorMap.get(visitorMessage.sender)
    assert(ownersSenderInfo, "Owner: Visitor is not in the list of accepted visitors")
    const ownersSenderKeys = await new SB384(ownersSenderInfo.publicKey).ready
    console.log("Owner: Found sender's public key", ownersSenderKeys.userPublicKey, "in the list of accepted visitors");
    assert(await sbCrypto.verify(ownersSenderKeys.signKey, visitorMessage.signature, visitorMessage.payload), "Owner: Message signature is not valid")
    console.log("Owner: Message signature is valid")
    console.log("Owner: Pretending to decrypt message (we're not really encrypting/decrypting in this test)");
    const ownersMessageBody = extractPayload(visitorMessage.payload).payload
    console.log("Owner: Extracted message body from payload:", ownersMessageBody);
    console.log()
    
    console.log("✅ Capability style keys demo successful!")
    console.log()
}

Deno.test({
    name: "[fast] basic capability style keys demo",
    // todo: Deno test complains about a timer that should have been cleaned up
    sanitizeOps: false,  // Ignores unfinished async operations
    sanitizeResources: false,  // Ignores open resources like WebSockets
    async fn() {
        console.log('\n===================== 03.06 START capability style keys demo =====================')
        await demoCapabilityStyleKeys()
        console.log('===================== 03.06 END capability style keys demo   =====================')
        }
});

if (import.meta.main) {
    await demoCapabilityStyleKeys()
    console.log("If nothing BROKE, then it passed, probably!")
}
