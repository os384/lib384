#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

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
