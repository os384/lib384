
// OLD, this would test that a channel socket would throw an exception properly
// if the server had hibernated ... well, channel sockets nowadays can handle
// that, so, test no longer applies.

// #!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// // similar to 04.07: connects and sends messages every 12 seconds, in order to
// // incurr a hibernation timeout each time.  however this time we send ttl0
// // messages, and have a separate listener; the channel socket has a small buffer
// // for resending ttl0 in these windows, this tests that.


// import '../env.js'
// import '../config.js'
// const configuration = (globalThis as any).configuration

// import { assertEquals } from '../../deno_std/assert/assert_equals.ts'
// import { assertRejects } from '../../deno_std/assert/assert_rejects.ts'
// import { assertThrows } from '../../deno_std/testing/asserts.ts'

// // the namespace for keys that this helper uses
// const ourChannelName = 'test_04_08_run011'


// import {
//     ChannelApi, ChannelSocket, Message,
//     ChannelHandle
//     // } from '../dist/384.esm.js'
// } from "../dist/384.esm.js"

// import { aesTestProtocol, getOwnerHandle, getVisitorHandle } from './test.utils.ts'

// const SEP = '\n' + '='.repeat(76) + '\n'
// const SEP_ = '='.repeat(76) + '\n'

// let SB: ChannelApi

// async function test01(count: number, interval: number) {
//     let messagesLeft = count
//     let messagesReceivedByFeeder = 0
//     let messagesReceivedByListener = 0
//     let testDone = false

//     let feederInterval, listenerInterval
//     let listenerSocket, feederSocket

//     const handle01 = await getVisitorHandle(ourChannelName, 'visitor01')
//     const handle02 = await getVisitorHandle(ourChannelName, 'visitor02')



//     // create a promise that we can resolve when feederOnMyMessage has received
//     // enough messages; at the end of this function feedSocket we will resolve
//     // this promise

//     let testResolve, testReject;
//     const testPromise = new Promise((resolve, reject) => {
//         testResolve = resolve;
//         testReject = reject;
//     })

//     const feederOnMyMessage = (msg: Message | string) => {
//         const m = (typeof msg === 'string') ? msg : msg.body
//         // console.log(SEP_, `++++ [FEEDER] [#${messagesReceivedByFeeder}] ++++ [04.08] message received:\n`, m);
//         if (m.ts) {
//             if (messagesReceivedByFeeder++ >= count) {
//                 clearInterval(feederInterval);
//                 console.log(SEP_, '[04.08] [FEEDER] We have received enough messages, done')
//                 // assertEquals(messagesReceivedByListener, messagesReceivedByFeeder, "Listener did not receive enough messages")
//                 if (messagesReceivedByListener !== messagesReceivedByFeeder) testReject("Listener did not receive enough messages")
//                 else testResolve("done");
//             }
//         }
//     }

//     const listenerOnMyMessage = (msg: Message | string) => {
//         const m = (typeof msg === 'string') ? msg : msg.body
//         console.log(SEP_, `++++ [LISTENER] [#${messagesReceivedByListener}] ++++ [04.08] message received:\n`, m);
//         if (m.ts) messagesReceivedByListener++
//     }

//     listenerSocket = await new ChannelSocket(listener, listenerOnMyMessage, await aesTestProtocol()).ready
//     .catch(() => { testReject("LISTENER error on first connect (closed?)") });

//     if (!listenerSocket) {
//         testReject("LISTENER error on first connect (closed?)"); testReject('Listener cannot send messages')
//     } else {
//         console.log(SEP_, '[04.08][LISTENER] now listening for messages on channel:', listener.channelId, SEP, /* JSON.stringify(h, null, 2), SEP */)
//         await listenerSocket.send('hello there from [04.08] [LISTENER], we should be ready now')
//         .catch(() => { console.error("FEEDER error on first send, why?") })

//         const feederSocket = await new ChannelSocket(feeder, feederOnMyMessage, await aesTestProtocol()).ready
//         .catch(() => { testReject("FEEDER error on first connect (closed?)") });

