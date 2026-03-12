#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write

const prefix = '05.03.test.run.001'

import '../env.js'
import '../config.js'
const configuration = (globalThis as any).configuration

// @deno-types="../dist/384.esm.d.ts"
import { SB384, ChannelApi, ChannelStream } from "../dist/384.esm.js"
import { SEP, getOwnerHandle } from "./test.utils.ts"

async function startTests() {

    // our starting point is "some" channel that Alice owns and controls,
    // think of it as a ledger Alice uses to keep track of her stuff
    const oh = await getOwnerHandle(prefix)
    const ch = await new ChannelStream(oh).ready
    console.log(SEP, `[$prefix] Alice ledger handle:`, SEP, ch.handle, SEP);

    // from a ChannelStream object, you can spawn() as many times as you need;
    // here we just print out all the messages in the channel. you need 
    // to 'await' the ch.spawn() being set up and ready, the outermost 'await'
    // means to block on everything being processed
    console.log(SEP, `[$prefix] All messages in the channel:`, SEP)
    await (await ch.spawn()).forEach(console.log);
    console.log(SEP, `[$prefix] End of all messages in the channel`, SEP)

    // ChannelStream objects all have their individual KV stores
    let state = await ch.get(prefix + '_kv_state')
    if (!state) {
        // if the state is not found, we create it
        console.log(SEP, "State not found, creating ...", SEP)
        state = { lobbyCounter: 0 }
        await ch.put(prefix + '_kv_state', state)
    } else {
        console.log(SEP, `State ['${prefix}_kv_state']:`, '\n', state, SEP)
    }

    // this one we set up to process only 'lobby' messages, and to keep going
    // for live messages. 
    (await ch.spawn({ live: true })).filter(m => m.body.type === 'lobby').forEach(async m => {
        console.log(SEP, `[$prefix] Lobby message received:`, SEP, m, SEP)
    });

    // let's see if we have any lobby messages, if not we create one
    if (state.lobbyCounter === 0) {
        const lobbyOwnerPrivateKey = (await new SB384().ready).userPrivateKey
        await ch.send({ type: 'lobby', msg: 'Hello, world, here is a lobby!', key: lobbyOwnerPrivateKey })
        state.lobbyCounter++
        await ch.put(prefix + '_kv_state', state)
    }

}

// Deno.test("[fast] [channel] more advanced key exchange example", async () => {
//     console.log('\n===================== 05.03 START protocol =====================')
//     new ChannelApi(configuration.channelServer, configuration.DBG) // for side effects
//     await startTests()
//     await ChannelApi.closeAll()
//     console.log('=====================   05.03 END protocol   =====================')
// });

// TODO: finish this test, currently breaks
if (import.meta.main) { // tells Deno not to run this in the test suite
    // command line used for iterative unit test development
    new ChannelApi(configuration.channelServer, configuration.DBG) // for side effects
    await startTests()
    // await ChannelApi.closeAll()  // not needed for command line
}
