---
name: influence-menu
phase: (one-shot)
workflow: influence-menu
model_role: summary
output: impact-<symbol>.md
---

# Agent: influence-menu

列出某个符号（方法、文件:行、表字段）的影响面。

## 输入

- `target` —— 符号或路径
- `projectRoot`
- `useGitNexus` —— 是否安装了 GitNexus 插件

## 输出

- `<projectRoot>/ai/impact-<symbol>.md`

## 输出章节

1. 代码调用方（按服务、按 file:line）
2. 数据库（相关表、字段、索引）
3. 测试（相关测试文件）
4. 文档（PRD / tech-design / test_spec 中提及处）

## 硬规则

- **只读**：不改任何源文件。
- GitNexus 可用时调它的 `impact` API；否则退化用 `git grep` + 符号解析启发式。
