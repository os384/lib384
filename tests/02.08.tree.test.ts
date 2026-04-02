#!/usr/bin/env -S deno run --allow-read

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


import {
    DeepHistory, TreeNodeValueType,
} from "../dist/384.esm.js"


const _SEP_ = '='.repeat(76)
const _SEP = '\n' + _SEP_
const SEP = '\n' + _SEP_ + '\n'

const DBG0 = false
const DBG1 = false

const MESSAGE_HISTORY_BRANCH_FACTOR = 3

export interface LocalMessageHistory extends TreeNodeValueType {
    subtype: 'localMessageHistory',
    created: number, // timestamp of creation (of this backup shard)
    value: string,
}

class LocalTestDeepHistory extends DeepHistory<number> {
    simulatedShardStorage: Array<string> = []
    constructor(branchFactor: number, data?: any, shardStorage?: Array<string>) {
        super(branchFactor, data)
        if (shardStorage) this.simulatedShardStorage = shardStorage
    }
    async storeData(data: any): Promise<number> {
        this.simulatedShardStorage.push(JSON.stringify(data))
        return this.simulatedShardStorage.length - 1
    }
    async fetchData(handle: number): Promise<any> {
        return JSON.parse(this.simulatedShardStorage[handle])
    }
    async insert(data: LocalMessageHistory) {
        await this.insertTreeNodeValue(data)    
    }
}

async function testLocal(N: number) {
    console.log(SEP, `Testing local deep history with ${N} messages (counting them from #1)`, SEP)
    const dh = new LocalTestDeepHistory(MESSAGE_HISTORY_BRANCH_FACTOR)
    console.log(SEP, "Initial state", _SEP)
    console.log(JSON.stringify(dh.export(), null, 2))
    if (DBG1) {
        console.log(SEP)
        console.log(dh)
    }
    for (let i = 1; i < N + 1; i++) {
        if (DBG0 || DBG1) console.log(_SEP)
        console.log("Inserting value", i)
        await dh.insert({
            type: 'messageHistory',
            subtype: 'localMessageHistory',
            from: i.toString().padStart(8, '0'),
            to: i.toString().padStart(8, '0'),
            count: 1,
            created: Date.now(),
            value: "message number " + i.toString().padStart(6, '0') + " [test, this could be anything]"
        })
        if (DBG0) {
            console.log(_SEP_)
            console.log("JSON of export AFTER inserting value " + i + ":")
            console.log(_SEP_)
            console.log(JSON.stringify(dh.export(), null, 2))
        }
        try {
            await dh.validate()
        } catch (e) {
            throw new Error(`Validation failed *after* inserting message #${i} (aborting), branch factor is ${MESSAGE_HISTORY_BRANCH_FACTOR}. ('${e}')`)
        }
        if (DBG1) {
            console.log(_SEP_)
            console.log(dh)
        }
    }
}

// creates a tree. every single time it adds an item, it will export and re-import the tree.
async function stressTestExportImport(N: number, branch: number = MESSAGE_HISTORY_BRANCH_FACTOR, exportImport = false) {
    console.log(SEP, `Testing local deep history with ${N} messages `, exportImport ? `with export/re-import on each step`:"", SEP)
    let dh = new LocalTestDeepHistory(branch)
    for (let i = 1; i < N + 1; i++) {
        if (DBG0) console.log("Inserting value", i, "(and will validate)", exportImport ? " (with export/import)" : "")
        await dh.insert({
            type: 'messageHistory',
            subtype: 'localMessageHistory',
            from: i.toString().padStart(8, '0'),
            to: i.toString().padStart(8, '0'),
            count: 1,
            created: Date.now(),
            value: "message number " + i.toString().padStart(6, '0') + " [test, this could be anything]"
        })
        try {
            await dh.validate()
        } catch (e) {
            throw new Error(`Validation failed: upon trying to insert message #${i} (aborting). Error message: ${e}`)
        }
        if (exportImport) {
            const x = dh.export()
            dh = new LocalTestDeepHistory(branch, x, dh.simulatedShardStorage)
        }
    }
}

if (import.meta.main) { // tells Deno not to run this in the test suite

    const b = MESSAGE_HISTORY_BRANCH_FACTOR

    console.log(SEP, "[02.08] [tree] testing tree with various sizes", SEP)

    await testLocal(b * b * b * b * b);

    // await testServer(b * b * b * b * b);

    console.log(SEP)
    // 'light weight' stress testing
    for (let j = 2; j < 8; j++) {
        try {
            console.log(SEP, "Testing with branch factor", j, SEP)
            await stressTestExportImport(j * j * j * j * j * j, j, true)
        } catch (e) {
            console.error(e)
            console.error("Failed at branch factor", j)
            break;
        }
    }
    for (let j = 8; j < 18; j++) {
        try {
            console.log(SEP, "Testing with branch factor", j, SEP)
            await stressTestExportImport(j * j * j * j, j, true)
        } catch (e) {
            console.error(e)
            console.error("Failed at branch factor", j)
            break;
        }
    }
    console.log(SEP)

    // // HEAVY stress testing ... will easily break Deno (GC issues)
    // console.log(SEP)
    // // systematic testing of where it fails at different branch factors:
    // for (let j = 2; j < 32; j++) {
    //     try {
    //         console.log(SEP, "Testing with branch factor", j, SEP)
    //         await stressTestExportImport(j * j * j * j * j * j, j, false)
    //     } catch (e) {
    //         console.error(e)
    //         console.error("Failed at branch factor", j)
    //         break;
    //     }
    // }
    // console.log(SEP)
    // for (let j = 2; j < 32; j++) {
    //     try {
    //         console.log(SEP, "Testing with branch factor", j, SEP)
    //         await stressTestExportImport(j * j * j * j, j, true)
    //     } catch (e) {
    //         console.error(e)
    //         console.error("Failed at branch factor", j)
    //         break;
    //     }
    // }
    // console.log(SEP)
    


}

