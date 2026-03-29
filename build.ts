#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run

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
import * as esbuild from "npm:esbuild@0.24.2";

const args = new Set(Deno.args);
const DEBUG  = args.has("--debug") || args.has("--debug2");
const DEBUG2 = args.has("--debug2");
const WATCH  = args.has("--watch");

const define = {
  "DBG":  DEBUG  ? "true" : "false",
  "DBG2": DEBUG2 ? "true" : "false",
};

// Resolve 'src/...' bare specifiers to actual paths under ./src/
// The source uses TypeScript path-alias style imports like:
//   import { foo } from 'src/utils/foo'
// esbuild needs a plugin to understand these.
const srcDir = new URL("src", import.meta.url).pathname;

const srcAliasPlugin: esbuild.Plugin = {
  name: "src-alias",
  setup(build) {
    build.onResolve({ filter: /^src\// }, async (args) => {
      const sub = args.path.slice(4); // strip leading "src/"
      return build.resolve("./" + sub, {
        resolveDir: srcDir,
        kind: args.kind,
      });
    });
  },
};

const commonConfig: esbuild.BuildOptions = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  target: "es2022",
  define,
  legalComments: "inline",
  sourcemap: DEBUG ? "linked" : false,
  minify: !DEBUG,
  plugins: [srcAliasPlugin],
};

const esmConfig: esbuild.BuildOptions = {
  ...commonConfig,
  format: "esm",
  outfile: "dist/384.esm.js",
};

const iifeConfig: esbuild.BuildOptions = {
  ...commonConfig,
  format: "iife",
  globalName: "__",
  outfile: "dist/384.iife.js",
};

const swConfig: esbuild.BuildOptions = {
  entryPoints: ["src/service-worker/index.ts"],
  bundle: true,
  format: "iife",
  outfile: "dist/384.sw.js",
  define,
  minify: !DEBUG,
  legalComments: "inline",
  plugins: [srcAliasPlugin],
};

// Always-present debug variant: ESM with inline sourcemaps, DBG=true, unminified.
// Inline sourcemaps are self-contained — the map survives regardless of how or where
// the file is served, making devtools source-stepping reliable during lib384 development
// (local demos, browser breakpoints, etc.).  Contrast with the linked .js.map files
// on the main bundles, which depend on the map being served at the right relative URL.
const esmDebugConfig: esbuild.BuildOptions = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  target: "es2022",
  define: { "DBG": "true", "DBG2": DEBUG2 ? "true" : "false" },
  legalComments: "inline",
  sourcemap: "inline",
  sourcesContent: true,
  minify: false,
  format: "esm",
  outfile: "dist/384.esm.debug.js",
  plugins: [srcAliasPlugin],
};

// Ensure dist/ exists
await Deno.mkdir("dist", { recursive: true });

if (WATCH) {
  console.log(`Watching for changes (${DEBUG ? "debug" : "production"})...`);
  console.log("  Note: dts-bundle-generator is skipped in watch mode.");
  const [esmCtx, iifeCtx, swCtx, esmDebugCtx] = await Promise.all([
    esbuild.context(esmConfig),
    esbuild.context(iifeConfig),
    esbuild.context(swConfig),
    esbuild.context(esmDebugConfig),
  ]);
  await Promise.all([
    esmCtx.watch(),
    iifeCtx.watch(),
    swCtx.watch(),
    esmDebugCtx.watch(),
  ]);
} else {
  console.log(`Building lib384 (${DEBUG ? "debug" : "production"})...`);
  await Promise.all([
    esbuild.build(esmConfig),
    esbuild.build(iifeConfig),
    esbuild.build(swConfig),
    esbuild.build(esmDebugConfig),
  ]);
  await esbuild.stop();
  console.log("  384.esm.js       ESM bundle");
  console.log("  384.iife.js      IIFE bundle (window.__)");
  console.log("  384.sw.js        Service worker bundle");
  console.log("  384.esm.debug.js ESM + inline sourcemaps, DBG=true");
  if (DEBUG) {
    console.log("  384.esm.js.map   (debug)");
    console.log("  384.iife.js.map  (debug)");
  }

  // Generate bundled type declarations.
  // dts-bundle-generator is needed because tsc --declaration emits per-file .d.ts
  // and does not support single-file rollup (TS#4433, open since 2015).
  console.log("\nGenerating types...");
  const dtsResult = await new Deno.Command("deno", {
    // Pinned to dts-bundle-generator@8.1.2 + typescript@5.4.2 (see deno.json imports) —
    // matching the last known-good baseline from lib-proto-03. TypeScript 5.7+ introduced
    // esnext.arraybuffer types that break structural checks on valid existing code.
    // Revisit these pins consciously when upgrading the TypeScript baseline.
    args: ["run", "-A", "npm:dts-bundle-generator@8.1.2", "-o", "dist/384.esm.d.ts", "src/index.ts"],
  }).output();
  if (dtsResult.success) {
    console.log("  384.esm.d.ts     Bundled type declarations");
  } else {
    console.error("  dts-bundle-generator failed:");
    console.error(new TextDecoder().decode(dtsResult.stderr));
    Deno.exit(1);
  }

  console.log("\nBuild complete -> dist/");
}
