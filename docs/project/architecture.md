# Project 架构

## 系统组成

当前仓库包含文档、项目内 Skill 和 HTML 界面原型，尚无桌面应用运行组件。

- `docs/project/`：项目背景、原则、架构与术语。
- `docs/domains/text-input/`：文本自动输入领域的需求、设计及确认状态。
- `prototypes/`：独立界面原型、演示说明和浏览器检查脚本。
- `.agents/skills/spec-coding/`：Spec 模板、索引生成及结构检查工具。
- `.agents/skills/git-release/`：Git 提交与发布操作规则。

### 已确认的应用组成

技术选型见[项目上下文](context.md#技术环境与依赖)。应用方案由 React 界面、Tauri 桌面容器及 Rust 原生逻辑组成，尚无对应运行组件。

- React 管理编辑内容和界面展示，通过 Tauri 调用 Rust。
- Rust 管理任务状态、计时和 Windows 输入操作。
- Tauri 提供窗口、通信及打包能力。
- 首版采用 React 自带状态管理，省去额外状态库和数据库依赖。

## 领域关系

当前识别一个领域：`text-input`，负责文本自动输入的业务规则。需求文档见[领域概览](../domains/text-input/overview.md)。

## 整体数据流

以下为已确认的应用职责与目标数据流，尚待 Windows 桌面实现验证：

1. React 将准备好的文本、设置及按钮操作提交给 Rust；全局快捷键事件在 Rust 侧处理。
2. Rust 维护任务状态，负责倒计时和输入发送的计时。
3. 满足启动条件后，Rust 通过 Windows `SendInput` 按顺序提交输入事件。
4. Rust 接收系统级键鼠事件，依据 INPUT-REQ-004 判断中止。
5. Rust 通知 React 展示倒计时、输入中、完成、中止及错误状态。

输入任务以 Rust 状态为依据。具体接口及状态模型见[领域设计](../domains/text-input/design.md#数据与接口)。

## 集成与公共基础设施

已选集成包括 Tauri 全局快捷键插件及通过 `windows` crate 访问的 Windows 原生接口，具体职责见[领域设计](../domains/text-input/design.md)。

## 部署结构

已选应用形态为 Windows 本地桌面应用。React 构建产物由 Tauri 应用加载，界面使用 WebView2。安装包格式及 WebView2 分发方式尚未确定。

## 鉴权与信任边界

模拟输入受 Windows 进程完整性级别限制。权限策略和高权限目标程序的兼容范围需要单独确定，具体约束见[领域设计](../domains/text-input/design.md#兼容与部署)。
