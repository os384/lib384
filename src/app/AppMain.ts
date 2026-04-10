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
const DBG0 = true

import { Protocol_AES_GCM_256 } from 'src/channel/Protocol';
import { Channel } from 'src/channel/Channel';
import { ChannelHandle } from 'src/channel/ChannelHandle';
import { SBEventTarget } from 'src/utils/SBEventTarget';
import { ChannelStream } from '../channel/ChannelStream';

// apps should use something from manifest, but this works as fall back
const keyInfo = {
    salt1: new Uint8Array([166, 7, 217, 206, 20, 225, 139, 8, 157, 23, 48, 13, 113, 93, 140, 233]).buffer,
    iterations1: 100000,
    iterations2: 10000,
    hash1: "SHA-256",
    summary: "PBKDF2 - SHA-256 - AES-GCM"
}

function initialized<T extends { initialized: boolean }>(_target: T, propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value || descriptor.get || descriptor.set;
    function checkInitialization(this: T) {
        if (!this.initialized)
            throw new Error(`[AppMain] Cannot access ${propertyKey} before initialization.`);
    }
    if (original) {
        const adjustedFunction = function (this: T, ...args: any[]) {
            checkInitialization.call(this);
            return original.apply(this, args);
        };
        if (descriptor.value) descriptor.value = adjustedFunction; // setter
        if (descriptor.get) descriptor.get = adjustedFunction; // getter
        if (descriptor.set) descriptor.set = function (this: T, value: any) { // method
            checkInitialization.call(this);
            original.call(this, value);
        };
    }
    return descriptor;
}

// ToDo: AppMain is pretty confused about what is global (static) and what is not

/**
 * 'Main' class for os384 apps.
 *
 * Note that you need to call 'await init()' before you can use it. Among other
 * things, init() loads the manifest file, and sets up the 'ledger' and 'budget'
 * channels (if they are defined in the manifest). it loads the manifest file,
 * and sets up the 'ledger' and 'budget' channels (if they are defined in the
 * manifest).
 *
 * The manifest file is always called "384.manifest.json" and is expected to be
 * in the root of the app's directory. 
 *
 * Sample manifest file:
 *
   {
    "lang": "en",
    "short_name": "PhotoDwap",
    "name": "Distributed Web App Photo Sharing",
    "description": "Simple and easy to use photo sharing application.",
    "version": "1.0.17",
    "author": "384, Inc.",
    "vault": true,
    "keywords": [
        "photo", "camera", "web3", "384"
    ],
    "channels": [
        {
            "name": "budget",
            "size": 16000000
        },
        {
            "name": "ledger",
            "size": 4000000
        }
    ],
    "socialProof": [
        {
            "source": "384,inc",
            "website": "https://384.co",
            "twitter": "@384co",
            "github": "384co"
        }
    ]
}

 * The 'vault' flag is optional, and if present will indicate that the app is a
 * vault app, which means the loader will track information (such as generated
 * keys) on the global ledger. It will also force the vault to be available.
 *
 * The 'channels' array is optional, but if present will list channels that the
 * application expects to loader to provide. os384 apps launch off the loader,
 * which use the presence of a manifest to indicate that it's a "native" os384
 * app. It will use it's virtual file system (service worker) to populate the
 * manifest file, and provide any needed keys. At the other end, the "AppMain"
 * class will receive the manifest and provide functions to the application.
 *
 * You should provide specs for 'budget' and 'ledger' channels, they will be
 * used by AppMain - the 'budget' channel for any storage or processing budget,
 * and the 'ledger' channel for any global state or information. Simple apps
 * won't need additional channels, but more complex apps can define them in the
 * manifest.
 * 
 * You would use 'processLedgerMessages()' to start processing messages on the
 * 'ledger' channel. This will emit events 'ledgerMessage_<type>' for each
 * message received. You can use 'AppMain.on()' to listen for these events.
 * 
 * Conversely when you're posting ledger 'events' you would do something like:
 * 
 *   await App.main.ledgerChannel).send({ type: "joinGame", chessGame: App.main.chessGame })
 * 
 * eg you're sending a message with a 'type' of 'joinGame' and a 'chessGame'
 * object. The 'type' is used to emit the event 'ledgerMessage_joinGame'.
 *
 * When developing an app, you can use a "shadow manifest" to test your app.
 * This is a file called ".384.manifest.json" in the root of your app's
 * directory (you should probably include that in your .gitignore file). This
 * file will be used in place of the real manifest file, and can be used to test
 * your app without having to go through the loader. Make sure not to include
 * that file in your final distribution, since the loader will ignore it.
 *
 * Just as a 'main' function or object in many languages, there should only be
 * one of these in an app.
 *
 * @public
 */
