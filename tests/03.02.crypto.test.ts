#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write

// detailed tests of the sort of operations involved with setting up a Channel
// connection with multiple users/participants.

import '../env.js'
import '../config.js'

import { ChannelApi, SB384, ChannelHandle, ChannelKeys, sbCrypto, assemblePayload, extractPayload } from "../dist/384.esm.js"
import type { ChannelMessage, SBUserId, SBUserPublicKey } from '../dist/384.esm.js'

import { inspectBinaryData, printChannelKeys, deriveKey } from "./test.utils.ts"
import type { PubKeyMessage, ChannelKeyMessage, ChatMessage } from "./test.utils.ts"

const configuration = (globalThis as any).configuration
let SB

// this parallels the old 'sbCrypto.wrap' function (which in v3 is refactored
// into multi-stage queueing process)
async function cryptoWrap(
    body: any,
    sender: SBUserId,
    encryptionKey: CryptoKey,
    salt: ArrayBuffer,
    signingKey: CryptoKey
): Promise<ChannelMessage> {
    const payload = assemblePayload(body);
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const timestamp = await ChannelApi.dateNow()
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, timestamp);
    return({
        f: sender,
        c: await sbCrypto.encrypt(payload!, encryptionKey, { iv: iv, additionalData: view }),
        iv: iv,
        salt: salt,
        s: await sbCrypto.sign(signingKey, payload!),
        ts: timestamp,
    })
}

