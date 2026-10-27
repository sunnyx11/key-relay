# Project 架构

## 系统组成

已确认的工程采用单前端应用和单 Rust crate，目录职责如下；实现验证状态见项目上下文。

- `src/components/`：自定义标题栏、输入、历史、设置和关于面板、文本保存选项及任务操作区。
- `src/useRelay.ts`：编辑同步、命令调用及状态订阅。
- `src/useUpdates.ts`、`src/components/UpdatePanel.tsx`：自动检查计时、更新状态及下载和安装确认。
- `src-tauri/src/updates.rs`：更新偏好、安装版识别、签名下载与安装请求。
- `src/bridge.ts`：Tauri 通信契约。
- `src/styles/`：视觉变量、公共控件和布局。
- `src-tauri/src/task.rs`：任务状态、快照、计时和取消。
- `src-tauri/src/text.rs`：文本转换与计数。
- `src-tauri/src/settings.rs`：参数校验和输入设置保存。
- `src-tauri/src/window_state.rs`：普通窗口几何保存、显示器工作区校验、启动恢复和主屏位置重置。
- `src-tauri/src/archive.rs`：本机文本文件、草稿防抖保存、任务原文归档、历史管理及有序状态通知。
- `src-tauri/src/shortcut.rs`：全局快捷键注册。
- `src-tauri/src/windows/`：输入事件、系统监听、物理坐标与目标窗口校验。
- `src-tauri/src/commands.rs`、`lib.rs`：命令入口、应用装配、通知区域菜单、窗口显隐与退出清理。
- `tests/e2e/`、`src-tauri/tests/`：界面与原生集成检查。
- `tests/manual/`：Windows 和 RDP 人工验收步骤。
- `.github/workflows/release.yml`：版本标签触发的并行检查与 Windows 构建，全部成功后执行 Release 草稿任务。
- `scripts/release.mjs`：版本和更新说明校验、构建附件准备及 SHA-256 计算。
- `scripts/publish-release.mjs`：草稿创建、更新与附件上传，使用 Actions 提供的 GitHub 客户端。
- `CHANGELOG.md`、`docs/release.md`：使用者变更记录与维护者发布说明。

- `docs/project/`：项目背景、原则、架构与术语。
- `docs/domains/text-input/`：文本自动输入领域的需求、设计及确认状态。
- `prototypes/`：独立界面原型、演示说明和浏览器检查脚本。
- `.agents/skills/spec-coding/`：Spec 模板、索引生成及结构检查工具。
- `.agents/skills/git-release/`：Git 提交与发布操作规则。

### 已确认的应用组成

