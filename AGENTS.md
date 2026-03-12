# AGENTS — lib384

Read `/os384/AGENTS.md` (workspace root) first for overall context.

## What this is

The core TypeScript runtime library for os384. Implements the cryptographic
primitives, channel protocol, storage API, browser helpers, and SBFS
(virtual filesystem over shards via service worker).

This is the most important repo in the org. Everything else depends on it.

## Build output

```
dist/
  384.esm.js          ESM bundle (for apps, loader, services)
  384.iife.js         IIFE bundle — exposes window.__ (for demos, legacy)
  384.sw.js           Service worker bundle (for SBFS)
  384.esm.js.map      (debug builds only)
  384.iife.js.map     (debug builds only)
```

## Key files

```
lib384/
├── src/index.ts      Public API surface — exports everything
├── src/              ~66 TypeScript source files
├── tests/            ~64 test files (deno test)
├── tools/
│   ├── deploy.ts     Deploy built artifacts to os384 channel pages
│   ├── publish.page.ts  Low-level channel page publisher
│   ├── LocalStorage.ts  Browser localStorage abstraction for tools
│   └── domTypes.ts   DOM type stubs for non-browser contexts
├── build.ts          Build script — uses npm:esbuild@0.24.2 via Deno
├── deno.json         Package config, tasks, import map
├── tsconfig.json     TypeScript config (moduleResolution: bundler)
├── env.example.js    Template for local env.js (gitignored)
└── .gitignore
```

## Build & test

```sh
deno task build           # ESM + IIFE + service worker bundles
deno task build:debug     # with sourcemaps, no minification
deno task dev             # watch mode
deno task test            # all tests
deno task test:fast       # tests tagged [fast]
deno task test:channel    # tests tagged [channel] (needs running server)
deno task deploy          # push dist/ to os384 channel pages
```

## Distribution model

lib384 is NOT published to npm or JSR. It is distributed via **os384 channel
pages** — served at a stable URL like `https://c3.384.dev/api/v2/page/{id}/384.esm.js`.

`deno task deploy` publishes dist/ to the production channel page.
The env vars `OS384_LIB384_ESM`, `OS384_LIB384_IIFE`, `OS384_LIB384_TYPES`
point to the target channel pages (set in env.js, gitignored).

## Import in Deno workspace

In the local Deno workspace (`os384/deno.json` at workspace root), other repos
import lib384 as:
```typescript
import { ... } from '@os384/lib384';
// resolves to ../lib384/src/index.ts
```

## What NOT to do

- Do NOT import from `node:` — source must be browser-compatible.
- Do NOT add npm/package.json — Deno only.
- Do NOT commit `dist/` — build output is gitignored.
- Do NOT commit `env.js` — holds credentials (channel keys/handles).
- Do NOT publish to JSR or npm.
- Do NOT modify `tsconfig.json` to use `moduleResolution: node` —
  it must stay as `bundler` for esbuild compatibility.

## Current state (RC3)

Source copied from `lib-proto-03/src/` (66 files) and `lib-proto-03/tests.unit/`
(64 files). Build script written. **Build not yet verified** — run
`deno task build` and fix any issues as first task.
