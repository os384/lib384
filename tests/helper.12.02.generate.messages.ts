#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// 'helpers' are not unit tests, they are utilities to help with testing

// this connects to the 12.x stream and generates messages


const SEP = '\n' + '='.repeat(76) + '\n'

import { addSomeMessages } from './12.02.message.iterator.ts'

async function runTheCommand() {
    // @ts-ignore
    if (import.meta.main) {
        try {
            await addSomeMessages(7)
        } catch (e) {
            console.error("[helper.0] Caught exception:", e)
        }
        console.log(SEP, "Main done ...", SEP)
    }
}

(async () => {
    try {
        await runTheCommand();
    } catch (e) {
        console.error("[helper.12.02] Error in runTheCommand:", e);
        console.error(e.stack);
    }
})();
