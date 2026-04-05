# Changelog

All notable changes to `lib384` are documented here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Added

- **Local mirror probe** (`storage/core.ts`): New `initLocalMirrorProbe()` and
  `isLocalMirrorAvailable()` exports. Shard fetches automatically probe
  `localhost:3841/api/version` (800ms timeout) and prefer the local mirror when
  available. Three-state logic: `true` → mirror first, `false` → remote only,
  `null` → both (original behavior). The probe self-initializes on first
  `fetchDataFromHandle()` call — no caller setup needed.

### Fixed

- **SBFS persistence**: Switched IndexedDB storage from JSON.stringify/parse to
  structured clone. Typed arrays (Uint8Array, ArrayBuffer) in ObjectHandles now
  survive persistence round-trips without lossy serialization. Removed all
  `reviveTypedArrayLike` workarounds and localStorage migration code.
- **knownShards hydration**: Shard handles from persisted state now correctly
  register in `ChannelApi.knownShards`, so re-uploading identical files is
  instant (skipped) instead of re-uploading every shard.
- **File set duplicate-content bug**: `uploadNewSet` now keys `newFileMap` by
  `fullName` (with fallback to `hash`) instead of content hash alone. Files with
  identical content but different paths (e.g. `index.md.D9DKf0ba.js` vs
  `index.md.D9DKf0ba.lean.js`) are now preserved as distinct entries. Previously
  9 files were silently dropped from any set containing duplicate-content files.
- **Service worker timeouts** (`service-worker/index.ts`): Added early
  passthrough (`return fetch(event.request)`) when no APP_ID has been set yet.
  Previously, vite dev requests like `/@vite/client` would hang for 12s waiting
  on an unresolved DB name promise before the `@timeout` decorator fired.
- **Service worker "/" → index.html mapping**: Directory requests now correctly
  map to `index.html` at any depth (e.g. `/guide/` → `/guide/index.html`).
  Uses `value.fullPath || key` to handle file sets where `.fullPath` isn't set.
- **Service worker authoritative 404**: Once an app is loaded, missing files
  return 404 instead of falling through to the network. Pre-app state still
  passes through to the network (needed for vite dev mode).

### Changed

- `SBFS._doneUploadingCalled` changed from `private` to `protected` so
  `SBFileSystem` subclass can reset the guard flag in `uploadNewSet`.
- Service worker version bumped to `20260402.1`, SWDB_VERSION 33 → 34.

## [0.3.0-rc3] — 2025-03

### Added

- Initial RC3 release. Source migrated from lib-proto-03. Build pipeline ported from yarn/esbuild to Deno build.ts.