export class AppMain extends SBEventTarget {
    #channelServer?: string;

    #ledgerChannel: Promise<Channel> | undefined;
    #ledgerStream?: ChannelStream;
    #budgetChannel: Promise<Channel> | undefined;

    // #ledgerChannelSocket: Promise<ChannelSocket> | undefined;
    // ledgerStream: typeof channel.stream | undefined;
    protocol: Protocol_AES_GCM_256 | undefined;

    #budgetHandle?: ChannelHandle
    #ledgerHandle?: ChannelHandle

    #manifest: any = {};
    #channelMap: Map<string, any> = new Map();

    // Default fallback passphrase used when the manifest doesn't specify one.
    // In production the loader generates a unique passphrase per channel via
    // strongphrase.generate() and includes it in the manifest. For local dev
    // with a skeleton manifest that omits the passphrase, this fallback keeps
    // things functional. See init() line that reads from channelMap.
    #ledgerPassPhrase = "officer stitch stretched"

    #initialized = false;
    static #instanceCount = 0;

    // convenience references
    on = AppMain.on;
    off = AppMain.off;
    emit = AppMain.emit;

    constructor() {
        super()
        AppMain.#instanceCount++;
        if (AppMain.#instanceCount > 1) {
            throw new Error("[AppMain] An os384 app should only have one 'main' class.")
        }

    }

