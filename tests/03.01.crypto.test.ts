#!/usr/bin/env -S deno run

// some very basic tests of the SB384 class

import '../env.js'
import '../config.js'
// const configuration = (globalThis as any).configuration
import { SB384 } from "../dist/384.esm.js"

import { assert, assertThrows, assertRejects } from "@std/assert";

function printKey(key: SB384) {
    console.log("==================== SB384 Key ====================")
    console.log("key.private:", key.private)
    console.log("key.ySign:", key.ySign)
    console.log("key.hash:", key.hash)
    console.log("key.userId:", key.userId)
    if (key.private) console.log("key.ownerChannelId:", key.ownerChannelId)
    if (key.private) console.log("key.jwkPrivate:", key.jwkPrivate)
    console.log("key.jwkPublic:", key.jwkPublic)
    if (key.private) console.log("key.userPrivateKey:", key.userPrivateKey)
    console.log("key.userPublicKey:", key.userPublicKey)
    console.log("---------------------------------------------------")
}

async function sb384test01() {
    const key1 = new SB384()
    await key1.ready
    console.log("\nFreshly generated SB384 key ('key1'):")
    printKey(key1)
    const key2 = new SB384(key1.userPublicKey)
    await key2.ready
    console.log("\nImporting 'key1' into 'key2' as public only:")
    printKey(key2)
}

// constructor(key?: CryptoKey | JsonWebKey | SBUserPublicKey | SBUserPrivateKey, forcePrivate?: boolean) {

async function sb384test02() {
    // There are four ways to create a key:
    // - from scratch
    // - from a 'CryptoKey' object, can be public or private
    // - from a 'JsonWebKey' object, can be public or private
    // - from a 'SBUserPublicKey | SBUserPrivateKey' string
    // In addition, from any of the above you can force private (asserting)

    const key1 = new SB384()
    await key1.ready
    console.log("\nsb384test02()\nFreshly generated SB384 key ('key1'):")
    printKey(key1)

    console.log("========================================================\nCreating 'key2' from 'key1' as public only using 'userPublicKey' ...")
    console.log(key1.userPublicKey)
    const key2 = new SB384(key1.userPublicKey)
    await key2.ready
    printKey(key2)
    assert(key1.hash === key2.hash)
    assert(key1.userPublicKey === key2.userPublicKey)
    // assertThrows(() => { key2.userPrivateKey }, Error, "not a private key")




    console.log("========================================================\nCreating 'key3' from 'key1' as private using 'userPrivateKey' ...")
    console.log(key1.userPrivateKey)
    const key3 = new SB384(key1.userPrivateKey)
    await key3.ready
    printKey(key3)
    console.log("========================================================\nCreating 'key4' from 'key1' as public only, using 'jwkPublic' ... ")
    console.log(key1.jwkPublic)
    const key4 = new SB384(key1.jwkPublic)
    await key4.ready
    printKey(key4)
    console.log("========================================================\nCreating 'key5' from 'key1' as private, using 'jwkPrivate' ...")
    console.log(key1.jwkPrivate)
    const key5 = new SB384(key1.jwkPrivate)
    await key5.ready
    printKey(key5)
    console.log("========================================================\nCreating 'key6' from 'key1' as public only, using 'publicKey' ...")
    const key6 = new SB384(key1.publicKey)
    await key6.ready
    printKey(key6)
    console.log("========================================================\nCreating 'key7' from 'key1' as private only, using 'privateKey' ...")
    const key7 = new SB384(key1.privateKey)
    await key7.ready
    printKey(key7)

    // regardless of how they are created, they should all end up having the same 'keyN.hash' value, check that:
    console.log("\nkey1.hash:", key1.hash)
    console.log("key2.hash:", key2.hash)
    console.log("key3.hash:", key3.hash)
    console.log("key4.hash:", key4.hash)
    console.log("key5.hash:", key5.hash)
    console.log("key6.hash:", key6.hash)
    console.log("key7.hash:", key7.hash)
    assert(key1.hash === key3.hash)
    assert(key1.hash === key4.hash)
    assert(key1.hash === key5.hash)
    assert(key1.hash === key6.hash)
    assert(key1.hash === key7.hash)

}

async function sb384test03() {
    const key1 = await new SB384().ready
    console.log("\nsb384test02()\nFreshly generated SB384 key ('key1'):")
    printKey(key1)
}



Deno.test("[fast] basic SB384 tests", async () => {
    console.log('\n===================== 03.01 START crypto tests =====================')
    await sb384test01()
    await sb384test02()
    console.log('===================== 03.01 END crypto tests   =====================')
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    await sb384test01()
    await sb384test02()
    await sb384test03()

}