技术选型见[项目上下文](context.md#技术环境与依赖)。应用由 React 界面、Tauri 桌面容器及 Rust 原生逻辑组成。

- React 管理编辑内容和界面展示，通过 Tauri 调用 Rust。
- Rust 管理文本持久化、任务状态、计时和 Windows 输入操作。
- Tauri 提供窗口、通信及打包能力。
- 首版采用 React 自带状态管理，省去额外状态库和数据库依赖。

## 领域关系

当前识别一个领域：`text-input`，负责文本自动输入的业务规则。需求文档见[领域概览](../domains/text-input/overview.md)。

## 整体数据流

应用的数据处理顺序如下：

1. 原生启动入口先检查单实例。重复启动唤起已有窗口并退出；首个实例从用户主目录 `.key-relay` 初始化数据，缺少文件时采用默认值。主窗口隐藏创建，在首次显示前按当前显示器工作区恢复普通窗口大小和位置。
2. React 订阅任务及文本状态，读取设置与本机草稿后恢复编辑内容；读取失败时保留文件并提供重试。
3. React 将编辑草稿、设置及按钮操作串行提交给 Rust。专用存储线程保存最新草稿；全局快捷键事件在 Rust 侧处理。
4. Rust 记录空闲时的外部点击，维护任务状态。两种入口共用准备阶段，等待启动操作释放后校验并激活记录窗口，再回点。
5. 满足启动条件后，Rust 将冻结原文提交给历史保存队列，并通过 Windows `SendInput` 按顺序提交输入事件。
6. Rust 接收系统级键鼠事件，依据 INPUT-REQ-004 判断中止，通知 React 展示任务与保存结果。
7. 历史正文用于只读全文查看，独立恢复按钮替换当前编辑内容并同步草稿。关闭窗口隐藏主窗口，通知区域提供打开窗口、重置位置及退出应用。退出和安装前等待保存，外部目标记录仅保留在进程内存。

输入任务以 Rust 状态为依据。具体接口及状态模型见[领域设计](../domains/text-input/design.md#数据与接口)。

## 集成与公共基础设施

集成包括 Tauri 单实例、全局快捷键、Opener、Updater 插件，以及通过 `windows` crate 访问的 Windows 原生接口。单实例插件先于其他插件初始化，负责重复启动通知及已有主窗口还原和聚焦。`winreg` 只读当前用户的 NSIS 安装记录。Opener 负责关于页外部链接的系统默认应用调用，Updater 在 Rust 内请求 HTTPS 清单并验证安装包签名。具体职责见[领域设计](../domains/text-input/design.md)。

## 部署结构

已选应用形态为本地 Windows 桌面应用。React 构建产物由 WebView2 加载。NSIS 安装程序面向当前用户，缺少 WebView2 时联网安装。远程服务器通过 RDP 接收键盘事件，软件安装在本地。

## 鉴权与信任边界

日常开发在本地执行相关检查并构建人工测试程序。版本标签触发前端检查、Rust 检查和签名安装包构建。标签任务恢复可用的 Rust 依赖编译缓存，缓存缺失时重新编译。

发布配置将只读检查和构建任务与具有 `contents: write` 权限的草稿任务分开。草稿任务等待全部检查和构建成功。附件通过 Actions 产物传递，发布前再次验证 SHA-256。缓存规则、重试规则和验证范围见[版本发布](../release.md)。

关于页外部链接权限限定于主窗口及设计文档列出的五个固定地址。版本取自应用元数据，完整 MIT 许可证随前端打包供离线读取。

更新端点在 Rust 内固定，公钥由 `TAURI_UPDATER_PUBLIC_KEY` 构建变量嵌入。前端仅访问检查、偏好、下载和确认安装命令，安装包字节保存在 Rust 进程内。更新请求省略编辑文本。安装准备由任务线程串行执行，等待最新草稿和设置保存、确认任务空闲后阻止两种启动入口，释放系统钩子和快捷键；安装启动失败时恢复资源后开放任务入口。

草稿、历史及其保存选项以明文保存在 `%USERPROFILE%\.key-relay\text.json`。历史记录持久化置顶字段，旧记录默认未置顶；归档顺序与前端置顶显示排序分别处理。历史容量与保存选项共同持久化，默认值及可配置范围见 INPUT-REQ-007；达到上限时仅淘汰未置顶记录，全置顶时跳过新增历史，发送线程继续工作。输入设置、更新偏好和窗口状态分别使用同目录的 `settings.json`、`updates.json`、`window-state.json`。新目录缺少文件时使用默认值和空数据，原应用配置目录的文件保留原处。测试通过 `KEY_RELAY_TEST_CONFIG_DIR` 使用隔离目录。文本保存使用独立线程、实例独占文件锁和 Windows 原子文件替换，读取失败保留文件，保存错误提供重试。通知区域的“退出应用”发起正常退出，由前端等待编辑同步队列，再由原生任务线程等待保存并释放资源。保存失败显示主窗口与错误，保留进程供重试。正常退出和安装器接管前保存普通窗口还原几何，窗口状态错误记录诊断并继续执行。日志与错误提示省略原文，实际键入内容仅用于必要的快捷键和中止判断。

模拟输入受 Windows 进程完整性级别限制。工具默认普通权限，本地 RDP 客户端以高权限运行时需要匹配权限。远程目标程序的权限由远程会话处理，具体约束见[领域设计](../domains/text-input/design.md#兼容与部署)。
