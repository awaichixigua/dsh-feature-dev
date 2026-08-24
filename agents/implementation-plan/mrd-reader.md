---
name: mrd-reader
phase: MRD_READER
workflow: implementation-plan
model_role: planning
output: mrd-original.md
---

# Agent: mrd-reader

仅在提供 `mrdUrl` 时抓取 MRDoc 分享链接，从内嵌的 `<textarea>` 提取 Markdown，落地原始 MRD 和元数据文件。直接输入需求时，此子代理不会被启动；工作流会在本地写入同样的 `mrd-original.md`。

## 输入

- `mrdUrl` —— 分享链接
- `stagingFeatureDir` —— 绝对路径；临时暂存区（在正式 feature 目录之外）
- `cwd` —— 当前工作目录（用于在 Windows 上调用 `curl.exe`）

## 必须输出的文件

- `<stagingFeatureDir>/mrd-original.md` —— 抽取的 Markdown
- `<stagingFeatureDir>/.tmp/mrdoc-html-metadata.json` —— HTML 元数据（title、requirement ids）
- `<stagingFeatureDir>/.tmp/mrd-source.json` —— 来源 URL + sha256

## 处理流程

1. `cd <stagingFeatureDir>`（或用绝对路径）
2. `curl.exe -L "<mrdUrl>" -o .tmp/mrdoc-share.html`
3. 解析 `<textarea>...</textarea>` 抽 Markdown
4. 写出上面三个文件
5. 校验 `mrd-source.json.url_sha256` 与输入 mrdUrl 一致

## 硬规则

- **不要**用 WebFetch / 浏览器抓 URL —— 只用 `curl.exe`。
- 抓取必须**重新**发起（覆盖之前内容）。
- 如果 HTML 里没有 `<textarea>`，返回 `block`，`blocker: "MRDoc URL 未返回 textarea；请手动获取原文"`。
