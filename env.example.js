// (c) 2024 384 (tm)

// you will need to copy this to "env.js" and make any necessary changes below
// everything is consumed through "config.js"

// 'local' | 'dev' | 'stage' | 'prod'
const serverType = 'local';

// the rest you should only need to change upon setup

// tests and demos distinguish between 'budget' and 'ledger'
// keys as a convenience (os384 per se does not care)

// note that prod and staging use the same budget/ledger keys

(function (global, factory) {
    if (typeof global !== "undefined") {
        factory(global);
    } else if (typeof global !== "undefined") {
        factory(global);
    } else if (typeof window !== "undefined") {
        factory(window);
    } else {
        throw new Error("env.js: global is undefined");
    }
}(this, function (global) {

    const configServerType = serverType

    // run the 04.01 regression test (OS384_ENV=local deno task test:04.01) to generate
    // this and the budget key; values are saved to .local.data.json
    const localWalletHandle = {
        "channelId": "...",
        "userPrivateKey": "Xj33...",
        "channelServer": "http://localhost:3845",
        "channelData": {
            "channelId": "...",
            "ownerPublicKey": "PNk3..."
        }
    }
    const localBudgetKey = "Xj32..." // this is the userPrivateKey from above

    // budd from the budget channel to create a ledger channel; see docs/dev/local-stack
    const localLedgerHandle = {
        "channelId": "...",
        "userPrivateKey": "Xj33...",
        "channelServer": "http://localhost:3845",
        "channelData": {
            "channelId": "...",
            "ownerPublicKey": "PNk3..."
        }
    }
    const localLedgerKey = "Xj32..." // this is the userPrivateKey from above

    // additional options as needed:

    const devWalletHandle = { /* ... */ }
    const devBudgetKey = "Xj32..."

    const devLedgerHandle = { /* ... */ }
    const devLedgerKey = "Xj32..."

    const prodWalletHandle = { /* ... */ }
    const prodBudgetKey = "..."

    const prodLedgerHandle = { /* ... */ }
    const prodLedgerKey = "..."

    const env = {
        configServerType,
        localBudgetKey,
        devBudgetKey,
        prodBudgetKey,
        localLedgerKey,
        devLedgerKey,
        prodLedgerKey,
        localWalletHandle,
        devWalletHandle,
        prodWalletHandle,
        localLedgerHandle,
        devLedgerHandle,
        prodLedgerHandle,
    }

    global.env = env;
}));
