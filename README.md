# lib384

Also read top-level AGENTS.md file for background.

The core TypeScript runtime library for [os384](https://384.dev) — a platform
for building genuinely private, secure, and sovereign applications.

lib384 runs in the browser. It provides the cryptographic primitives, channel
communication, shard storage, virtual filesystem (SBFS), and boot/loader
utilities that os384 apps are built on.

## Core primitives

**Channels** — end-to-end encrypted communication, owner-keyed via P-384
elliptic curve. The server sees only ciphertext, signatures, timestamps, and
public keys. Never plaintext.

**Shards** — padded, encrypted, immutable, content-addressed blobs. The storage
server maps IDs to data; it cannot read the contents. Deduplication works across
encrypted data.

**SBFS** — a virtual filesystem layered on shards, with a service worker that
lets web apps run as if they had a local file system.

**Strongphrase / Wallet** — user identity derived locally from a strongpin +
passphrase. No account creation. No central authority. Keys never leave the
device.

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

## Install

Make sure you have:

* yarn
* tsc (5.4.2)
* Deno (2.0.x)
* Python (3.9.x)

## Setup

```sh
  # install dependencies
  yarn install
  # build the library
  yarn build
```



### Test configuration

Use `384 init` if you haven't done so already.

Tests connect to a running os384 stack (local or dev servers).

See the [os384/services](https://github.com/os384/services) repo for running servers locally.

## Build output

| File                     | Format           | Use                                        |
|--------------------------|------------------|--------------------------------------------|
| `dist/384.esm.js`        | ESM              | Bundlers, direct import                    |
| `dist/384.iife.js`       | IIFE             | Plain `<script>` tags, exposes `window.__` |
| `dist/service-worker.js` | IIFE             | Service worker bundle                      |
| `dist/384.esm.d.ts`      | TypeScript types | IDE / type checking                        |


## Deploymenet

After building, deploy artifacts to os384 channel pages:

```sh
  cd dist
  384 publish -f dist/384.esm.js -k $sb384_lib384_esm
  384 publish -f 384.iife.js -k $sb384_lib384_iife
  384 publish -f 384.esm.d.ts -k $sb384_lib384_types
```

You will need to have environment variables set up for the above (obviously).


## LICENSE

## Licensing and Contributor Notice

Copyright (c) 2022-2026, 384 Inc.

"384", "os384", and "Snackabra" are registered trademarks.

os384 is released under the GNU Affero General Public License v3
(AGPL-3.0-or-later), [LICENSE](LICENSE). All contributions are
accepted under the same license.

Licensed under GNU Affero General Public License
<https://www.gnu.org/licenses/agpl-3.0.html>

**A note on future licensing:**

We are actively working on our long-term licensing and package
structure strategy. This may include changes that affect how
contributions to specific components are licensed. We are flagging
this now, so it is not a surprise. If you have questions or concerns
before contributing, please reach out at info@384.co.


## Cryptography Notice

This distribution includes cryptographic software. The country in
which you currently reside may have restrictions on the import,
possession, use, and/or re-export to another country, of encryption
software. Before using any encryption software, please check your
country's laws, regulations and policies concerning the import,
possession, or use, and re-export of encryption software, to see if
this is permitted. See <http://www.wassenaar.org/> for more information.

United States: This distribution employs only "standard cryptography"
under BIS definitions, and falls under the Technology Software
Unrestricted (TSU) exception.  Futher, per the March 29, 2021,
amendment by the Bureau of Industry & Security (BIS) amendment of the
Export Administration Regulations (EAR), this "mass market"
distribution does not require reporting (see
<https://www.govinfo.gov/content/pkg/FR-2021-03-29/pdf/2021-05481.pdf> ).


<!-- 

(Claude has an annoying habits of just dropping entire chunks of
documentation, thinking it knows more than it does ... below is
for me as human to track what Claude is dropping (AGENTS leave
this part alone please))

384 Library README
==================



Website: <https://384.co>.

The main packages are ''dist/384.iife.js'' and ''dist/384.esm.js''.

These libraries should show up under ''\_\_.'' (eg under ''window.\_\_'' or
''globalThis.\_\_'').

For the various demos and unit tests in this library, you will need to set up
''env.js'': copy 'env.example.js' to 'env.js', and look at what parts need to be
updated. specifically, you will need a budget handle and a ledger handle.

This library defaults to talking to 'dev' servers, so you will need handles
from 384co for those. if you are running your own servers, you would use
''cli.tools/bootstrap.token.ts'' to leverage wrangler authorization with those
servers to generate channel handles - run it twice, once for budget and once for
ledger.

In the various demos and tests and samples, roughly speaking the budget handle
is used as source of 'funding', and the ledger handle is used in various cases
where you want to be keeping results.

To run unit tests, you need deno_std set up, see below.

Once you've got handles set up, you can make sure things are running with ''yarn
test''. Those tests (in ''./tests.unit'') are also a good place to look for
examples of how to use the library. Note that some of them are quite technical
and low-level to test pieces of the library that build up to higher level
primits. Roughly speaking, the shorter the unit test the more likely to be
relevant to you.

The quicker tests are under ''yarn test:fast''.

The ''demos'' directory has a number of examples of how to use the library in
more complex ways.

Development
-----------

If you are contributor/developer, a few things:

Must-haves:

- you will need yarn, esbuild, and deno
  all of them you want native (not node, eg use brew on macs)

- ''yarn install'' still needed, sadly, currently no other practical way to roll
  up the type definitions

- then ''yarn start'' should do the rest, you can also do ''yarn all'' which
  forces a from-scratch build of everything

- as outlined above, to run some things you'll need to copy ''env.js.example''
  to ''env.js'' and provide a budget and ledger channel.

''config.js'' default points you to the dev servers, if you are running your
own you'll need to tweak ''env.js''.

You may need to use a few other variations:

- ''yarn build'' builds all the parts, most complete target
- ''yarn build:debug'' is the same but also creates ''dist/384.esm.debug.js''
  with inlined source maps (more resilient to source map issues)
- ''yarn types'' to roll up type definitions
- ''yarn browser'' for iife, ''start'' does not default to that
- sometimes a stand-alone ''tsc'' is needed
- ''yarn clean'' in case things seem broken

Additional things that might be needed:

- you may need ''ESBUILD_BINARY_PATH'' in your environment to the path to esbuild

- if you're doing dev on ''jslib'' you will need it cloned and parallel
  to this directory (''snackabra.ts'' is symlinked to ''../snackabra-jslib/src'').
  you do not need a build or package of jslib, lib384 will do that locally,
  it treats it as local source in ''src/snackabra''. and if you're not making
  changes, there should be both a clean ''js'' as well as a minified version in dist

- for unit tests and some cli.tools you need ''deno_std'' cloned from git and
  "parallel" to this directory, and symlinked to ''../deno_std''. you will find
  them here: <https://github.com/denoland/deno_std/releases>

- note that even if you're not running your own servers in general, you can run
  your own mirror server at ''<http://localhost:3841>''. you can use
  ''servers/mirror.py'' for that. if jslib sees this server, it will route all
  shard requests through it.

You'll probably also need python 3.9 (note, documentation system currently
has issues with 3.10+).


-----

The loader is primarily a library from demo 13:

```shell
  # deploy the loader
  cd demos/13.app.loader
  ../cli.tools/publish.page.ts -f index.js -k $sb384_appLoaderLib
```


384 CLI
=======

384 command line interface. To build and "install":

```bash
  make cli
  alias 384='/Users/<user>/dev/384-lib/bin/384'
  384 --help
```

Note that subcommands have help screens as well. The 'bin/384' target will
get rebuilt by various other make targets.




 -->