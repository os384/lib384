#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// Deploy lib384 build artifacts to os384 channel pages.
//
// Reads channel keys from environment variables:
//   OS384_LIB384_ESM   - channel key for 384.esm.js
//   OS384_LIB384_IIFE  - channel key for 384.iife.js
//   OS384_LIB384_TYPES - channel key for 384.esm.d.ts
//
// Or pass --key <key> --file <file> to deploy a single artifact.
//
// Usage:
//   deno task deploy
//   deno run -A tools/deploy.ts --file dist/384.esm.js --key $OS384_LIB384_ESM

import { parseArgs } from "jsr:@std/cli/parse-args";
import { publish } from "./publish.page.ts";

const args = parseArgs(Deno.args);

if (args.file && args.key) {
  await publish(args.file as string, args.key as string);
} else {
  const tasks = [
    { file: "dist/384.esm.js",   key: Deno.env.get("OS384_LIB384_ESM") },
    { file: "dist/384.iife.js",  key: Deno.env.get("OS384_LIB384_IIFE") },
    { file: "dist/384.esm.d.ts", key: Deno.env.get("OS384_LIB384_TYPES") },
  ];

  for (const { file, key } of tasks) {
    if (!key) { console.warn(`Skipping ${file}: no key set`); continue; }
    console.log(`Deploying ${file}...`);
    await publish(file, key);
  }
}
