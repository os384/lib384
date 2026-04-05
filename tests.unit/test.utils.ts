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
declare var configuration: any;

const DBG0 = false

const CHANNEL_SERVER_WORKING_DIRECTORY = "../384-channelserver"

import {
    SB384, ChannelKeys, SBProtocol, Protocol_AES_GCM_256,
    SBChannelData, SBUserId, SBUserPublicKey, SBStorageToken,
    SBUserPrivateKey, Channel, ChannelHandle, generateStorageToken,
    sbCrypto, utils
} from '../dist/384.esm.js'

import { assert } from "../../deno_std/assert/assert.ts";

export const SEP = '\n' + '='.repeat(80) + '\n'
export const SEP_ = '-'.repeat(80) + '\n'

// Generate a random array buffer
export function generateRandomArrayBuffer(length: number) {
    const buffer = new Uint8Array(length);
    for (let i = 0; i < length; i++)
        buffer[i] = Math.floor(Math.random() * 256);
    return buffer.buffer;
}

const bs2dv = (bs: BufferSource) => bs instanceof ArrayBuffer
    ? new DataView(bs)
    : new DataView(bs.buffer, bs.byteOffset, bs.byteLength)

// Compare two array buffers for equality
export function compareArrayBuffers(buffer1: ArrayBuffer, buffer2: ArrayBuffer) {
    if (buffer1.byteLength !== buffer2.byteLength) return false;
    const view1 = bs2dv(buffer1);
    const view2 = bs2dv(buffer2)
    for (let i = 0; i < buffer1.byteLength; i++) {
        if (view1.getUint8(i) !== view2.getUint8(i)) {
            return false;
        }
    }
    return true;
}

export function inspectBinaryData(data: ArrayBuffer | ArrayBufferView) {
    const LINE_WIDTH = 40

    if (!data) return ('******* <empty> ******* (no value provided to inspectBinaryData)')

    let byteArray;
    if (data instanceof ArrayBuffer) {
        byteArray = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
        byteArray = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
        throw new Error('Unsupported data type');
    }
    const hexLine: Array<string> = [];
    const asciiLine: Array<string> = [];
    const lines: Array<string> = [];
    const lineLength = LINE_WIDTH; // You can adjust this as needed
    byteArray.forEach((byte, i) => {
        hexLine.push(byte.toString(16).padStart(2, '0'));
        asciiLine.push(byte >= 32 && byte <= 127 ? String.fromCharCode(byte) : '.');
        if ((i + 1) % lineLength === 0 || i === byteArray.length - 1) {
            // Pad the hex line if it's the last line and not full
            while (hexLine.length < lineLength) {
                hexLine.push('  ');
                asciiLine.push(' ');
            }
            lines.push(hexLine.join(' ') + ' | ' + asciiLine.join(''));
            hexLine.length = 0;
            asciiLine.length = 0;
        }
    });
    return lines.join('\n');
}

export function printKey(key: SB384) {
    console.log("==================== SB384 Key ====================")
    console.log("key.private:", key.private)
    // console.log("key.ready:", key.readyFlag)
    console.log("key.hash:", key.hash)
    console.log("key.userId:", key.userId)
    if (key.private) console.log("key.ownerChannelId:", key.ownerChannelId)
    // console.log("key.key:", key.key)
    if (key.private) console.log("key.jwkPrivate:", key.jwkPrivate)
    console.log("key.jwkPublic:", key.jwkPublic)
    if (key.private) console.log("key.userPrivateKey:", key.userPrivateKey)
    console.log("key.userPublicKey:", key.userPublicKey)
}

export function printChannelKeys(key: ChannelKeys) {
    // let's print out all the getters:
    console.log("==================== ChannelKeys ====================")
    // console.log("key.ready:", key.readyFlag)
    console.log("key.owner:", key.owner)
    console.log("key.channelData:", key.channelData)
    console.log("key.channelId:", key.channelId)
    // console.log("key.encryptionKey:", key.encryptionKey)
    // console.log("key.channelPrivateKey:", key.channelPrivateKey)
    // console.log("key.channelPublicKey:", key.channelPublicKey)
    console.log("key.channelServer:", key.channelServer ? key.channelServer : "<none specified>")

    // the 'owner' key for the channel:
    printKey(key)
}

