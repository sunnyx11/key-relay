import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const skillRoot = fileURLToPath(new URL("../", import.meta.url));

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spec-coding-index-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const specsRoot = path.join(root, "docs/specs");
  fs.mkdirSync(path.join(specsRoot, "project"), { recursive: true });
  fs.mkdirSync(path.join(specsRoot, "domains/insight/changes"), { recursive: true });
  for (const name of ["context", "principles", "architecture", "glossary"]) {
    fs.copyFileSync(path.join(skillRoot, `templates/project-${name}.md`), path.join(specsRoot, `project/${name}.md`));
  }
  for (const name of ["overview", "requirements", "design"]) {
    fs.copyFileSync(path.join(skillRoot, `templates/domain-${name}.md`), path.join(specsRoot, `domains/insight/${name}.md`));
  }
  return { root, specsRoot };
}

function writeChange(specsRoot, sequence, status, reason, completedAt = "") {
  const text = `---
status: ${status}
created_at: 2026-03-20 09:30:00
completed_at: ${completedAt}
---

# 时间范围规则

关联规范：[当前需求](../requirements.md)

## 变更原因

<!-- 索引摘要说明。 -->
${reason}

## 变更前

接口使用不同时间边界。

## 变更后

接口使用统一时间边界。
`;
  const file = path.join(specsRoot, `domains/insight/changes/${sequence}-change.md`);
  fs.writeFileSync(file, text.replace(/\n/g, "\r\n"), "utf8");
}

function runCommand(name, root) {
  return spawnSync(process.execPath, [path.join(skillRoot, `scripts/${name}.mjs`), "--root", root, "--specs-dir", "docs/specs"], { encoding: "utf8" });
}

test("CLI generates grouped Change details and a stable index", (t) => {
  const { root, specsRoot } = createFixture(t);
  writeChange(specsRoot, "001", "completed", "统一 [Insight](../requirements.md) 时间范围，\n明确 [边界]。\n \t\n第二段提供详细背景。", "2026-03-20 11:00:00");
  writeChange(specsRoot, "002", "completed", "明确错误率变化的计算规则。", "2026-03-21 14:30:00");
  const result = runCommand("update-specs", root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "已更新：changes.md、requirements-index.md、index.md\n");
  const expected = `# 变更索引

> 由 \`update-specs.mjs\` 生成，请勿手工编辑。

## proposed

无

## accepted

无

## completed

- [insight/001](domains/insight/changes/001-change.md)：

  - 变更目的：统一 Insight 时间范围， 明确 \\[边界\\]。

  - 创建时间：2026-03-20 09:30:00

  - 完成时间：2026-03-20 11:00:00

- [insight/002](domains/insight/changes/002-change.md)：

  - 变更目的：明确错误率变化的计算规则。

  - 创建时间：2026-03-20 09:30:00

  - 完成时间：2026-03-21 14:30:00

## cancelled

无
`;
  assert.equal(fs.readFileSync(path.join(specsRoot, "changes.md"), "utf8"), expected);
  const check = runCommand("check-specs", root);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.equal(check.stdout, "检查通过：1 个 Domain，2 个 Change\n");
  assert.equal(check.stderr, "");
  assert.equal(runCommand("update-specs", root).status, 0);
  assert.equal(fs.readFileSync(path.join(specsRoot, "changes.md"), "utf8"), expected);
});

test("unfinished and cancelled Changes display an empty completion time", (t) => {
  const { root, specsRoot } = createFixture(t);
  for (const [index, status] of ["proposed", "accepted", "cancelled"].entries()) {
    writeChange(specsRoot, `00${index + 1}`, status, "统一时间边界。");
  }
  const result = runCommand("update-specs", root);
  assert.equal(result.status, 0, result.stderr);
  const output = fs.readFileSync(path.join(specsRoot, "changes.md"), "utf8");
  for (const [index, status] of ["proposed", "accepted", "cancelled"].entries()) {
    assert.ok(output.includes(`## ${status}\n\n- [insight/00${index + 1}](domains/insight/changes/00${index + 1}-change.md)：\n\n  - 变更目的：统一时间边界。\n\n  - 创建时间：2026-03-20 09:30:00\n\n  - 完成时间：无\n`));
  }
  assert.ok(output.includes("## completed\n\n无\n\n## cancelled"));
  assert.equal(runCommand("check-specs", root).status, 0);
});

test("CLI preserves adjacent indexes and rejects invalid dates without writes", (t) => {
  const { root, specsRoot } = createFixture(t);
  assert.equal(runCommand("update-specs", root).status, 0);
  const names = ["changes.md", "requirements-index.md", "index.md"];
  const baseline = names.map((name) => fs.readFileSync(path.join(specsRoot, name), "utf8"));
  writeChange(specsRoot, "001", "completed", "统一时间边界。", "2026-03-20 11:00:00");
  const stale = runCommand("check-specs", root);
  assert.equal(stale.status, 1);
  assert.ok(stale.stdout.includes("changes.md 与源文档不一致"));
  assert.equal(runCommand("update-specs", root).status, 0);
  for (const index of [1, 2]) {
    assert.equal(fs.readFileSync(path.join(specsRoot, names[index]), "utf8"), baseline[index]);
  }
  const valid = names.map((name) => fs.readFileSync(path.join(specsRoot, name), "utf8"));
  for (const completedAt of ["", "2026-03-19 11:00:00", "2026-02-30 11:00:00"]) {
    writeChange(specsRoot, "001", "completed", "统一时间边界。", completedAt);
    const rejected = runCommand("update-specs", root);
    assert.equal(rejected.status, 1);
    assert.notEqual(rejected.stderr, "");
    assert.equal(rejected.stdout, "");
    assert.deepEqual(names.map((name) => fs.readFileSync(path.join(specsRoot, name), "utf8")), valid);
  }
});
