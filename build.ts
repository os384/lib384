#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run

// Build script for lib384
// Replaces the old yarn/npm build pipeline.
// Uses esbuild via Deno's npm: specifier (requires Deno 2.x).
//
// Usage:
//   deno task build              # production build
//   deno task build --debug      # debug build (DBG=true, sourcemaps)
//   deno task build --debug2     # verbose debug build (DBG=true, DBG2=true)
//   deno task dev                # production build + watch mode

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

// Ensure dist/ exists
await Deno.mkdir("dist", { recursive: true });

if (WATCH) {
  console.log("Watching for changes...");
  const [esmCtx, iifeCtx, swCtx] = await Promise.all([
    esbuild.context(esmConfig),
    esbuild.context(iifeConfig),
    esbuild.context(swConfig),
  ]);
  await Promise.all([esmCtx.watch(), iifeCtx.watch(), swCtx.watch()]);
} else {
  console.log(`Building lib384 (${DEBUG ? "debug" : "production"})...`);
  await Promise.all([
    esbuild.build(esmConfig),
    esbuild.build(iifeConfig),
    esbuild.build(swConfig),
  ]);
  await esbuild.stop();
  console.log("Build complete -> dist/");
  console.log("  384.esm.js       ESM bundle");
  console.log("  384.iife.js      IIFE bundle (window.__)");
  console.log("  384.sw.js        Service worker bundle");
  console.log("");
  console.log("To generate types: deno run -A npm:dts-bundle-generator -o dist/384.esm.d.ts src/index.ts");
}