export function printChannelData(data: SBChannelData) {
    console.log("==================== SBChannelData ====================")
    console.log("data.channelId:", data.channelId)
    console.log("data.ownerPublicKey:", data.ownerPublicKey)
    // console.log("data.channelPublicKey:", data.channelPublicKey)
    console.log("data.storageToken:", data.storageToken)
}

export function printChannelHandle(handle: any) {
    console.log("==================== ChannelHandle ====================")
    console.log("handle.channelId:", handle.channelId)
    console.log("handle.userPrivateKey:", handle.userPrivateKey)
    console.log("handle.channelPrivateKey:", handle.channelPrivateKey)
    console.log("handle.channelServer:", handle.channelServer)
    console.log("handle.channelData:", handle.channelData)
    printChannelData(handle.channelData)
}

// these are 'app level' types
export type PubKeyMessage = {
    type: 'pubKey',
    text?: string, // optional message
    userId: SBUserId,
    userPublicKey: SBUserPublicKey,
}

export type ChannelKeyMessage = {
    type: 'channelKey',
    text?: string, // optional message
    sendTo: SBUserId,
    channelPrivateKey: SBUserPublicKey,
}

export type ChatMessage = {
    type: 'chat',
    text: string,
}



// from-scratch tokens come from command-line, eg:

// not preview, and remote... THIS is the one that works (!) .. it hits namespace bbce...
// wrangler kv:key put --preview false --binding=LEDGER_NAMESPACE "LM2r...." '{"hash": "LM2r...", "used":false,"size":60000000000, "motherChannel": "<WRANGLER Command Line>"}'

// (or of course off a budget channel)

// if you have channel server running off a parallel directory, then this should
// work. upon success returns the token hash (which will be new if you didn't
// provide one)

const defaultSize = 1000 * 1024 * 1024 * 1024 // 100 GB

export async function refreshToken(local: boolean, tokenHash?: string): Promise<string | null> {
    try {
        if (!tokenHash) {
            // const SBStorageTokenPrefix = 'LM2r' // random prefix
            // tokenHash = SBStorageTokenPrefix + utils.arrayBufferToBase62(crypto.getRandomValues(new Uint8Array(32)).buffer);
            tokenHash = generateStorageToken()
        }
        const token: SBStorageToken = {
            hash: tokenHash!,
            used: false,
            size: defaultSize,
            motherChannel: "<WRANGLER>",
        }
        console.log(SEP, "Will set token to:\n", JSON.stringify(token, null, 2), '\n', SEP)
        const tokenString = JSON.stringify(token)
        let process
        if (local) {
            console.log("Refreshing storage token - local")
            process = Deno.run({
                // todo: add this token to config
                // cmd: ["wrangler", "kv:key", "put", "--preview", "--binding=LEDGER_NAMESPACE", "--local", "LM2r....", '{"used":false, "hash": "LM2r...", "size":6000000000, "motherChannel": "<WRANGLER>"}'],
                cmd: ["wrangler", "kv:key", "put", "--preview", "--binding=LEDGER_NAMESPACE", "--local", tokenHash, tokenString],
                stdout: "piped",
                stderr: "piped",
                cwd: CHANNEL_SERVER_WORKING_DIRECTORY,
            });
        } else {
            console.log("Refreshing storage token - preview")
            // this will hit the ledger name space in [env.devlopment] and preview
            process = Deno.run({
                cmd: ["wrangler", "kv:key", "put", "--preview", "false", "--binding=LEDGER_NAMESPACE", tokenHash, tokenString],
                stdout: "piped",
                stderr: "piped",
                cwd: CHANNEL_SERVER_WORKING_DIRECTORY,
            });
        }

        const { code } = await process.status();
        if (code !== 0) {
            const rawErrorOutput = await process.stderrOutput();
            const errorOutput = new TextDecoder().decode(rawErrorOutput);
            console.error(`Refreshing storage token failed: ${errorOutput}`);
            // process.stdout.close();
            // process.stderr.close();
            process.close();
            throw new Error("Refreshing storage token failed");
        } else {
            // If the process completes successfully, also ensure to close all streams
            console.log("Refreshed storage token - successful")
            // and i want to output the stdout results
            const rawOutput = await process.output();
            const output = new TextDecoder().decode(rawOutput);
            console.log(output);
            // process.stdout.close();
            process.stderr.close();
            process.close();
            return tokenHash!
        }

    } catch (error: any) {
        // if it's "No such file or directory" then we need to tell the user what directory to run the test script from
        if (error.message && error.message.includes("No such file or directory")) {
            console.info(
                "\n",
                "===================================================================================\n",
                "Please run this test from channel server directory (or token generation won't work)\n",
                "(Also note: this does not count as a failed test, simply means you won't get a new\n",
                "token, in case you needed one for 04.02 etc.)\n",
                "===================================================================================\n")
        } else {
            console.error("Got an error trying to run wrangler command line, and it wasn't 'no such file':", error)
            throw (error)
        }
        return null
    }
}


