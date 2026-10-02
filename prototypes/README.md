# 界面原型

[key-relay.html](key-relay.html) 是独立 HTML 界面原型，可在浏览器中打开。页面演示编辑、设置、倒计时、进度及中止；演示输入写入页面内测试框。

桌面应用位于 `src/` 和 `src-tauri/`，采用原型的布局、配色与交互基准。实际 Windows 输入由 Rust 通过 SendInput 提交，原型用于界面评审。

## 图标设计

应用采用 B「分离结构」的浅底蓝字版本，各尺寸分别设置笔画参数。[查看 Windows 图标预览](icons/k-study/k-b-windows.png)、[小尺寸优化对比](icons/k-study/k-b-pixel-comparison.png)及[任务栏实图](icons/k-study/k-b-taskbar.png)。[K 字形设计](icons/k-study/README.md)保留三种字形与配色比较，设计文件位于 `prototypes/icons/k-study/`。

## 原型回归

先用 Playwright CLI 打开原型页面，再执行：

```bash
playwright-cli -s=<session> run-code --filename=prototypes/tests/interaction-check.js
```

脚本检查编辑、撤销、页签、设置校验和任务展示。应用的组件与浏览器回归分别使用 `npm test` 和 `npm run test:e2e`，相关命令见 [README](../README.md)。
