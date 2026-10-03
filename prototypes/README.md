# 界面原型

[key-relay.html](key-relay.html) 是独立 HTML 界面原型，可离线在浏览器中打开。页面采用桌面应用的标题栏、紧凑布局、配色和字体，包含输入、设置、关于三个页签及离线 MIT 许可证。

桌面应用位于 `src/` 和 `src-tauri/`。原型的视觉与交互依据为[领域设计](../docs/domains/text-input/design.md#界面视觉基准)。

## 演示范围

- 展开“原型演示”，准备文本后点击“开始输入”，在倒计时结束前选择测试输入框。也可选中测试输入框后按当前快捷键启动。
- 文本只写入页面内测试框，Enter、Tab 按文本展示。快捷键在当前页面生效，鼠标移动继续输入，按键或鼠标按下中止。
- 图钉演示选中状态和任务期间的禁用保护。最小化折叠内容，最大化扩展页面内窗口宽度，标题双击切换宽度。最小化保留置顶状态。
- 关闭结束演示任务并清除准备文本，上方“重新打开”恢复窗口，置顶回到普通状态。设置与测试框结果保留到页面刷新。
- 关于页展示静态版本示例、内嵌 K 图标、固定项目链接和联系邮箱。项目链接在新标签页打开，邮箱交给浏览器配置的默认邮件应用。
- MIT 全文内嵌在 HTML 中，支持内部滚动、返回与焦点恢复。三个页签及许可证视图保持等高。
- 关于页演示自动检查开关、手动检查、下载进度和安装确认。展开“原型演示”后可切换安装版、独立 EXE、无更新、检查失败、签名失败和安装启动失败场景。示例数据在本页处理，确认安装模拟重启并清除编辑文本。

Windows 系统置顶、拖动、真实输入、元数据读取、系统链接调用及相应错误提示由桌面应用验证。原型的窗口操作只影响页面展示，有效设置仅在当前页面中保留。

内嵌版本、图标和许可证分别对应 `src-tauri/tauri.conf.json`、`src-tauri/icons/icon.svg` 和 `LICENSE`，原型回归入口核对其一致性。

## 图标设计

应用采用 B「分离结构」的浅底蓝字版本，各尺寸分别设置笔画参数。[查看 Windows 图标预览](icons/k-study/k-b-windows.png)、[小尺寸优化对比](icons/k-study/k-b-pixel-comparison.png)及[任务栏实图](icons/k-study/k-b-taskbar.png)。[K 字形设计](icons/k-study/README.md)保留三种字形与配色比较，设计文件位于 `prototypes/icons/k-study/`。

## 原型回归

在仓库根目录安装开发依赖与 Playwright Chromium 后运行：

```bash
npm ci
npx playwright install chromium
node prototypes/tests/run.mjs
```

入口通过本地文件地址打开原型，核对应用资源并运行 22 项浏览器检查。结果以 JSON 输出，失败时返回非零退出码。截图保存到 `test-results/prototype/`，覆盖三个页签、许可证、窄窗口和 150% 缩放。

已有 Playwright CLI 会话可执行同一交互脚本：

```bash
playwright-cli -s=<session> run-code --filename=prototypes/tests/interaction-check.js
```

检查覆盖标题栏、窗口展示状态、置顶与关于页的中止点击保护、三页签导航、离线许可证、编辑与撤销、设置校验、任务展示、窄窗口、缩放及页签等高。应用的组件与浏览器回归分别使用 `npm test` 和 `npm run test:e2e`，相关命令见 [README](../README.md)。
