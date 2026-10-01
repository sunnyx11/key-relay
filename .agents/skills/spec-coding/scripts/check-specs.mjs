#!/usr/bin/env node

import fs from "node:fs";

import { indexFilePath, inspectSpecs, parseOptions, renderIndexes } from "./lib/specs.mjs";

// Read-only CLI: inspect source documents and indexes; diagnostics or invalid options exit with 1.
try {
  const model = inspectSpecs(parseOptions(process.argv.slice(2)));
  const expected = renderIndexes(model);
  for (const [name, content] of Object.entries(expected)) {
    const filePath = indexFilePath(model.specsRoot, name);
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== content) {
      model.errors.push(`${name} 与源文档不一致，请运行 update-specs.mjs`);
    }
  }
  if (model.errors.length > 0) {
    for (const error of model.errors) {
      console.log(`错误：${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`检查通过：${model.domains.length} 个 Domain，${model.changes.length} 个 Change`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
