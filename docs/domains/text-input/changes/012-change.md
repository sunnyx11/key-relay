---
status: completed
created_at: 2026-10-04 11:18:41
completed_at: 2026-10-04 11:21:51
---

# Release 标题与附件命名

关联规范：[版本发布](../../../release.md)、[使用说明](../../../../README.md)

## 变更原因

Release 标题使用版本标签，下载附件统一使用小写 `key-relay` 名称。

## 变更前

- Release 草稿标题为 `Key Relay <标签>`。
- 安装包和签名附件分别为 `Key Relay_<版本>_x64-setup.exe` 和同名 `.sig`。
- 更新清单的安装包 URL 和 SHA-256 文件引用上述附件名。

## 变更后

- 创建和更新草稿时，标题等于完整版本标签，包括 `v` 前缀及可选预发布后缀。
- 发布附件中的安装包和签名分别命名为 `key-relay_<版本>_x64-setup.exe` 和同名 `.sig`。
- 附件准备读取 Tauri 生成的 `Key Relay_<版本>_x64-setup.exe` 及签名，按发布名称复制，保留原始字节。
- `latest.json` 的安装包 URL 和 `SHA256SUMS.txt` 使用发布附件名。草稿上传前校验名称、签名、版本、说明与校验值一致。
- 应用产品名保持 `Key Relay`，独立程序保持 `key-relay.exe`。版本清单与校验文件分别为 `latest.json`、`SHA256SUMS.txt`。
- 已公开 Release 的附件和清单保持发布时内容；自动任务继续拒绝修改已公开 Release。

示例：输入标签 `v0.2.2`，读取 `Key Relay_0.2.2_x64-setup.exe` 及 `.sig`，输出标题为 `v0.2.2` 的草稿。五个附件为 `key-relay_0.2.2_x64-setup.exe`、`key-relay.exe`、`key-relay_0.2.2_x64-setup.exe.sig`、`latest.json`、`SHA256SUMS.txt`。清单下载地址为 `https://github.com/sunnyx11/key-relay/releases/download/v0.2.2/key-relay_0.2.2_x64-setup.exe`，签名内容与输入一致，校验文件记录四个附件的发布名称和 SHA-256。
