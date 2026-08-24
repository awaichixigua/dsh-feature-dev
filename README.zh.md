# dsh-feature-dev

> 面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (Developer Preview) 的原生 MRD-to-code 工作流 Bundle。

`dsh-feature-dev` 把完整的 MRD → PRD → 技术方案 → 代码 → 归档 流程带入 DeepSeek Harness,作为 Cordis Bundle 提供。它是一个**独立**的 npm 包。

| | |
|---|---|
| 项目 | `D:\ai\dsh-feature-dev` |
| 参考项目(只读) | `D:\ai\feature-dev` |
| 运行时 | DeepSeek Harness Developer Preview |
| Node | ≥ 22 |
| 协议 | (TBD) |

## 快速开始

```powershell
# 开发态安装
dsh plugin --profile web add D:\ai\dsh-feature-dev

# npm 安装(发布后)
dsh plugin --profile web add @engios/dsh-feature-dev

# 验证
dsh --profile web --dump-config
```

在对话中输入 `/` 即可发现 skill:

```
/mrd-to-code
/knowledge-base
/implementation-plan
/code-gen-tdd
/bugfix
/archive
/influence-menu
```

## 内置能力

- 4 个 DSH 工具:`feature_dev_run`、`feature_dev_resume`、`feature_dev_status`、`feature_dev_confirm`
- 10 个 skill(上面 9 个 + 端到端入口 `mrd-to-code`)
- 4 套完整工作流:`implementation-plan`、`code-gen-tdd`、`bugfix`、`archive`
- 3 个固定状态机(每个多阶段工作流对应一个)
- 持久化 JSON 状态,带原子写 + 审计日志 + Markdown 投影
- 16 个子 agent 提示词(在 `agents/`)
- 5 个产品模板(在 `templates/`)
- 3 份 JSON Schema(在 `schemas/`)
- 8 个单元测试、2 个契约测试、2 个集成测试

## 首期不在范围内

- 独立 Web UI。
- 与旧版 `/feature-dev:xxx` Claude 命令格式兼容。
- 与 Claude 版本的正文逐字一致。
- 可选插件集成(GitNexus、Beads、外部文档同步)—— 按阶段接入。

完整的非目标列表见 `docs/TECH_DESIGN.md` §2.3。

## 架构(每层一行)

- **Domain Assets(领域资产)** — Skill 的 SKILL.md、Agent .md、规则、模板、决策树。
- **Workflow Core(工作流核心)** — `src/runtime/` 和 `src/workflows/`。状态机、门禁、产物校验、恢复。
- **DSH Adapter(DSH 适配层)** — `src/skills/provider.ts`、`src/tools/`、`src/executors/`。负责与 DSH 对接。
- **Project Runtime(项目运行时)** — Git、构建、测试、文件。

## 文档

- [TECH_DESIGN.md](docs/TECH_DESIGN.md) — 完整技术方案
- [USER_GUIDE.md](docs/USER_GUIDE.md) — 终端用户命令参考
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) — 如何开发本 bundle
- [COMPATIBILITY.md](docs/COMPATIBILITY.md) — DSH API 兼容性矩阵
- [migration/MIGRATION.md](docs/migration/MIGRATION.md) — 与 Claude 版本差异的迁移说明

## 开发

```powershell
# 类型检查
pnpm typecheck

# 构建
pnpm build

# 跑全部测试
pnpm test

# 仅单元测试
pnpm test:unit

# 仅契约测试
pnpm test:contract

# 仅集成测试
pnpm test:integration

# Claude 占位符的静态扫描
pnpm test:scan

```

## 协议

TBD.
