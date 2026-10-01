#!/usr/bin/env node

import path from "node:path";

import { listChangeFiles } from "./lib/specs.mjs";

// Read-only CLI: print the next sequence; invalid input or exhaustion exits with 1.
function nextSequence(changesDirectory) {
  const files = listChangeFiles(changesDirectory);
  const maximum = Number(files.at(-1)?.sequence ?? 0);
  if (maximum === 999) {
    throw new Error("Change 序号已耗尽：最大允许序号为 999");
  }
  return String(maximum + 1).padStart(3, "0");
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    throw new Error("用法：node get-next-change-sequence.mjs <domain-changes-directory>");
  }

  const changesDirectory = path.resolve(args[0]);
  process.stdout.write(`${nextSequence(changesDirectory)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
