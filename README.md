# Key Relay

Key Relay 是 Windows 文本自动输入工具，可将准备好的文本作为键盘输入发送到目标窗口，适用于允许键盘输入、限制剪贴板粘贴的 RDP 会话。软件运行在本地，通过现有 RDP 客户端向远程窗口输入。

## 使用方法

支持 Windows 10／11 x64。从 [Releases](https://github.com/sunnyx11/key-relay/releases/latest) 下载并运行安装包，也可使用免安装的 `key-relay.exe`。程序依赖 WebView2，安装包会在缺少运行时时联网安装。

1. 在“输入”页填写或粘贴文本。
2. 点击“开始输入”，在倒计时期间选择目标输入位置。默认等待 5 秒，期间可点击“取消输入”。
3. 输入期间按 `Esc` 或点击鼠标可中止。鼠标移动和普通按键保持输入继续。

也可先选择目标输入位置，再按下并松开 `Ctrl + Alt + F8` 启动。设置页可调整等待时间、字符间隔和启动快捷键，默认字符间隔为 50 毫秒。

- **清理**：删除每行末尾的普通空格和制表符，保留缩进、行内空格及空行。
- **撤销与重做**：清理支持 `Ctrl+Z` 逐行撤销、`Ctrl+Y` 逐行重做；清空支持整体撤销和重做。
- **文本保留**：任务结束后保留文本，退出程序后清除。

换行和制表符分别按 `Enter`、`Tab` 发送，可能提交内容或切换控件，具体效果由目标程序决定。

## 开发

需要 Windows x64、Node.js 24、Rust 1.91.1 或更高版本、Visual Studio C++ 生成工具、Windows SDK 和 WebView2。

```bash
npm ci
npm run desktop
```

仅调试前端界面时可使用 `npm run dev`。

## 打包

构建独立 EXE：

```bash
npm run tauri -- build --no-bundle
```

生成文件位于 `src-tauri/target/release/key-relay.exe`。

生成安装包前，按[更新签名配置](docs/release.md#更新签名配置)准备签名环境变量，然后执行：

```bash
npm run package
```

安装包及更新签名位于 `src-tauri/target/release/bundle/nsis/`。