// Takes a private and public key, and returns a Promise to a cryptoKey
export function deriveKey(privateKey: CryptoKey, publicKey: CryptoKey, type: 'AES-GCM' | 'HMAC', extractable: boolean, keyUsages: KeyUsage[]): Promise<CryptoKey> {
    assert(privateKey && publicKey, "Either private or public key is null or undefined (L1836)")
    return new Promise(async (resolve, reject) => {
        let _keyAlgorithm: any
        switch (type) {
            case 'AES-GCM': {
                _keyAlgorithm = { name: 'AES-GCM', length: 256 }
                break
            }
            case 'HMAC': {
                _keyAlgorithm = { name: 'HMAC', hash: 'SHA-384', length: 384 }
                break
            }
            default: {
                throw new Error(`deriveKey() - unknown type: ${type}`)
            }
        }
        let _key = publicKey
        if (_key.type === 'private') {
            // handle case of being given a private key (so callee doesn't have to worry)
            const _jwk = await sbCrypto.exportKey('jwk', _key); assert(_jwk, "INTERNAL (L1878)")
            delete _jwk!.d
            delete _jwk!.alg // Deno issue
            _key = await sbCrypto.importKey('jwk', _jwk!, 'ECDH', true, []);
            assert(_key, "INTERNAL (L1882)")
        }
        assert(_key.type === 'public', "INTERNAL (L1631)")
        try {
            resolve(await globalThis.crypto.subtle.deriveKey({
                name: 'ECDH',
                public: _key
            },
                privateKey,
                _keyAlgorithm,
                extractable,
                keyUsages));
        } catch (e) {
            console.error(e, privateKey, publicKey, type, extractable, keyUsages);
            reject(e);
        }
    });
}

// we have our own mock version of this for test management
export class LocalStorage {
    private filePath: string;
    private data: Record<string, any>;
    constructor(filePath: string) {
        this.filePath = filePath;
        this.data = this.loadData();
    }
    private loadData(): Record<string, any> {
        try {
            const text = Deno.readTextFileSync(this.filePath);
            return JSON.parse(text);
        } catch {
            return {};
        }
    }
    private saveData(): void {
        Deno.writeTextFileSync(this.filePath, JSON.stringify(this.data));
    }
    public getItem(key: string): any {
        return this.data[key];
    }
    public setItem(key: string, value: any): void {
        this.data[key] = value;
        this.saveData();
    }
    public removeItem(key: string): void {
        delete this.data[key];
        this.saveData();
    }
    public clear(): void {
        this.data = {};
        this.saveData();
    }
}


// this would normally come out of bands or as ECDH message
const keyInfo = {
    salt1: new Uint8Array([179, 118, 123, 163, 161, 247, 188, 154, 75, 120, 116, 168, 126, 172, 251, 125]),
    iterations1: 100000,
    iterations2: 10000,
    hash1: "SHA-256",
    summary: "PBKDF2 - SHA-256 - AES-GCM"
}

// simplified source for some tests
// export const aesTestProtocol = new Protocol_AES_GCM_256("this is a passphrase", keyInfo)

export async function aesTestProtocol(): Promise<SBProtocol> {
    const p = new Protocol_AES_GCM_256("this is a passphrase", keyInfo)
    await p.ready()
    return p
}


/*

    Below are utility functions for unit tests that just want to get on with it, past
    basic operations. Owner and visitor keys are kept in local storage, grouped by
    'channel name'.

*/
const localStorage = new LocalStorage('./.local.data.json');

