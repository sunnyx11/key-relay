# Changelog

本文件记录面向使用者的变更，采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 分类及语义化版本。

## [Unreleased]

## [0.2.2] - 2026-10-04

### Changed

- Release 标题使用版本标签，安装包及签名附件统一使用 `key-relay` 前缀。

### Fixed

- 精简关于页更新区域，利用底部空间显示信息，保持页签切换等高及窄窗口换行。

## [0.2.1] - 2026-10-04

### Added

- 提供自动检查及手动检查更新，发现新版本后由使用者确认下载；0.1.0 需手动安装一次新版。
- 安装版支持签名验证、安装并重启；安装前提示编辑文本将清除，保留有效设置。
- 独立 EXE 提供正式版本下载入口，支持手动替换。
- Release 附件提供更新签名和版本清单。

## [0.1.0] - 2026-10-03

### Added

- 提供 Windows 文本自动输入，支持按钮倒计时和全局快捷键启动。
- 保留 Unicode 与空白字符，支持 Enter、Tab 和键鼠操作中止。
- 提供输入参数保存、可撤销清空、任务进度和窗口置顶。
- 提供关于页、项目支持链接、联系邮箱和离线 MIT 许可证。
- 提供直角控件、蓝色主按钮及聚焦前后边界一致的输入控件。
- 提供当前用户安装包，缺少 WebView2 时联网安装运行时。
- 提供 Windows x64 独立 EXE，使用系统 WebView2。

Windows 100% 系统缩放下的界面显示与 RDP 实际兼容性待人工验证。

[Unreleased]: https://github.com/sunnyx11/key-relay/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/sunnyx11/key-relay/releases/tag/v0.2.2
[0.2.1]: https://github.com/sunnyx11/key-relay/releases/tag/v0.2.1
[0.1.0]: https://github.com/sunnyx11/key-relay/releases/tag/v0.1.0