//         if (!feederSocket) {
//             testReject("FEEDER error on first connect (closed?)");
//         } else {

//             console.log(SEP_, '[04.08][FEEDER] now listening for messages on channel:', feeder.channelId, SEP, /* JSON.stringify(h, null, 2), SEP */)
//             /* const r = */ await feederSocket.send(
//                 'hello there from [04.08] [FEEDER], we should be ready now = ' + new Date().toISOString(),
//                 { ttl: 0 }
//             ).catch(() => { console.error("FEEDER error on first send, why?") })

//             listenerInterval = setInterval(async () => {
//                 if (testDone) {
//                     console.log(SEP_, '[04.08] [LISTENER] done, closing channel', SEP)
//                     clearInterval(feederInterval);
//                     clearInterval(listenerInterval);
//                     // await listenerSocket.close()
//                 } else {
//                     console.log(SEP_, `[04.08] [LISTENER] sending ping message #${messagesLeft}`)
//                     await feederSocket.send(
//                         { t: `[#${messagesLeft}] ping from [04.08] [LISTENER] (with TTL 0)`, ts: new Date().toLocaleString() },
//                         { ttl: 0 })
//                         .then(() => {
//                             console.log(SEP_, `[04.08] ... LISTENER succeeded in sending #${messagesLeft}`)
//                         })
//                         .catch((e: any) => {
//                             console.error("[LISTENER] got error on sending, test probably over]")
//                             clearInterval(listenerInterval);
//                             testReject("LISTENER was not able to send another message ... presumably we're done?")
//                         });
//                 }
//             }, (interval + 1) * 1000); // listener deliberately a little slower

//             feederInterval = setInterval(async () => {
//                 if (testDone) {
//                     console.log(SEP_, '[04.08] [FEEDER] done, closing channel', SEP)
//                     clearInterval(feederInterval);
//                     clearInterval(listenerInterval);
//                     // await feederSocket.close()
//                 } else {
//                     console.log(SEP_, `[04.08] [FEEDER] sending ping message #${messagesLeft}`)
//                     await feederSocket.send(
//                         { t: `[#${messagesLeft}] ping from [04.08] [FEEDER] (with TTL 0)`, ts: new Date().toLocaleString() },
//                         { ttl: 0 })
//                         .then(() => {
//                             console.log(SEP_, `[04.08] ... FEEDER succeeded in sending #${messagesLeft}`)
//                         })
//                         .catch(() => {
//                             clearInterval(feederInterval);
//                             testReject("FEEDER was not able to send another message ... presumably we're done?")
//                         });
//                     if (messagesLeft-- <= 0) {
//                         console.log(SEP_, '[04.08] [FEEDER] Feeder done (no more messages to send)', SEP)
//                         clearInterval(feederInterval);
//                     }
//                 }
//             }, interval * 1000);


//         }
//     }

//     console.log("Waiting for testPromise to resolve")
//     await testPromise
//     console.log("testPromise resolved")

//     // cleanup
//     clearInterval(feederInterval);
//     clearInterval(listenerInterval);

//     if (listenerSocket) await listenerSocket.close();
//     if (feederSocket) await feederSocket.close();

//     // await listenerSocket.close().catch(() => { /* ignore */ })
//     // await feederSocket.close().catch(() => { /* ignore */ })
// }

// window.addEventListener('error', (event) => {
//     console.trace('Uncaught error:', event.error);
// });

// window.addEventListener('unhandledrejection', (event) => {
//     console.trace('Unhandled promise rejection:\n', event.reason);
// });


// Deno.test("[slow] [channel] channel socket timeout / reset test", async () => {
//     console.log('\n===================== 04.08 START channel socket test =====================')
//     SB = new ChannelApi(configuration.channelServer, configuration.DBG);
//     await test01(4, 2)
//     ChannelApi.closeAll()
//     console.log('\n===================== 04.08 END channel socket test   =====================')
// });

// if (import.meta.main) {
//     SB = new ChannelApi(configuration.channelServer, configuration.DBG);
//     await test01(4, 2)
//     ChannelApi.closeAll()
//     console.log('done.')
// }
