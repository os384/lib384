# lib384

Also read top-level AGENTS.md file for background.

The core TypeScript runtime library for [os384](https://384.dev) — a platform for building
genuinely private, secure, and sovereign applications.

lib384 runs in the browser. It provides the cryptographic primitives, channel communication,
shard storage, virtual filesystem (SBFS), and boot/loader utilities that os384 apps are built on.

## Core primitives

**Channels** — end-to-end encrypted communication, owner-keyed via P-384 elliptic curve.
The server sees only ciphertext, signatures, timestamps, and public keys. Never plaintext.

**Shards** — padded, encrypted, immutable, content-addressed blobs. The storage server
maps IDs to data; it cannot read the contents. Deduplication works across encrypted data.

**SBFS** — a virtual filesystem layered on shards, with a service worker that lets
web apps run as if they had a local file system.

**Strongphrase / Wallet** — user identity derived locally from a strongpin + passphrase.
No account creation. No central authority. Keys never leave the device.

## Distribution

lib384 is served from os384 channel pages — the library bootstraps itself.

```js
// ESM (for bundlers / direct import)
import { Channel, SBFileSystem } from "https://c3.384.dev/api/v2/page/7938Nx0wM39T/384.esm.js"

// IIFE (for plain <script> tags — exposes window.__)
// <script src="https://c3.384.dev/api/v2/page/L2w00jf4/384.iife.js"></script>
```

For local development within the os384 workspace, import via the workspace:
```ts
import { Channel } from "@os384/lib384"
```

## Setup

Requires [Deno](https://deno.com) 2.x.

```sh
# Build browser bundles -> dist/
deno task build

# Watch mode (rebuilds on change)
deno task dev

# Run tests (requires servers — see env.example.js)
deno task test
deno task test:fast   # fast subset only
```

### Test configuration

Copy `env.example.js` to `env.js` and fill in your channel handles and server URLs.
Tests connect to a running os384 stack (local or dev servers).

See the [os384/services](https://github.com/os384/services) repo for running servers locally.

## Build output

| File | Format | Use |
|------|--------|-----|
| `dist/384.esm.js` | ESM | Bundlers, direct import |
| `dist/384.iife.js` | IIFE | Plain `<script>` tags, exposes `window.__` |
| `dist/service-worker.js` | IIFE | Service worker bundle |
| `dist/384.esm.d.ts` | TypeScript types | IDE / type checking |

Types can be generated after building:
```sh
deno run -A npm:dts-bundle-generator -o dist/384.esm.d.ts src/index.ts
```

## Deploying to os384

After building, deploy artifacts to os384 channel pages:
```sh
OS384_LIB384_ESM=<key> OS384_LIB384_IIFE=<key> OS384_LIB384_TYPES=<key> deno task deploy
```

## Licensing and Contributor Notice

os384 is released under the GNU Affero General Public License v3
(AGPL-3.0-or-later), [LICENSE](LICENSE). All contributions are
accepted under the same license.

**A note on future licensing:**

We are actively working on our long-term licensing and package
structure strategy. This may include changes that affect how
contributions to specific components are licensed. We are flagging
this now, so it is not a surprise. If you have questions or concerns
before contributing, please reach out at info@384.co.
