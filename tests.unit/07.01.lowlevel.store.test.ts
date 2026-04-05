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
const configuration = (globalThis as any).configuration

import { ChannelApi, StorageApi, extractPayload, compareBuffers, SBStorageToken, validate_SBStorageToken, assemblePayload, SBCrypto, arrayBufferToBase62, SBApiFetch, getObjectId } from "../dist/384.esm.js"
import { assert } from "@std/assert";
import { SEP } from './test.utils.ts'

let SB

async function test01() {

    const testBlock = crypto.getRandomValues(new Uint8Array(63 * 1024))

    console.log(SEP, "Budget channel ID (key): ", configuration.budgetKey, SEP)
    const budgetChannel = await SB.connect(configuration.budgetKey)

    const sbCrypto = new SBCrypto()

    //
    // this unit test replicates the steps in StoreApi.storeData()
    //
    console.log("Test buffer: ", testBlock)

    const paddedBuf = StorageApi.padBuf(testBlock)
    console.log("0000 Padded test buffer: ", paddedBuf)

    const fullHash = await sbCrypto.generateIdKey(paddedBuf)
    console.log("1111 Full hash: ", fullHash)

    const objectId = arrayBufferToBase62(fullHash.idBinary)
    console.log("2222 Object ID: ", objectId)

    const storageServer = await SB.getStorageServer()
    console.log("3333 Storage server:", storageServer)

    // time to ask for salt, iv
    const query = storageServer + '/api/v2/storeRequest?id=' + objectId
    console.log("4444 Query: ", query)

    const keyInfo = await SBApiFetch(query)
    console.log("5555 Key info: ", keyInfo)

    // first actual 'test', we will make the request again after 0.1 seconds, the result should be the same
    // first we wait a bit
    console.log("6666 Waiting 0.1 seconds")
    await new Promise(resolve => setTimeout(resolve, 100))

    // then we ask for the 'same thing', again
    const keyInfo2 = await SBApiFetch(query)
    console.log("7777 Key info 2: ", keyInfo2)

    assert(compareBuffers(keyInfo.iv, keyInfo2.iv), "IVs are not the same")
    assert(compareBuffers(keyInfo.salt, keyInfo2.salt), "Salts are not the same")

    const iv = keyInfo.iv
    const salt = keyInfo.salt

    // const id = arrayBufferToBase62(fullHash.idBinary)
    // now we have all the parts of a ObjectHandle:

    // const r: ObjectHandle = {
    //     [SB_OBJECT_HANDLE_SYMBOL]: true,
    //     version: currentSBOHVersion,
    //     type: type,
    //     id: id,
    //     key: arrayBufferToBase62(fullHash.key_material),
    //     iv: keyInfo.iv,
    //     salt: keyInfo.salt,
    //     actualSize: bufSize,
    //     verification: this.#_storeObject(paddedBuf, id, fullHash.key_material, type, channel, keyInfo.iv, keyInfo.salt)
    //   }

    const key = await StorageApi.getObjectKey(fullHash.keyMaterial, salt)
    const data = await sbCrypto.encrypt(paddedBuf, key, { iv: iv })
    console.log("8888 Encrypted data: ", data)

    const id = await StorageApi.getObjectId(iv, salt, data)
    console.log("9999 Object ID: ", id)
    
    let storageToken = await budgetChannel.getStorageToken(data.byteLength)
    // while we're at it, let's mess a bit with the storage token
    storageToken = validate_SBStorageToken(storageToken.hash as unknown as SBStorageToken)
    console.log("AAAA Storage token: ", storageToken)

    //
    // Now we do the substeps that are in StoreApi.storeObject()
    //
    // roughly equivalent to:
    // const resp_json = await StorageApi.storeObject(storageServer, id, keyInfo.iv, keyInfo.salt, storageToken, data)
    //

    const query2 = storageServer + '/api/v2/storeData?id=' + id
    const query2payload = { id: id, iv: iv, salt: salt, data: data, storageToken: storageToken }
    console.log("BBBB query: ", query2, SEP, query2payload, SEP)
    const body = assemblePayload(query2payload)
    const resp = await SBApiFetch(query2, { method: 'POST', body: body })
    // const resp = jsonParseWrapper(resp_json)

    console.log("BBBB storeObject() result: ")
    console.log(resp)

    assert (!resp.error, `storeObject() failed: ${resp.error}`)
    assert (resp.id === id, `received id ${resp.id} but expected ${id}`)

    console.log("Looks like we are finished, here is the object")
    console.log({
        id: id,
        key: arrayBufferToBase62(fullHash.keyMaterial),
        verification: resp.verification,
    })

    // now we try and fetch the data
    const query3 = storageServer + '/api/v2/fetchData?id=' + id + '&verification=' + resp.verification

    // we use a 'regular' fetch() operation
    console.log("Fetching data from: ", query3)
    const response = await fetch(query3)

    console.log("CCCC Response: ", response)
    if (!response.ok) {
        console.error('\n', SEP, "Failed to fetch data:\n", SEP)
        console.error(await response.json(), '\n', SEP)
        assert(false, "Failed to fetch data")
    }

    const returnedData = await response.arrayBuffer()
    console.log("DDDD Data fetched: ")
    console.log(body)
    console.log("EEEE compared with what we sent")
    console.log(returnedData)

    const extract1 = extractPayload(body!).payload.data as ArrayBuffer
    console.log("Extract1:\n", extract1)

    console.log(returnedData)
    console.log(extractPayload(returnedData))
    console.log(extractPayload(returnedData).payload)
    const extract2 = extractPayload(returnedData).payload.data as ArrayBuffer
    console.log("Extract2:\n", extract2)

    assert(compareBuffers(extract1, extract2), "Data fetched is not the same as data stored")
    console.log("Data fetched is the same as data stored")


    console.log("let's peek inside what we got back")
    const extracted = extractPayload(returnedData).payload
    console.log(extracted)

    console.log("Test appears to have passed!")

}

// if used by "deno test ...", calls this:
Deno.test("[fast] [storage] minimalist storage test 07.01", async () => {
    console.log('\n===================== 07.01 START storage test =====================')
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await test01()
    await ChannelApi.closeAll()
    console.log('\n===================== 07.01 END storage test   =====================')
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    // called if used from command line
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await test01()
    await ChannelApi.closeAll()
}