async function sb384test03() {
    var ownerHasThisInfo: any = {}
    var visitorHasThisInfo: any = {}
    var channelServerHasThisInfo: any = {}

    const s = "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++"

    const key1 = await (new ChannelKeys()).ready
    console.log("\nFreshly generated Channel keys ('key1'):")
    printChannelKeys(key1)
    ownerHasThisInfo.mainChannelKeys = key1

    // OWNER creates a channel
    console.log(
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "OWNER ===> ChannelServer: create a new channel ('ChannelData'):\n",
        "        channelId: ", key1.channelData.channelId, "\n",
        "   ownerPublicKey: ", key1.channelData.ownerPublicKey, "\n",
        // " channelPublicKey: ", key1.channelData.channelPublicKey, "\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
    )

    // OWNER generates an access 'token' for somebody (visitor)
    const key2 = new SB384()
    await key2.ready
    ownerHasThisInfo.oneTimeKeyForVisitor = key2

    const sendChannelId = key1.channelId
    const sendOneTimeKey = key2.userPrivateKey
    console.log(
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "Send this to human/app VISITOR, through some means:\n",
        "     ChannelId: ", sendChannelId, "\n",
        "    oneTimeKey: ", sendOneTimeKey, "\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
    )

    console.log("++++ OWNER also tells server to allow messages from this UserId")
    console.log(
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "OWNER ===> ChannelServer: allow messages from this UserId:\n",
        "       UserId: ", key2.userId, "\n",
        "    ChannelId: ", sendChannelId, "\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
    )
    channelServerHasThisInfo.channelList =
        new Map<string, {
            acceptedVisitors: Set<SBUserId>;
            pubKeys: Map<SBUserId, SBUserPublicKey>;
        }>();
    channelServerHasThisInfo.channelList.set(sendChannelId, {
        acceptedVisitors: new Set<SBUserId>,
        // note: channel server no longer tracks pub keys
    })
    channelServerHasThisInfo.channelList.get(sendChannelId)!.acceptedVisitors.add(key2.userId)


    console.log("++++ VISITOR connects to channel")
    const handle: ChannelHandle = {
        channelId: sendChannelId!,
        userPrivateKey: sendOneTimeKey,
        // in "real" mode we would provide channelServer so channelData can bootstrap
        // channelServer: configuration.channelServer,
        // to allow unit test to run without channel server, we cheat a bit and insert:
        channelData: key1.channelData,
    }
    visitorHasThisInfo.mainChannelHandle = handle
    const channelKeys3 = new ChannelKeys(handle)
    await channelKeys3.ready // this is now 'our' private key for this channel
    visitorHasThisInfo.mainChannelKeys = channelKeys3

    // alternatively could work partially with SB384 'level' of representation:
    // const key3 = new SB384(sendOneTimeKey)
    // await key3.ready

    // let's just have a peak
    console.log("Resulting JWK:\n", channelKeys3.jwkPrivate)

    console.log(
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "VISITOR ===> ChannelServer: connect to this channel:\n",
        "      ChannelId: ", sendChannelId, "\n",
        "         UserId: ", key2.userId, "\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "ChannelServer ===> VISITOR: channel keys:\n",
        "   ownerPublicKey: ", key1.channelData.ownerPublicKey, "\n",
        // " channelPublicKey: ", key1.channelData.channelPublicKey, "\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
    )

    // VISITOR thus gets this from the server:
    const ownerPublicKey = key1.userPublicKey
    console.log("Received from server ownerPublicKey:\n", ownerPublicKey)
    const key4 = new SB384(ownerPublicKey) // visitor side of 'key1'
    await key4.ready

    // VISITOR double checks that this is the owner key
    console.log("VISITOR checks that ownerPublicKey matches:\n", key4.userPublicKey === ownerPublicKey ? "confirmed" : "**** ERROR ****")

    visitorHasThisInfo.mainChannelOwnerPublicKey = ownerPublicKey
    // visitorHasThisInfo.mainChannelChannelPublicKey = key1.channelData.channelPublicKey

    // VISITOR can encrypt something
    const encryptionKey1 = await deriveKey(channelKeys3.privateKey, key4.publicKey, 'AES-GCM', true, ['encrypt', 'decrypt'])
    // signing keys are always against a counterpart, first time it's against the owner public key
    // UPDATE: nah we're switching to ECDSA
    // const signKey1 = await sbCrypto.deriveKey(channelKeys3.privateKey, key4.publicKey, 'HMAC', true, ['sign', 'verify'])

    console.log("We will use encryption key:\n", encryptionKey1)
    visitorHasThisInfo.mainChannelEncryptionKey = encryptionKey1

    // VISITOR creates a new private key that's only ever seen locally
    const key5 = new SB384()
    await key5.ready
    visitorHasThisInfo.newPrivateKey = key5

    // message from VISITOR to encrypt:
    const message1: PubKeyMessage = {
        type: 'pubKey',
        text: `This is a secret message from the new VISITOR, hello, this is ME! And here's my new userId and publicKey.`,
        userId: key5.userId,
        userPublicKey: key5.userPublicKey,
    }

    // this will be managed by the protocol for the channel

    // const encryptedMessage1: ChannelMessage = await sbCrypto.wrap(message1, key2.userId, encryptionKey1, signKey1)
    const salt1 = crypto.getRandomValues(new Uint8Array(16)).buffer
    const encryptedMessage1: ChannelMessage = await cryptoWrap(message1, key2.userId, encryptionKey1, salt1, key5.signKey)

    // // const messageJson1 = JSON.stringify(message1)
    // const messagePayload1 = assemblePayload(message1)
    // const encryptedMessage1 = await sbCrypto.wrap(encryptionKey1, messagePayload1!)
    // encryptedMessage1.sender = key2.userId // key5.userId has not been approved yet
    // encryptedMessage1.sign = await sbCrypto.sign(channelKeys3.signKey, encryptedMessage1.content)

    const finalMessagePayload1 = assemblePayload(encryptedMessage1)

    console.log(
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "VISITOR ===> OWNER:\n",
        "Message contents:\n", message1, "\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        `Packaged contents (${(encryptedMessage1.c as ArrayBuffer)?.byteLength} bytes):\n`)
    console.log(inspectBinaryData((encryptedMessage1.c as ArrayBuffer)!), "\n")
    console.log(
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "Encrypted version of (packaged) contents ('EncryptedContents' format):\n",
        encryptedMessage1, "\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        `Final packaging (single ArrayBuffer) of above (${finalMessagePayload1?.byteLength} bytes):\n`,
    )
    console.log(inspectBinaryData(finalMessagePayload1!), "\n")
    console.log("+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n")

    // CHANNEL SERVER
    // first VISITOR will connect to the channel ... and provide full public key
    console.log(
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "VISITOR connects to CHANNEL SERVER using:\n",
        "     ChannelId: ", sendChannelId, "\n",
        "        UserId: ", key2.userId, "\n",
        "     PublicKey: ", key2.userPublicKey, "\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
    )
    // server checks user ID is valid
    const key6 = new SB384(key2.userPublicKey)
    await key6.ready
    if (key6.userId === key2.userId)
        console.log("CHANNEL SERVER: UserId is valid")
    else
        console.log("CHANNEL SERVER: **** ERROR **** UserId is NOT valid (does not match public key)")

    // once connected, 'finalMessagePayload1' is sent across channel server to OWNER
    const routingPayload1 = extractPayload(finalMessagePayload1!).payload
    console.log("routingPayload1:\n", routingPayload1)

    // server checks sender before forwarding
    if (key2.userId === routingPayload1.sender)
        console.log("CHANNEL SERVER: Sender allowed by owner")
    else
        console.error("CHANNEL SERVER: **** ERROR **** Sender NOT allowed by owner")
    // note: channel server does not verify since it's never privy to the channel private key
    // so at this point it forwards message to owner
    console.log("CHANNEL SERVER: Forwarding message to owner")

    // now we pretend owner receives this message; it needs other side of encryption
    const receivedMessage: ChannelMessage = routingPayload1! // pretend we received this from channel server (it's unmodified)
    delete receivedMessage.unencryptedContents

    // note on the owner side, we use 'key1' (which is a private key), which is what visitor is sending to
    const encryptionKey2 = await deriveKey(key1.privateKey, channelKeys3.publicKey, 'AES-GCM', true, ['encrypt', 'decrypt'])
    ownerHasThisInfo.mainChannelEncryptionKey = encryptionKey2

    // // test if it's resilient to tampering:
    // encryptedMessage1.timestamp! += 25


    console.log("OWNER receives message from VISITOR, will try decrypting:\n", receivedMessage)

    // haha ok lower-level api calls are slowly melting away ...
    // // const decryptedMessagePayload1 = await sbCrypto.unwrapMessage(encryptionKey2, receivedMessage)
    // const decryptedMessagePayload1 = await sbCrypto.unwrapMessage(encryptionKey2, receivedMessage)
    // ...
    // so we need to go LOWER:
    const { c: t, iv: iv, ts: ts } = receivedMessage
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, ts!);
    const decryptedMessagePayload1 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv, additionalData: view }, encryptionKey2, (t as ArrayBuffer)!)

    console.log("OWNER decrypts the message into:\n", decryptedMessagePayload1)
    const message2 = extractPayload(decryptedMessagePayload1!).payload as PubKeyMessage
    if ((!message2.type) || (message2.type !== 'pubKey'))
        console.error("**** ERROR **** message type is not 'pubKey'")

    console.log("... which is this message (should be pubKey):\n", message2)

    // // we can now pull out the info we were sent
    // const receivedMessage1 = JSON.parse(decryptedMessage1)
    // console.log("VISITOR received message:\n", receivedMessage1)

    // OWNER creates an sb384 object for the VISITOR (the 'real' one)
    const key8 = new SB384(message2.userPublicKey) // new VISITOR key (sort of rotated by VISITOR)
    await key8.ready

    ownerHasThisInfo.pubKeys = new Map<SBUserId, SBUserPublicKey>()
    ownerHasThisInfo.pubKeys.set(key8.userId, key8.userPublicKey)

    // OWNER also tells server to allow messages from this UserId
    console.log(
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "OWNER ===> ChannelServer: allow messages from this NEW UserId:\n",
        "       UserId: ", key8.userId, "\n",
        "    ChannelId: ", sendChannelId, "\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
    )
    channelServerHasThisInfo.channelList.get(sendChannelId)!.acceptedVisitors.add(key8.userId)

    // OWNER can now send the private key for the channel to the visitor, used for channel communication
    // const key9 = new SB384(key1.channelPrivateKey) // this is the channel private key
    // .. will be handled by protocol
    const key9 = new SB384()
    await key9.ready
    ownerHasThisInfo.channelPrivateKey = key9
    
    // message to encrypt:
    const message3 = {
        type: 'channelKey',
        text: `Hello i am OWNER, here is the channel key for you to use`,
        sendTo: key8.userId,
        channelPrivateKey: key9.userPrivateKey, // allows recipient to use channel private key
    }

    // use newly received VISITOR key to encrypt directly to owner
    const encryptionKey3 = await deriveKey(key1.privateKey, key8.publicKey, 'AES-GCM', true, ['encrypt', 'decrypt'])

    // const encryptedMessage2 = await sbCrypto.wrap(encryptionKey3, assemblePayload(message3)!)
    // const encryptedMessage2 = await sbCrypto.wrap(message3, key1.userId, encryptionKey3, key1.signKey)

    // signing keys are always against a counterpart; this second time it's against the channel
    // update: nope
    // const signKey2 = await sbCrypto.deriveKey(key1.privateKey, key9.publicKey, 'HMAC', true, ['sign', 'verify'])
    // visitorHasThisInfo.mainChannelKeys.signKey = signKey2
    // const encryptedMessage2 = await sbCrypto.wrap(message3, key1.userId, encryptionKey3, signKey2)

    // const encryptedMessage2 = await sbCrypto.wrap(message3, key1.userId, encryptionKey3, signKey2)
    const salt3 = crypto.getRandomValues(new Uint8Array(16)).buffer
    const encryptedMessage2 = await cryptoWrap(message3, key1.userId, encryptionKey3, salt3, key1.signKey)

    console.log(
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "OWNER now sends channel private key directly to accepted visitor:\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        message3, "\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        encryptedMessage2, "\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "(We omit final wrapping of encrypted message for brevity)\n",
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        )

    // optionally, OWNER also tells server to stop messages from this one time token,
    // or it can allow a certain number of new subscriptions to be handled, or it can
    // allow continued communication from this token (and do embedded routing)
    console.log(
        "\n++++ Optionally tell server to STOP allowing more messages from:\n",
        "       UserId: ", key2.userId, "\n",
        "    ChannelId: ", sendChannelId, "\n"
    )

    // visitor receives message and decrypts and can now "broadcast"
    const receivedEncryptedContents2: ChannelMessage = encryptedMessage2

    // as above ...
    // const decryptedMessagePayload2 = await sbCrypto.unwrapMessage(encryptionKey3, receivedEncryptedContents2)
    // ...
    // ... we need to go LOWER:
    const { c: t2, iv: iv2, ts: ts2 } = receivedEncryptedContents2
    const view2 = new DataView(new ArrayBuffer(8));
    view2.setFloat64(0, ts2!);
    const decryptedMessagePayload2 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv2, additionalData: view2 }, encryptionKey3, (t2 as ArrayBuffer)!)

    const message4 = extractPayload(decryptedMessagePayload2).payload as ChannelKeyMessage

    console.log(message4)
    console.log("VISITOR has received channel private key:\n", message4.channelPrivateKey)
    visitorHasThisInfo.channelPrivateKey = message4.channelPrivateKey

    const key10 = new SB384(message4.channelPrivateKey) // this is the channel private key
    await key10.ready
    visitorHasThisInfo.channelPrivateKeyObject = key10

    // now we can "broadcast"
    const message5: ChatMessage = {
        type: 'chat',
        text: `Hello i am ${visitorHasThisInfo.newPrivateKey.userId}, here is a message for everyone!`,
    }

    // const messagePayload2 = assemblePayload(message5)
    // const encryptedMessage3 = await sbCrypto.wrap(visitorHasThisInfo.mainChannelEncryptionKey, messagePayload2!)

    const encryptedMessage3 = await cryptoWrap(
        message5,
        visitorHasThisInfo.newPrivateKey.userId,
        visitorHasThisInfo.mainChannelEncryptionKey,
        crypto.getRandomValues(new Uint8Array(16)).buffer, // even if not needed, salt is always required
        visitorHasThisInfo.mainChannelKeys.signKey)

    console.log(
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
        "VISITOR ===> BROADCAST sending first message:\n",
        encryptedMessage3,
        "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n",
    )
    // // // encryptedMessage3.sender = key8.userId
    // console.log("VISITOR sends message to channel:\n", encryptedMessage3)

    console.log(s)
    console.log(s)
    
    console.log("At the end of this exchange, here is the info the three parties have:\n")
    console.log("OWNER:\n", ownerHasThisInfo)
    console.log("VISITOR:\n", visitorHasThisInfo)
    console.log("CHANNEL SERVER:\n", channelServerHasThisInfo)
}

Deno.test({
    name: "[fast] basic SB384 crypto tests - part 2",
    // todo: Deno test complains about a timer that should have been cleaned up
    sanitizeOps: false,  // Ignores unfinished async operations
    sanitizeResources: false,  // Ignores open resources like WebSockets
    async fn() {
        console.log('\n===================== 03.02 START crypto test =====================')
        SB = new ChannelApi(configuration.channelServer, configuration.DBG) // set debug level
        await sb384test03()
        await ChannelApi.closeAll()
        console.log('===================== 03.02 END crypto test   =====================')
        }
});

if (import.meta.main) {
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await sb384test03()
    await ChannelApi.closeAll()
    console.log("If nothing BROKE, then it passed, probably!")
}
