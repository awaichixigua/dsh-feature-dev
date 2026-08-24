# 更新日志

本文件记录项目的所有重要变更。

## [0.1.2] - 2026-08-24

### 新增

- `mrd-to-code` 支持通过 `rawUserRequest` 直接输入需求，不再强制要求 MRDoc URL。
- 直接输入需求时，完整流程复用 `implementation-plan` 的本地来源落盘、服务路由、澄清、代码生成与归档能力。

## [0.1.1] - 2026-08-24

### 新增

- `implementation-plan` 支持通过 `rawUserRequest` 直接输入需求，不再强制要求 MRDoc URL。
- 直接输入的需求会保存为带来源校验和的 `mrd-original.md`，再进入既有的服务路由、澄清、PRD 与技术方案流程。
- 新增直接输入需求的命令示例和自动化测试覆盖。

## [0.1.0]

### 新增

- DSH 特性开发工作流 Bundle 首次发布。