    async init() {
        if (this.#initialized) {
            console.warn("[AppMain] Already initialized, skipping init.")
            return;
        }
        console.log('[AppMain] Init')

        // First try to load shadow manifest
        const shadowResponse = await fetch('/.384.manifest.json');
        if (DBG0) console.log(`[AppMain] Shadow manifest response:`, shadowResponse);

        let manifestData;
        if (shadowResponse.ok) {
            try {
                // If shadow manifest exists and is valid JSON, use it
                manifestData = await shadowResponse.json();
                console.log('[AppMain] Using shadow manifest:\n', JSON.stringify(manifestData, null, 2), '\n');
            } catch (error) {
                console.error('[AppMain] Error parsing shadow manifest:', error);
                // Fall through to try regular manifest
            }
        }

        // If no valid shadow manifest, try regular manifest
        if (!manifestData) {
            const manifestResponse = await fetch('/384.manifest.json');
            if (DBG0) console.log(`[AppMain] Regular manifest response:`, manifestResponse);
            
            try {
                manifestData = await manifestResponse.json();
                console.log('[AppMain] Using regular manifest:\n', JSON.stringify(manifestData, null, 2), '\n');
            } catch (error) {
                console.error('[AppMain] Error loading regular manifest:', error);
                manifestData = {};  // Use empty manifest as fallback
            }
        }

        this.#manifest = manifestData;
        
        // Process channels into map for easier access
        for (const channel of (this.#manifest as any).channels || [])
            this.#channelMap.set(channel.name, channel);
            
        // if we're host, we get these handles; if we're guest, we don't
        if (this.#channelMap.get('budget'))
            this.#budgetHandle = this.#channelMap.get('budget')?.handle
        if (this.#channelMap.get('ledger')) {
            this.#ledgerHandle = this.#channelMap.get('ledger')?.handle
            this.#ledgerPassPhrase = this.#channelMap.get('ledger')!.passphrase
            if (!this.#ledgerPassPhrase)
                console.warn('[AppMain] Ledger channel present in manifest but no passphrase — manifest needs to be resolved (384 manifest-resolve)')
        }
        
        this.protocol = new Protocol_AES_GCM_256(this.#ledgerPassPhrase, keyInfo)
        this.#channelServer = this.#manifest.channelServer
        this.#initialized = true;
    }
    get initialized() { return this.#initialized }

    /** Returns channelServer you're on */
    @initialized get channelServer() {
        if (!this.#channelServer) throw new Error("[AppMain] No channel server");
        return this.#channelServer
    }

    /** Returns the ledger passphrase (from manifest, or the default fallback). */
    @initialized get ledgerPassPhrase() {
        return this.#ledgerPassPhrase
    }

    /** Returns the 'ledger' handle, throws if there is none. */
    @initialized get ledgerHandle() {
        if (this.#ledgerHandle) return this.#ledgerHandle;
        else throw new Error("[AppMain] No ledger handle")
    }
    /** Returns a promise to the 'ledger' channel, throws if there is none. */
    @initialized get ledgerChannel() {
        if (this.#ledgerChannel) return this.#ledgerChannel;
        if (!this.#ledgerHandle) throw new Error("[AppMain] No ledger handle")
        this.#ledgerChannel = (new Channel(this.ledgerHandle, this.protocol).ready)
        return this.#ledgerChannel
        // return (new Channel(this.ledgerHandle, this.protocol).ready)
    }
    /** Returns the 'budget' handle, throws if there is none */
    @initialized get budgetHandle() {
        if (this.#budgetHandle) return this.#budgetHandle;
        else throw new Error("[AppMain] No budget handle")
    }
    /** Returns a promise to the 'budget' channel, throws if there is none */
    @initialized get budgetChannel() {
        if (this.#budgetChannel) return this.#budgetChannel;
        if (!this.#budgetHandle) throw new Error("[AppMain] No budget handle")
        this.#budgetChannel = (new Channel(this.budgetHandle, this.protocol).ready)
        return this.#budgetChannel
        // return (new Channel(this.budgetHandle, this.protocol).ready)
    }
    @initialized get keyInfo() {
        return keyInfo
    }
    /**
     * Returns the full manifest data structure. This will be an empty
     * object if there wasn't a manifest, or if it couldn't be loaded or parsed.
     */
    @initialized get manifest() {
        return this.#manifest
    }
    /**
     * Returns any 'parameters' passed to the app. If there weren't any,
     * or there wasn't a manifest, or there was an issue with the manifest,
     * etc, will return an empty object.
     */
    @initialized get parameters() {
        if (this.#manifest.parameters) return this.#manifest.parameters
        else return {}
    }
    /**
     * Will return the channel object from the manifest, or undefined if
     * it doesn't exist. Note that the two channels 'budget' and 'ledger'
     * have special handling, though they will be returned here as well.
     */
    @initialized getChannel(name: string) {
        return this.#channelMap.get(name)
    }

    /**
     * Starts processing all messages on the 'ledger' channel.
     * This is an async function that will run forever, or until
     * an error occurs. It will emit events 'ledgerMessage_<type>', 
     * use 'AppMain.on()' to listen for these events. If there's no
     * ledger (eg non-vault app etc), it will log a warning and return.
     */
    @initialized async processLedgerMessages(start: number = 0) {
        if (!this.#ledgerHandle) {
            console.warn("[AppMain] No ledger handle, skipping processLedgerMessages")
            return
        }
        if (this.#ledgerStream) throw new Error("[AppMain] Ledger stream already running (restarting not yet supported)")
        this.#ledgerStream = new ChannelStream(this.ledgerHandle, this.protocol)
        // const stream = this.#ledgerStream.start({ prefix: '0' });
        const stream = this.#ledgerStream.start({ start: start, live: true });
        for await (const message of stream) {
            if (typeof message.body === 'string') {
                console.info("[processMessages] received string message (ignoring):", message.body)
            } else {
                let emitName = `ledgerMessage_${message.body.type}`
                if (DBG0) console.log(`[AppMain] Emitting event: ${emitName}`, message.body)
                AppMain.emit(`${emitName}`, message.body)
            }
        }
    }

}