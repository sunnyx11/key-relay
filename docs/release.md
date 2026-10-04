# 版本发布

## 发布方式

推送 `v*` 标签触发 `.github/workflows/release.yml`。有效标签为 `vX.Y.Z` 或包含 SemVer 预发布后缀的标签，例如 `v0.2.0-rc.1`。构建成功后创建 GitHub Release 草稿，维护者检查后手动公开。

版本由维护者选择。仓库的版本配置表示构建版本，已公开版本以 GitHub Releases 为准。CHANGELOG.md 的 Unreleased 保存尚未发布的功能。

Release 标题等于完整版本标签，例如 `v0.2.2` 或 `v0.2.2-rc.1`。创建和更新草稿采用同一命名规则。

## 构建与附件

构建与检查任务使用 Windows Server 2022 x64、Node.js 24、Rust 1.91.1 和锁文件中的依赖。标签触发三个并行任务：

| 任务 | 职责 |
| --- | --- |
| `frontend` | 校验标签、版本和更新说明；运行代码检查、组件测试、发布脚本测试、规范索引检查及浏览器测试 |
| `rust` | 运行 Rust 格式检查、Clippy 和常规 Rust 测试，检查 Cargo 锁文件保持一致 |
| `build` | 校验标签、版本和更新说明；构建并签名 NSIS 安装包，准备附件与 SHA-256 校验文件，检查锁文件保持一致 |

浏览器测试只安装 Chromium Headless Shell。`draft` 等待三个任务全部成功后，下载构建附件并创建或更新同标签的 Release 草稿。任一任务失败或取消时，草稿任务跳过。

### 默认分支 CI 与缓存

`.github/workflows/ci.yml` 在 `main` 推送时运行，也支持 Actions 手动执行。前端检查、Rust 检查和 Release 编译分别执行。Release 编译使用以下命令生成前端资源与优化后的应用：

```powershell
npm.cmd run tauri -- build --no-bundle -- --locked
```

该命令省去安装包生成及签名，CI 无需签名私钥。公钥变量与发布构建一致，CI 仅验证编译并准备缓存，发布附件来自标签构建。

- npm 下载缓存由默认分支任务准备，标签任务可以恢复。
- Rust 缓存使用固定提交的 `Swatinem/rust-cache`。工作区为 `src-tauri -> target`，缓存 Cargo 依赖和依赖编译产物。
- Rust 检查使用 `windows-2022-check-v1`，Release 编译使用 `windows-2022-release-v1`。CI 与发布的用途、运行环境和工具链一致。
- 缓存 Action 在共享键中加入工具链、编译环境和依赖配置，依赖变化时可恢复已有依赖缓存。应用自身和增量编译产物按 Action 默认规则排除。
- 仅默认分支成功任务保存 Rust 缓存，标签任务只恢复。不同标签的缓存相互隔离，标签可恢复默认分支缓存。
- 缓存命中后仍执行完整检查和构建；缓存缺失时重新下载依赖并编译。

版本发布前等待 `main` CI 的 Rust 检查和 Release 编译成功，可使标签任务使用已有缓存。首次 CI、工具链变化、依赖变化或缓存过期时，编译耗时可能增加。缓存命中和耗时以 Actions 日志为依据。

### 发布附件

每个 Release 提供五个附件：

| 附件 | 用途 |
| --- | --- |
| `key-relay_<版本>_x64-setup.exe` | 当前用户 NSIS 安装程序 |
| `key-relay.exe` | 免安装启动，使用系统 WebView2；有效设置仍保存在用户配置目录 |
| `key-relay_<版本>_x64-setup.exe.sig` | Tauri 更新签名，内容与安装包对应 |
| `latest.json` | 版本、说明、构建时刻及 Windows x64 的安装包 URL 和完整签名 |
| `SHA256SUMS.txt` | 其余四个附件的 SHA-256，格式为十六进制值、两个空格、文件名 |

应用产品名为 `Key Relay`。Tauri 生成的安装包名为 `Key Relay_<版本>_x64-setup.exe`，附件准备阶段将其与 `.sig` 按表中名称复制，保留原始字节。更新清单 URL 和 SHA-256 文件均引用发布附件名。

草稿正文为 CHANGELOG.md 中该版本的内容。预发布后缀对应 GitHub 的 prerelease 标记。Actions 中间产物保留 14 天，包含五个附件及传递正文用的 `release-notes.md`。

实际桌面输入、焦点、安装卸载和 RDP 在专用环境验收，参见 [Windows 验收](../tests/manual/windows.md)与 [RDP 验收](../tests/manual/rdp.md)。

## 仓库设置

- 仓库允许 GitHub Actions 运行，以及配置中引用的 Actions，包括 `Swatinem/rust-cache`。
- 构建任务使用 `contents: read`。发布任务单独申请 `contents: write`，通过自动提供的 GITHUB_TOKEN 操作 Release。
- 组织或仓库策略应允许发布任务获得该权限；无需配置个人访问令牌。
- Actions 按提交 SHA 固定。发布任务执行标签所指提交中的脚本，标签推送权限应授予维护者。
- Actions 配置及发布脚本必须包含在标签所指提交中。

## 更新签名配置

使用 Tauri 专用签名密钥。私钥在仓库外保存并离线备份，后续版本使用同一密钥。更新签名负责校验下载包，Windows Authenticode 属于独立的证书签名机制。

