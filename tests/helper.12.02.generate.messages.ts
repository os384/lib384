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
