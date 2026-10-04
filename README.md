# Key Relay

Key Relay 在本地 Windows 将准备好的文本作为键盘事件发送到当前输入位置。主要用于允许键盘输入、限制剪贴板粘贴的 RDP 会话。软件安装在本地，远程服务器通过现有 RDP 客户端接收输入。

**RDP 实际兼容性待人工验证。** 本地发送成功表示 Windows 接受了事件，远程目标收到的内容需要检查。

## 安装与使用

运行 Release 中的 `Key Relay_<版本>_x64-setup.exe`，按当前用户安装。支持目标为 Windows 10／11 x64，使用 WebView2；安装程序在缺少运行时时联网下载安装。

1. 在“输入”页填写或粘贴文本。
2. 选择一种启动方式：
   - 点击“开始输入”，在倒计时期间切换到 RDP 中的目标输入位置。
   - 先选择目标输入位置，再按 `Ctrl + Alt + F8`，全部松开后开始。
3. 输入期间可以移动鼠标或滚动。按下任意实际键盘按键或鼠标按钮中止任务。
4. 检查目标文本。再次独立启动会从原文开头发送。

倒计时期间按 Esc、开始快捷键或“取消输入”结束准备。倒计时结束时存在按住的按键或鼠标按钮会取消任务。Key Relay 自身处于前台时禁止开始发送。

Enter 与 Tab 使用对应按键语义，可能提交命令、提交表单或切换控件。中止保留中止操作原本的系统效果；已经提交的事件可能继续由 RDP 处理。

标题栏图钉可开启或取消置顶，蓝色背景表示已开启。最小化恢复后保留置顶，重新打开软件后恢复普通窗口。置顶时仍需选择目标输入位置。活动任务期间图钉禁用；输入中点击图钉只中止任务，再次独立点击才切换置顶。

## 关于与支持

“关于”页显示应用版本、项目主页、使用说明和问题反馈入口。联系邮箱为 [hkhl888@foxmail.com](mailto:hkhl888@foxmail.com)，点击后调用默认邮件应用。MIT 许可证可在页内离线查看。

输入、设置、关于及许可证视图保持相同窗口高度，较长内容在关于面板内滚动。左右方向键、Home 和 End 可切换可用页签。活动任务期间关于页签禁用，从关于页启动任务时切回输入页显示状态。

## 应用更新

0.2.1 起提供更新检查。0.1.0 需要先手动安装带更新功能的版本。

- 默认在启动完成 10 秒后检查，此后每 24 小时检查一次。“关于”页可手动检查或关闭自动检查。
- 检查仅获取版本和说明。安装版点击“下载更新”后下载并验证签名，再选择“安装并重启”并确认文本清除提示。
- 安装前保存有效设置，并等待输入任务结束。重启会清除编辑文本，需要保留的内容应先自行保存。
- 独立 EXE 通过“前往下载”获取新版，退出软件后替换文件。
- 更新偏好保存在用户配置目录的 `updates.json`，示例为 `{"autoCheck":true}`。更新请求仅访问发布服务，省略编辑文本。

正式更新需要发布签名密钥和公开的版本清单。开发构建未配置公钥时显示配置提示。签名升级、安装失败恢复及 GitHub 正式通道的完整验收状态见[版本发布](docs/release.md)。

## 设置与数据

| 设置 | 默认值 | 范围 |
| --- | --- | --- |
| 等待时间 | 5 秒 | 1～60 秒整数 |
| 字符间隔 | 50 毫秒 | 10～1,000 毫秒整数 |
| 全局快捷键 | Ctrl + Alt + F8 | F8、F9、F10 三种组合 |

- 有效设置自动保存。快捷键注册失败时在设置页显示错误，按钮启动仍可使用。
- 设置文件：`%APPDATA%\io.github.key-relay.desktop\settings.json`。内容只包含以上三个字段。
- 待输入文本仅保存在进程内存，退出后清除。软件保持系统剪贴板原有内容，日志省略输入原文。
- 清空文本保留浏览器编辑历史，支持 `Ctrl+Z` 撤销和 `Ctrl+Y` 重做。
- 字符数量按 Unicode 标量计算，CRLF 计为一个换行。表情、组合字符与目标输入法的行为按实际接收情况验证。

配置示例：

```json
{"delaySeconds":5,"intervalMs":50,"shortcut":"F8"}
```

## 开发与构建

需要 Windows x64、Node.js 24、Rust 1.91.1 或更高版本、Visual Studio C++ 生成工具、Windows SDK 和 WebView2。npm 与 Cargo 锁文件固定依赖版本。

```bash
npm ci
npm run desktop
```

`npm run dev` 启动界面开发服务器；实际系统输入和 Tauri 通信使用 `npm run desktop`。

```bash
npm run build
npm run tauri -- build --no-bundle
```

安装包位于 `src-tauri/target/release/bundle/nsis/`，可执行程序位于 `src-tauri/target/release/key-relay.exe`。生成带更新签名的安装包需要按[版本发布](docs/release.md#更新签名配置)配置密钥后执行 `npm run package`。

## 自动打包与发布

推送版本标签后，GitHub Actions 检查版本与更新说明，运行测试并构建 Windows x64 安装包。发布任务创建 Release 草稿，附带安装包、独立 EXE、更新签名、版本清单和 SHA-256 校验文件，由维护者检查后公开。

更新说明维护在 [CHANGELOG.md](CHANGELOG.md)，发布前应为目标版本建立带日期的条目。操作步骤、附件说明和首次 GitHub 运行的验证范围见[版本发布](docs/release.md)。

## 验证入口

普通自动测试使用模拟时钟、输入编码和通信替身，保持实际桌面输入环境。浏览器测试首次运行前安装 Chromium。

```bash
npx playwright install chromium
npm test
npm run test:release
npm run test:rust
npm run lint
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run specs
```

以下入口显式操作 Windows 桌面，适合解锁状态下单独运行。执行前松开全部按键和鼠标按钮。

```bash
npm run test:native-input
npm run tauri -- build --no-bundle
npm run test:desktop
```

- `test:native-input` 创建专用接收窗口，测试中文、英文、Enter、Tab、表情、工具事件标记、外部输入中止及钩子卸载。发送前确认专用窗口持有前台。
- `test:desktop` 启动构建后的应用，用 WebView2 调试端口 `9229` 检查真实界面、Rust 通信、窗口高度、关于页元数据与离线许可证、外部链接权限、置顶切换、最小化恢复、重新打开后的普通层级和退出。测试结束关闭该应用。
- 浏览器回归覆盖 320／390px、520／420px 断点、560px 内容盒断点、三页签及许可证等高、184／320px 编辑框高度、状态排版、清空撤销、无效设置、关于页链接、键盘导航及同次中止点击保护。

安装／卸载、缺少 WebView2、物理设备和系统环境验收见 [Windows 验收](tests/manual/windows.md)。远程接收及 mstsc 快捷键转发见 [RDP 验收](tests/manual/rdp.md)。

## 项目资料

- [规范索引](docs/index.md)
- [需求](docs/domains/text-input/requirements.md)与[设计](docs/domains/text-input/design.md)
- [界面原型](prototypes/README.md)
- [许可证](LICENSE)
