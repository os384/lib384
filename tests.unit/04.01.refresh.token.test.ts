#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-run --unstable

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

import { ChannelApi, SBStorageToken } from "../dist/384.esm.js"

let SB

// refreshToken() runs 'wrangler' on command line to refresh token on the
// channel server unless you are running cloudflare wrangler, miniflare,
// workerd, that sort of thing, then this will fail, which is fine.
import { LocalStorage, refreshToken } from "./test.utils.ts"
const localStorage = new LocalStorage('./.local.data.json');

async function simpleCreateChannel(tokenHash: string) {
    try {
        console.log("This bootstraps from a token; if token has been consumed it'll fail")
        
        const _storageToken: SBStorageToken = {
            // note: starts with SBStorageTokenPrefix 'LM2r'
            hash: tokenHash
        }

        const newChannel = await SB.create(_storageToken)

        console.log("Created New Channel, handle:\n", newChannel)
        console.log(
            "\n",
            "==========================================================================\n",
            "If you haven't done so already, then copy-paste the below json into env.js\n",
            "==========================================================================\n",
            JSON.stringify(newChannel, null, 2), "\n",
            "==========================================================================\n",
            "\n")
    } catch (error: any) {
        // if we get error 'No such channel or shard, or you are not authorized.' then we are fine
        if (error.message && error.message.includes("not authorized.")) {
            console.warn("Got expected error 'not authorized', which is fine if token has been consumed")
        } else {
            console.error(error)
            throw (error)
        }
    }
}

// we then consume the token to create a new channel
async function runTheTest() {
    // 2025.01.04 - update, we use a static hash value, that way dev/local docker setups work in a straightforward way
    let savedTokenHash = "LM2r39oAn1F8aMsicKTInXZb5L81JihNghBfJguAPVWZq5k"

    try {
        // first we try to fetch from "http://localhost:3849/refresh", if that works, then we're good
        console.log("Trying to refresh token via 3849 ...")
        let retValue = await fetch("http://localhost:3849/refresh")
        console.log("Refresh token response:", retValue)
        if (retValue.ok) {
            console.log("Token refresh succeeded, will now create a channel. Token hash:", savedTokenHash)
            await simpleCreateChannel(savedTokenHash)
            return
        }        
    } catch (error: any) {
        console.warn("Admin on 3849 not running, we'll try to refresh with wrangler command ...")
    }

    try {

        localStorage.setItem(configuration.channelServer + '_unit_test_04_01_token', savedTokenHash)

        // let savedTokenHash: string | undefined = localStorage.getItem(configuration.channelServer + '_unit_test_04_01_token')
        // if (!savedTokenHash) savedTokenHash = undefined

        // const tokenHash = await refreshToken(configuration.configServerType === 'local');

        // if (savedTokenHash !== tokenHash) {
        //     localStorage.setItem(configuration.channelServer + '_unit_test_04_01_token', tokenHash)
        //     console.log("++++++++ 04.01: Generated new token for channel creation ++++++++")
        //     console.log(tokenHash)
        //     console.log("+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++")
        // }

        let tokenHash = await refreshToken(configuration.configServerType === 'local', savedTokenHash)

        if (savedTokenHash !== tokenHash) {
            console.log("++++++++ 04.01: Got a different token hash in return than expected ++++++++")
            console.log(tokenHash)
            console.log("+++++++++++++++ (But we will use the static value) ++++++++++++++++++++++++")
            tokenHash = savedTokenHash
        } else {
            console.log("Token refresh succeeded, will now create a channel. Token hash:", tokenHash)
            console.log("(But we will use the static value regardless)")
        }

        await simpleCreateChannel(tokenHash)

        // console.log("Token refresh succeeded, will now create a channel. Token hash:", tokenHash)
        // if (tokenHash) {
        //     await simpleCreateChannel(tokenHash)
        // } else {
        //     console.log("Skipping rest of 04.01 test because token refresh failed")
        // }

        console.log("All done; we were using token hash:", tokenHash)
    } catch (error: any) {
        console.warn("Looks like we could not run 04.01, perhaps token isn't refreshed; that's typical")
    }
}

// todo. this will occasionally trigger a stdout cleanup error. we can punt on fixing that.
Deno.test({
    name: "[token] refresh token test",
    async fn() {
        console.log('\n===================== 04.01 START channel test =====================')
        SB = new ChannelApi(configuration.channelServer, configuration.DBG)
        await runTheTest()
        await ChannelApi.closeAll()
        console.log('===================== 04.01 END channel test   =====================')
    },
    // sanitizeOps: false
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await runTheTest()

    console.info(
        "\n",
        "===================================================================================\n",
        "REMINDER: if you're running this from command line to generate your budget channel,\n",
        "then (a) you need to run it from the channel server directory, and (b) you need to\n",
        "copy-paste the output into env.js (eg as 'localWalletHandle')\n",
        "===================================================================================\n")
}
