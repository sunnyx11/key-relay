# Spec Coding 使用说明

`{SKILL_DIR}` 为当前 Skill 的绝对目录。命令在目标仓库根目录执行，`--root` 相对于执行目录，`--specs-dir` 相对于仓库根目录，默认为 `specs`。

## 初始化

1. 根据项目事实确定背景、约束和至少一个实际领域。
2. 按 [spec-structure.md](spec-structure.md) 从 Skill 模板建立全部必备文件，并为每个领域建立空 `changes/`。
3. 填写当前任务所需内容；尚未确定的内容保留模板结构，对应章节可以为空。
4. 统一生成索引并检查。

既有项目先按 [existing-project-spec-audit.md](existing-project-spec-audit.md) 调查当前任务需要的事实。批量迁移和历史重写须有对应授权范围。

## Change 开发

### 开发前

1. 读取相关当前规范、本次 Change、源码和测试，确认目标差异及全部待更新文档；文档归属见 [domain-modeling.md](domain-modeling.md#同步规则)。
2. 规范发生实质变化且尚无本次 Change 时，沿用会话中已核实的目标目录和编号；尚无该目录的已核实编号时才运行编号命令。获得写入确认后，按该编号排他创建 `<NNN>-change.md`，无需再次扫描目录或计算编号。同名文件冲突时先确认文件归属：属于本次 Change 则继续处理，属于其他 Change 则重新计算编号。
3. 按 [change.md](../templates/change.md) 和 [change-entry-format.md](change-entry-format.md) 填写状态、时间及全部关联规范，在 `变更后` 写明目标规则、必要设计和数据示例。当前规范在实际验证通过后同步。

### 实施与验证

根据当前需求和 Change 检查调用方、状态及相邻行为，完成代码和测试。目标、设计或同步范围变化时更新 Change 并重新确认。实施计划、任务状态和测试输出保留在会话或项目已有工具中。

### 完成

1. 实际运行相关测试和必要回归。
2. 验证通过后，按 Change 最新确认的目标和关联规范同步全部受影响文档。按 [需求划分规则](requirements-entry-format.md#模板与条目) 优先更新已有功能条目，更新数据示例和边界情况，共享规则单处定义并引用；按 [需求与引用规则](spec-structure.md#需求与引用) 维护条目顺序及受影响的引用，删除重复或冲突的旧内容。
3. 重新读取 Change 和全部受影响文档，逐项核对 `变更后` 的规则及必要设计均有完整定义或明确引用，覆盖所有受影响领域；检查需求划分、重复定义、编号顺序和引用完整性，确认旧内容与当前规则一致。
4. 核对通过后，按北京时间填写 `completed_at`，标记 `completed`，再生成和检查索引。文档继续修改或检查失败时，修正后重新生成和检查。

已确认的 Change 在验证、同步或内容核对尚未完成时保持 `accepted`；终止的 Change 使用 `cancelled`。

## 编号命令

输入目录包含 `001-change.md` 和 `003-change.md`：

```bash
node "{SKILL_DIR}/scripts/get-next-change-sequence.mjs" "specs/domains/identity/changes"
```

```text
stdout: 004\n
stderr: 空
退出码: 0
```

目录为空时返回 `001\n`。存在 `999-change.md` 时 stdout 为空，stderr 为 `Change 序号已耗尽：最大允许序号为 999\n`，退出码为 `1`。非法文件名、子目录及非目录输入均失败。完整编号规则见 [spec-structure.md](spec-structure.md)。

## 索引与检查命令

源文档编辑完成后依次执行：

```bash
node "{SKILL_DIR}/scripts/update-specs.mjs" --root .
node "{SKILL_DIR}/scripts/check-specs.mjs" --root .
```

输入具有一个 Domain 和一个有效 Change：

```text
更新 stdout: 已更新：changes.md、requirements-index.md、index.md\n
检查 stdout: 检查通过：1 个 Domain，1 个 Change\n
两条命令 stderr: 空
两条命令退出码: 0
```

自定义目录时，两条命令均使用 `--specs-dir docs/specs`。仅支持 `--root` 和 `--specs-dir`，缺值、重复或未知参数均失败。

- 更新命令在写入前校验全部源文档；源文档校验失败时三个索引保持原内容。
- 写入期间发生文件系统异常时更新命令失败，需要重新运行更新和检查。
- 检查命令只读，校验必备文件及模板标题结构、编号、需求和引用、Change 格式以及索引一致性。
- 更新失败写 stderr；检查内容错误写 stdout，参数或执行异常写 stderr；失败退出码为 `1`。
- 脚本检查限于上述结构和索引；需求划分、重复定义、条目顺序、业务语义、正文充分性、示例正确性及当前规范的同步情况由代理核对，ID 与编号的历史复用结合版本历史检查。

例如 `index.md` 与源文件不一致时，检查输出：

```text
stdout: 错误：index.md 与源文档不一致，请运行 update-specs.mjs\n
stderr: 空
退出码: 1
```

## 恢复上下文

根据任务读取当前需求、本次 Change、相关设计、源码差异和测试状态。三个索引用于定位文档，历史 Change 用于了解变更原因。
