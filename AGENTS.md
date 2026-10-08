# AGENTS.md

## 项目规范

- 本项目采用 [spec-coding](.agents/skills/spec-coding/SKILL.md)，Spec 根目录为 `docs/`。
- 从 [Spec 索引](docs/index.md) 阅读项目及领域文档
- 首版需求建立期间，Project / Domain 按主题维护目标规范，明确区分已确认要求、待确认建议及实现验证状态。需求确认表示开发依据成立，完成实现需要验证证据。本项目的首版约定优先于 Skill 中的通用生命周期规则。
- 首版基准形成后的需求变更使用 Change。开发前读取相关规范及适用的 Change，实现验证后同步关联规范。
- 文档维护规则见 [Project 原则](docs/project/principles.md#文档维护要求)。
- 准备提交、选择版本或执行发布时，先阅读 [版本发布](docs/release.md)。[版本策略](docs/release.md#版本策略)优先于 `git-release` 的通用破坏性变更规则，版本文件按[版本同步文件清单](docs/release.md#版本同步文件)核对。
- 更新文档后，在仓库根目录依次执行：

```bash
node .agents/skills/spec-coding/scripts/update-specs.mjs --root . --specs-dir docs
node .agents/skills/spec-coding/scripts/check-specs.mjs --root . --specs-dir docs
```
