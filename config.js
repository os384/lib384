// (c) 2024 384 (tm)

// Reads globalThis.env (populated by keys.js) and selects the active
// profile to produce globalThis.configuration — the flat config object
// used by tests, demos, and tools.
//
// Load order:
//   Browser:  <script src="env.js">    — sets serverType
//             <script src="keys.js">   — reads serverType, sets globalThis.env
//             <script src="config.js"> — this file
//   Deno:     import './keys.js'       — reads Deno.env.get('ENV'), sets globalThis.env
//             import './config.js'     — this file
//
// You should only need to change this file if you're adding a new server profile.

// defaults to local, but keys.js overrides this via env.configServerType
const configServerType = env.configServerType || 'local';

// this carries global configuration settings
const configuration = { configServerType: configServerType }

const configTable = {

    // local is if you are running your own channel and storage servers
    'local': {
        channelServer: 'http://localhost:3845',
        storageServer: 'http://localhost:3843',
        appServer: "http://localhost:3840",

        budgetKey: env.localBudgetKey,
        ledgerKey: env.localLedgerKey,

        walletHandle: env.localWalletHandle,
        ledgerHandle: env.localLedgerHandle,
    },

    // 384 dev servers; change to your own as needed
    'dev': {
        channelServer: 'https://c3.384.dev',
        storageServer: 'https://s3.384.dev',
        appServer:     'https://384.dev',

        budgetKey: env.devBudgetKey,
        ledgerKey: env.devLedgerKey,

        walletHandle: env.devWalletHandle,
        ledgerHandle: env.devLedgerHandle,
    }
    
};

(function (global, factory) {
    if (typeof globalThis !== "undefined") {
        factory(globalThis);
    } else if (typeof global !== "undefined") {
        factory(global);
    } else if (typeof window !== "undefined") {
        factory(window);
    } else {
        throw new Error("config.js: globalThis is undefined (we don't support NodeJS)");
    }
}(this, function (globalThis) {
    const config = configTable[configServerType]
    for (const key in config) {
        configuration[key] = config[key];
    }
    globalThis.configuration = configuration;
    // any additional global configuration settings can be added here
    configuration.username = "Anonymous User";
}));
