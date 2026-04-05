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
import '../keys.js'
import '../config.js'
const configuration = (globalThis as any).configuration

import { ChannelApi, Channel } from "../dist/384.esm.js"

import { assert } from "@std/assert";

const SEP = '\n' + '='.repeat(76) + '\n'

let SB

async function connectToChannel() {
    /* 
        below is the new 'compressed' private key format.
        it's all that's needed to create a channel object.
    */

    const userPrivateKey = configuration.budgetKey
    // the above looks like this:
    // "Xj32UgGbMee4FH6AiL2vLQ2csjgHsYUGm95wzUm04FTxpXXVbF8oegGZXQ8vtn5I97z"
    // "embQkSuGCZ4Oz4CiBUXovmQRe1kj03qmhjD5iiPC87YYJngnA3xQoqko9rX7hzNzrN"

    const newChannel = await new Channel(userPrivateKey).ready
    const handle = newChannel.handle
    console.log(handle)

    /* 
        note that we can construct the handle entirely from the above key. 
        Output from the above will look liked this:

        {
            channelId: "q44KU8ud2fU0IitSHHuWHntRaLNh9C88Umwn6Bm8RnG",
            userPrivateKey: "Xj32ByEmYVweL78dsybKP7ZZccuvjnEDSOHBztAZoFLSOw4Ksv65w4zwwcbcI6slnfTC5VfQ0WsyBb9egRFbvyasPWJvUctzrL8m"... 33 more characters,
            channelServer: undefined,
            channelData: {
                channelId: "q44KU8ud2fU0IitSHHuWHntRaLNh9C88Umwn6Bm8RnG",
                ownerPublicKey: "PNk2ByEmYVweL78dsybKP7ZZccuvjnEDSOHBztAZoFLSOw4BXT6t0CMYnHe9gnrC65rXR"
            },
            [Symbol(ChannelHandle)]: true
        }

        Note that channelServer is undefined. To actually talk to the channel server,
        we need to set it. But the point is that the channel object has a 'reality'
        that is independent of the server. 

        If we just try and connect (for example by getting channel keys):
    */

    // assertThrows(() => {
    //     newChannel.getChannelKeys()
    // }, Error, "channelServer is unknown");

    // /*
    //     So we set the channelServer, and get the 'channel keys'
    // */
    
    // // newChannel.channelServer = configuration.channelServer // eg "http://localhost:3845"

    const channelKeys = await newChannel.getChannelKeys()
    console.log(channelKeys)

    /*
        Channel keys look like this:

        {
            channelId: "q44KU8ud2fU0IitSHHuWHntRaLNh9C88Umwn6Bm8RnG",
            ownerPublicKey: "PNk2ByEmYVweL78dsybKP7ZZccuvjnEDSOHBztAZoFLSOw4BXT6t0CMYnHe9gnrC65rXR",
        }

        These are the keys you're allowed to retrieve from the server
        by only knowing the 'channelId' - unless the channel is locked,
        in which case the public key that you are connecting with 
        must be approved. This one:
    */

   console.log(SEP, newChannel.userPublicKey, SEP)

   /*
        That will look like this for this example:

            PNk2ByEmYVweL78dsybKP7ZZccuvjnEDSOHBztAZoFLSOw4BXT6t0CMYnHe9gnrC65rXR
        
        You don't need to track this authentication yourself, when you
        use the channel object (such as the 'getChannelKeys()' call above),
        will provide your public key and sign the request.

        Since we are the 'owner', these things should match. Here we compare
        what we derive from the private key to create the handle, with the
        parts that the channel servers replies with as channel data.
    */

    assert(handle.channelData?.channelId === channelKeys.channelId)
    assert(handle.channelData?.ownerPublicKey === channelKeys.ownerPublicKey)

    /*
        Basically when we create the handle in isolation from the server,
        then it will include what the channelData keys should be. "We"
        are supposedly in charge of that since our key is owner key.
        If the server responds with anything different, there's a problem.

        By the way, 'storageToken' is what was used to create the channel.

        Unless the channel is locked, anybody with the channelId can request
        the channel keys, in particular they can then use 'ownerPublicKey'
        to send a request to be allowed to use the channel. If the channel
        is 'locked', then that permission must have been pre-granted, eg
        your public key must already have been added to the channel.
    */


}


// if used by "deno test ...", calls this:
Deno.test("[slow] [channel] minimalist channel creation test", async () => {
    console.log('\n===================== 04.04 START channel test =====================')
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await connectToChannel()
    await ChannelApi.closeAll()
    console.log('\n===================== 04.04 END channel test   =====================')
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    // called if used from command line
    SB = new ChannelApi(configuration.channelServer, configuration.DBG)
    await connectToChannel()
}
