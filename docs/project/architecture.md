# Project 架构

## 系统组成

已确认的工程采用单前端应用和单 Rust crate，目录职责如下；实现验证状态见项目上下文。

- `src/components/`：自定义标题栏、输入面板、设置面板、关于面板和任务操作区。
- `src/useRelay.ts`：编辑同步、命令调用及状态订阅。
- `src/bridge.ts`：Tauri 通信契约。
- `src/styles/`：视觉变量、公共控件和布局。
- `src-tauri/src/task.rs`：任务状态、快照、计时和取消。
- `src-tauri/src/text.rs`：文本转换与计数。
- `src-tauri/src/settings.rs`：参数校验和配置保存。
- `src-tauri/src/shortcut.rs`：全局快捷键注册。
- `src-tauri/src/windows/`：输入事件与系统监听。
- `src-tauri/src/commands.rs`、`lib.rs`：命令入口、应用装配与退出清理。
- `tests/e2e/`、`src-tauri/tests/`：界面与原生集成检查。
- `tests/manual/`：Windows 和 RDP 人工验收步骤。
- `.github/workflows/release.yml`：版本标签触发的 Windows 构建与 Release 草稿任务。
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
- Rust 管理任务状态、计时和 Windows 输入操作。
- Tauri 提供窗口、通信及打包能力。
- 首版采用 React 自带状态管理，省去额外状态库和数据库依赖。

## 领域关系

当前识别一个领域：`text-input`，负责文本自动输入的业务规则。需求文档见[领域概览](../domains/text-input/overview.md)。

## 整体数据流

应用的数据处理顺序如下：

1. React 将准备好的文本、设置及按钮操作提交给 Rust；全局快捷键事件在 Rust 侧处理。
2. Rust 维护任务状态，负责倒计时和输入发送的计时。
3. 满足启动条件后，Rust 通过 Windows `SendInput` 按顺序提交输入事件。
4. Rust 接收系统级键鼠事件，依据 INPUT-REQ-004 判断中止。
5. Rust 通知 React 展示倒计时、输入中、完成、中止及错误状态。

输入任务以 Rust 状态为依据。具体接口及状态模型见[领域设计](../domains/text-input/design.md#数据与接口)。

## 集成与公共基础设施

集成包括 Tauri 全局快捷键插件、Opener 插件及通过 `windows` crate 访问的 Windows 原生接口。Opener 负责关于页外部链接的系统默认应用调用，具体职责见[领域设计](../domains/text-input/design.md)。

## 部署结构

已选应用形态为本地 Windows 桌面应用。React 构建产物由 WebView2 加载。NSIS 安装程序面向当前用户，缺少 WebView2 时联网安装。远程服务器通过 RDP 接收键盘事件，软件安装在本地。

## 鉴权与信任边界

发布配置将只读构建任务与具有 `contents: write` 权限的草稿任务分开。附件通过 Actions 产物传递，发布前再次验证 SHA-256。配置、重试规则和验证范围见[版本发布](../release.md)。

关于页外部链接权限限定于主窗口及设计文档列出的四个固定地址。版本取自应用元数据，完整 MIT 许可证随前端打包供离线读取。

模拟输入受 Windows 进程完整性级别限制。工具默认普通权限，本地 RDP 客户端以高权限运行时需要匹配权限。远程目标程序的权限由远程会话处理，具体约束见[领域设计](../domains/text-input/design.md#兼容与部署)。
