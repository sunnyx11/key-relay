---
status: accepted
created_at: 2026-10-03 15:51:37
completed_at:
---

# 标签构建与 Release 草稿

关联规范：[项目架构](../../../project/architecture.md)、[项目原则](../../../project/principles.md)、[项目上下文](../../../project/context.md)

## 变更原因

版本标签需要触发自动检查和 Windows 打包，并生成供人工公开的 Release 草稿。

## 变更前

Windows 程序和 NSIS 安装包通过本地命令构建。仓库没有 GitHub Actions 发布配置及 CHANGELOG.md。

## 变更后

- 推送 `v*` 标签触发发布任务。有效版本采用 `vX.Y.Z`，可包含 SemVer 预发布后缀；预发布版本的草稿标记为 prerelease。
- 标签必须与 npm、Cargo、Tauri 配置及 npm、Cargo 锁文件中的项目版本一致。
- CHANGELOG.md 采用 Keep a Changelog 格式，保留 Unreleased。发布说明来自与标签对应的唯一版本条目，要求有效日期和实际变更内容；版本缺失、重复或内容为空时停止。
- Windows x64 构建环境安装 Node.js 24 和 Rust 1.91.1。组件、发布脚本、Rust、浏览器测试及代码、规范检查通过后生成 NSIS 安装包。
- 附件包含 NSIS 安装包、独立 key-relay.exe 和 SHA256SUMS.txt。独立 EXE 使用系统 WebView2。
- 构建任务只读仓库；独立发布任务使用 GITHUB_TOKEN 的 contents: write 权限创建草稿。Actions 引用固定提交。
- 同标签任务串行执行。首次成功运行创建草稿，重复运行更新草稿说明及同名附件；已公开 Release 阻止自动修改。
- 发布状态始终为草稿。维护者检查附件、版本、安装启动和发布说明后手动公开。
- 自动化执行常规测试；实际桌面输入、焦点、安装卸载和 RDP 保留专用环境验收。
- 输入示例：配置与锁文件均为 `0.2.0`，CHANGELOG.md 包含 `## [0.2.0] - 2026-10-03` 及有效条目，推送 `v0.2.0`。结果为名为 `Key Relay v0.2.0` 的草稿，包含对应更新说明、`Key Relay_0.2.0_x64-setup.exe`、`key-relay.exe` 和 `SHA256SUMS.txt`。
