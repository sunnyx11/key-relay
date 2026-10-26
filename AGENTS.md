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

## 本地人工测试交付

- 每次修改完成并通过相关检查后，必须基于当前工作区重新生成 Windows x64 免安装 EXE，供人工测试。
- 构建使用 Node.js 24 及 [README 开发环境](README.md#开发)要求的工具链。在仓库根目录执行：

```powershell
npm.cmd run tauri -- build --no-bundle -- --locked
```

- Tauri 会自动执行前端类型检查和资源构建，再编译 Rust Release 程序。
- 当前终端的 Node.js 低于 24 时，可临时使用 Node.js 24 执行相同构建：

```powershell
npm.cmd exec --yes --package=node@24 -- npm.cmd run tauri -- build --no-bundle -- --locked
```

- 产物位于 `src-tauri/target/release/key-relay.exe`。交付前确认本次构建成功，并核对文件版本、生成时间及文件大小。
- 完成说明中提供本地 EXE 的文件链接、版本和构建验证结果。桌面交互及 RDP 功能由人工测试确认。
- 构建失败时，处理失败原因后重新构建；存在阻塞时明确说明原因和当前产物状态。
- 本地人工测试使用免安装 EXE；安装包及签名按[版本发布](docs/release.md)规范执行。
