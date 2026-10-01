#!/usr/bin/env node

import fs from "node:fs";

import { indexFilePath, inspectSpecs, parseOptions, renderIndexes } from "./lib/specs.mjs";

// CLI: validate source documents, then write three indexes; validation failures leave indexes untouched.
try {
  const model = inspectSpecs(parseOptions(process.argv.slice(2)));
  if (model.errors.length > 0) {
    throw new Error(model.errors.join("\n"));
  }
  const indexes = Object.entries(renderIndexes(model));
  const targets = indexes.map(([name, content]) => [indexFilePath(model.specsRoot, name), content]);
  for (const [target, content] of targets) {
    fs.writeFileSync(target, content, "utf8");
  }
  console.log("已更新：changes.md、requirements-index.md、index.md");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