async function getBudgetChannel() {
    const budgetChannel =  await (new Channel(configuration.walletHandle)).ready
    console.log(SEP, "Wallet handle:\n", configuration.walletHandle, SEP)
    return budgetChannel
}

// gets owner key
async function getOwnerKey(name: string, quiet: boolean = false) {
    // first see if an owner key has been set up in localStorage
    let owner = localStorage.getItem(configuration.channelServer + name)
    if (!owner) {
        owner = (await new SB384().ready).userPrivateKey
        if (!quiet) console.log(SEP, `Generating and storing owner key ('${name}'):`, SEP, owner, SEP)
        localStorage.setItem(configuration.channelServer + name, owner)
    } else {
        if (!quiet) console.log(SEP, `Owner key found in localStorage:\n`, owner, SEP)
    }
    return owner
}

async function getMainChannel(ownerKey: SBUserPrivateKey, quiet: boolean = false): Promise<Channel> {
    if (DBG0) console.log(SEP, "Creating channel for owner key:\n", ownerKey, SEP)
    const mainChannel = await (new Channel(ownerKey)).ready
    mainChannel.channelServer = configuration.channelServer
    if (!quiet || DBG0) console.log(SEP, 'Main channel handle:', SEP, mainChannel.handle, SEP)
    // we test if the channel is working by getting the channel keys
    try {
        if (!quiet) console.log(SEP, 'Confirming channel keys:')
        const keys = await mainChannel.getChannelKeys()
        if (!quiet) console.log(keys, SEP)
    } catch (e: any) {
        if (!quiet) console.log('Channel keys failed, channel not authorized yet', e)
        // check if 'No such channel or shard' is in the error message
        if (e.message.indexOf('No such channel or shard') > -1) {
            // we need to create the channel
            if (!quiet) console.log(SEP, 'Creating channel...', SEP)
            const budget = await getBudgetChannel()
            if (DBG0) console.log("Will try to create:", mainChannel.handle)
            const newChannelHandle = await budget.budd({ targetChannel: mainChannel.handle })
            /* if (!quiet) */ console.log(SEP, 'Channel created:', SEP, JSON.stringify(newChannelHandle, null, 2), SEP)
        }
    }
    if (DBG0) console.log(SEP, "Done, returning main channel:\n", mainChannel, SEP)
    return mainChannel
}

/**
 * Returns handle for Owner for named channel. Create and fund it if it's not
 * already in place. If called for side-effect (eg to force existence of channel),
 * then set 'quiet' to true.
 */
export async function getOwnerHandle(channelName: string, quiet: boolean = false): Promise<ChannelHandle> {
    if (DBG0) console.log(SEP, "Getting owner handle for channel:", channelName, SEP)
    const ownerKey = await getOwnerKey(channelName, quiet)
    if (!quiet || DBG0) console.log("Owner key:", ownerKey)
    if (DBG0) console.log(SEP, "Getting Main Channel for that key:", SEP)
    const mainChannel = await getMainChannel(ownerKey, quiet)
    if (!quiet || DBG0) console.log("Main channel: ", mainChannel.channelId)
    if (DBG0) console.log(SEP, "Done, returning handle for channel", channelName, SEP)
    return mainChannel.handle
}

/**
 * Returns handle for Visitor for named channel. Created and funded (eg Owner handle
 * created and funded) if it's not already in place.
 */
export async function getVisitorHandle(channelName: string, visitorName: string): Promise<ChannelHandle> {
    const ownerHandle = await getOwnerHandle(channelName, true)
    const visitorHandleName = channelName + '_' + visitorName
    let visitorKey = localStorage.getItem(configuration.channelServer + visitorHandleName)
    if (visitorKey) {
        console.log(SEP, `Visitor key found in localStorage ('${visitorHandleName}'):\n`, visitorKey, SEP)
    } else {
        visitorKey = (await new SB384().ready).userPrivateKey
        console.log(SEP, `Generating and storing visitor key ('${visitorHandleName}'):`, SEP, visitorKey, SEP)
        localStorage.setItem(configuration.channelServer + visitorHandleName, visitorKey)
    }
    return({
        ...ownerHandle,
        userPrivateKey: visitorKey
    })
}

