# 版本发布

## 发布方式

推送 `v*` 标签触发 `.github/workflows/release.yml`。有效标签为 `vX.Y.Z` 或包含 SemVer 预发布后缀的标签，例如 `v0.2.0-rc.1`。构建成功后创建 GitHub Release 草稿，维护者检查后手动公开。

版本由维护者选择。仓库的版本配置表示构建版本，已公开版本以 GitHub Releases 为准。CHANGELOG.md 的 Unreleased 保存尚未发布的功能。

## 构建与附件

构建任务使用 Windows Server 2022 x64、Node.js 24、Rust 1.91.1 和锁文件中的依赖，npm 下载使用缓存。任务依次执行：

1. 检查标签、项目版本和 CHANGELOG.md。
2. 运行代码检查、组件测试、发布脚本测试、Rust 格式检查、Clippy 和 Rust 测试。
3. 生成并检查规范索引，确认索引与仓库内容一致。
4. 安装 Playwright Chromium 并运行浏览器测试。
5. 构建 NSIS 安装包，准备附件与 SHA-256 校验文件。
6. 将产物传给独立发布任务，创建或更新同标签的 Release 草稿。

每个 Release 提供三个附件：

| 附件 | 用途 |
| --- | --- |
| `Key Relay_<版本>_x64-setup.exe` | 当前用户 NSIS 安装程序 |
| `key-relay.exe` | 免安装启动，使用系统 WebView2；有效设置仍保存在用户配置目录 |
| `SHA256SUMS.txt` | 两个 EXE 的 SHA-256，格式为十六进制值、两个空格、文件名 |

草稿正文为 CHANGELOG.md 中该版本的内容。预发布后缀对应 GitHub 的 prerelease 标记。Actions 中间产物保留 14 天，包含三个附件及传递正文用的 `release-notes.md`。

实际桌面输入、焦点、安装卸载和 RDP 在专用环境验收，参见 [Windows 验收](../tests/manual/windows.md)与 [RDP 验收](../tests/manual/rdp.md)。

## 仓库设置

- 仓库允许 GitHub Actions 运行，以及配置中引用的官方 Actions。
- 构建任务使用 `contents: read`。发布任务单独申请 `contents: write`，通过自动提供的 GITHUB_TOKEN 操作 Release。
- 组织或仓库策略应允许发布任务获得该权限；无需配置个人访问令牌。
- Actions 按提交 SHA 固定。发布任务执行标签所指提交中的脚本，标签推送权限应授予维护者。
- Actions 配置及发布脚本必须包含在标签所指提交中。

## 准备版本

以 `0.2.0` 为示例，实际版本在发布前确定。

1. 更新 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本号。
2. 使用以下命令同步锁文件，复核差异仅包含本次版本调整及预期依赖变化：

   ```bash
   npm install --package-lock-only --ignore-scripts
   cargo check --manifest-path src-tauri/Cargo.toml
   ```

3. 将 Unreleased 下已完成的内容移至带日期的版本条目，保留一个 Unreleased。版本条目采用非空的 Added、Changed、Deprecated、Removed、Fixed 或 Security 分类。

   ```markdown
   ## [Unreleased]

   ## [0.2.0] - 2026-10-03

   ### Added

   - 提供关于页、项目支持链接、联系邮箱和离线 MIT 许可证。

   [Unreleased]: https://github.com/sunnyx11/key-relay/compare/v0.2.0...HEAD
   [0.2.0]: https://github.com/sunnyx11/key-relay/releases/tag/v0.2.0
   ```

4. 运行本地校验：

   ```bash
   npm run release:check -- v0.2.0
   npm run test:release
   ```

   校验读取三份版本配置及两个锁文件，成功输出包含 `tag`、`version`、`prerelease` 和 `notes` 的 JSON。上述示例对应：

   ```json
   {
     "tag": "v0.2.0",
     "version": "0.2.0",
     "prerelease": false,
     "notes": "### Added\n\n- 提供关于页、项目支持链接、联系邮箱和离线 MIT 许可证。\n"
   }
   ```

5. 完成常规检查，提交并推送版本调整，然后为该提交创建附注标签并推送该标签。提交、标签和推送分别执行仓库约定的确认步骤。
6. 在 GitHub Actions 检查该标签的两个任务，随后进入 Releases 查看草稿。

仅含 Unreleased 时，发布校验会提示缺少版本条目并停止。校验命令和本地打包命令均不会创建标签或调用 GitHub。

## 本地附件验证

版本及更新说明就绪后执行。Windows 显式使用 `npm.cmd`，使 `--locked` 经 Tauri CLI 完整传给 Cargo：

```powershell
npm.cmd run package -- -- --locked
npm run release:bundle -- v0.2.0
```

输出目录为 `src-tauri/target/release-assets/v0.2.0/`，包含三个附件与 `release-notes.md`。校验文件只计算两个 EXE。Windows 可通过以下命令核对：

```powershell
Get-FileHash 'src-tauri/target/release-assets/v0.2.0/key-relay.exe' -Algorithm SHA256
Get-FileHash 'src-tauri/target/release-assets/v0.2.0/Key Relay_0.2.0_x64-setup.exe' -Algorithm SHA256
```

## 草稿检查与公开

- 确认两个 Actions 任务均成功，三个附件齐全，校验值正确。
- 确认标签、软件关于页和安装包版本一致。
- 检查更新说明中的功能、兼容性和已知限制。
- 试装并验证启动、图标、基本输入与退出；检查独立 EXE 启动。
- 保留“RDP 实际兼容性待人工验证”的说明，或附上对应实际验收结果。
- 确认当前无该标签的发布任务正在运行，再手动公开草稿。

## 失败与重试

- 版本或 CHANGELOG 校验失败：修正内容后创建新的发布提交与版本标签。已推送标签保留原指向。
- 下载、构建服务或上传暂时失败：在 Actions 使用 Re-run failed jobs；同标签任务按顺序执行。
- 首次上传中断时，已创建的 Release 保持草稿，可能只有部分附件。重试会更新草稿正文并替换三个附件中的同名文件。
- Release 已公开时，自动上传任务失败并保持公开内容。后续变化使用新版本发布。
- 权限不足时，检查 Actions 日志和仓库或组织的令牌权限策略。

## 验证状态

本地验证覆盖发布脚本、草稿接口调用契约、Actions 静态配置和 Windows 构建。GitHub 托管环境的实际构建、令牌权限与 Release 草稿上传需要首次推送版本标签后验证。