在可信终端生成密钥，交互输入私钥密码：

```powershell
npm run tauri -- signer generate -w C:\Secure\key-relay-updater.key
```

配置 GitHub 仓库的 Actions Secrets 和 Variables：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | 私钥文件完整内容 |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 |
| Variable | `TAURI_UPDATER_PUBLIC_KEY` | `.pub` 文件完整内容 |

构建步骤注入上述变量。`scripts/package.mjs` 将公钥写入本次构建的 Tauri 配置，客户端和 CLI 使用同一公钥。Tauri CLI 使用私钥为 NSIS 安装包签名，并将版本写入签名的可信注释。客户端要求签名内版本与清单一致。正式打包前校验私钥和公钥配置存在，生成后在隔离环境验证升级。

本地打包在当前终端设置同名环境变量。私钥内容和密码应通过受保护的凭据工具提供，避免写入脚本、日志或仓库。

## 更新通道

客户端只检查最新公开正式 Release：

```text
https://github.com/sunnyx11/key-relay/releases/latest/download/latest.json
```

清单示例：

```json
{
  "version": "0.2.0",
  "notes": "### Added\n\n- 提供应用更新。\n",
  "pub_date": "2026-10-04T00:00:00.000Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<安装包 .sig 文件的完整内容>",
      "url": "https://github.com/sunnyx11/key-relay/releases/download/v0.2.0/key-relay_0.2.0_x64-setup.exe"
    }
  }
}
```

`pub_date` 记录附件生成时刻；草稿公开时刻由 GitHub 记录。安装包 URL 固定到版本标签。清单正文与 Release 正文一致，上传前验证版本、URL、签名、日期和四份校验值。草稿和预发布供人工检查，客户端拒绝预发布、相同版本及更低版本。

0.1.0 通过手动安装升级至带更新模块的版本。更新模块的首次完整验收使用两个带同一签名公钥的构建 A、B；A→B 成功后才确认正式更新通道可用。

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
6. 在 GitHub Actions 确认 `frontend`、`rust`、`build` 和 `draft` 四个任务成功，随后进入 Releases 查看草稿。

仅含 Unreleased 时，发布校验会提示缺少版本条目并停止。校验命令和本地打包命令均不会创建标签或调用 GitHub。

## 本地附件验证

版本及更新说明就绪后执行。Windows 显式使用 `npm.cmd`，使 `--locked` 经 Tauri CLI 完整传给 Cargo：

```powershell
npm.cmd run package -- -- --locked
npm run release:bundle -- v0.2.0
```

输出目录为 `src-tauri/target/release-assets/v0.2.0/`，包含五个附件与 `release-notes.md`。校验文件计算安装包、独立 EXE、签名和清单。Windows 可通过以下命令核对：

```powershell
Get-FileHash 'src-tauri/target/release-assets/v0.2.0/key-relay.exe' -Algorithm SHA256
Get-FileHash 'src-tauri/target/release-assets/v0.2.0/key-relay_0.2.0_x64-setup.exe' -Algorithm SHA256
```

## 草稿检查与公开

- 确认四个 Actions 任务均成功，五个附件齐全，校验值正确。
- 使用隔离 Windows 环境完成 A→B 签名升级，验证重启、设置保留和编辑文本清除；安装启动失败时验证快捷键和任务能力恢复。
- 公开后核对最新正式版本端点返回清单，旧版仅提示版本，确认后才下载。
- 确认标签、软件关于页和安装包版本一致。
- 检查更新说明中的功能、兼容性和已知限制。
- 试装并验证启动、图标、基本输入与退出；检查独立 EXE 启动。
- 保留“RDP 实际兼容性待人工验证”的说明，或附上对应实际验收结果。
- 确认当前无该标签的发布任务正在运行，再手动公开草稿。

## 失败与重试

- 版本或 CHANGELOG 校验失败：修正内容后创建新的发布提交与版本标签。已推送标签保留原指向。
- 下载、构建服务或上传暂时失败：在 Actions 使用 Re-run failed jobs；同标签任务按顺序执行。
- 首次上传中断时，已创建的 Release 保持草稿，可能只有部分附件。重试会更新草稿正文并替换五个附件中的同名文件。
- Release 已公开时，自动上传任务失败并保持公开内容。后续变化使用新版本发布。
- 权限不足时，检查 Actions 日志和仓库或组织的令牌权限策略。

## 验证状态

本地验证覆盖发布脚本、五附件校验、草稿接口调用、前端确认操作、原生任务与安装互斥及安装目录识别。官方 Updater 的下载集成测试验证签名包接受、篡改包拒绝及签名版本校验。测试密钥已用于 NSIS 签名构建。

正式签名密钥、Actions Secrets 和公钥变量待配置。实际 A→B 升级、安装失败资源恢复、0.1.0 手动升级及公开 GitHub 通道待隔离 Windows 环境验收。Change 010 保持 `accepted`。

CI 与并行发布配置已通过本地 Actions 静态检查，发布脚本测试和 Headless Shell 浏览器测试通过。Tauri `--no-bundle` 命令在本地 stable 工具链下完成 Release 编译并跳过安装包与签名。Rust 1.91.1 的 CI 执行、默认分支缓存保存、标签缓存恢复、检查失败时跳过草稿及实际耗时需要 GitHub 托管环境验证。Change 011 保持 `accepted`。
