# Quick Start

本指南用于在 DSH 中安装并使用 `dsh-feature-dev`。它是一个面向业务项目的工作流插件，不是业务项目本身。

## 前置条件

- Node.js 22 或更高版本。
- 已安装并可运行 DeepSeek Harness。
- 一个业务 Git 仓库，建议有独立的需求目录，例如 `req/create-order`。

## 安装本地插件

在本仓库根目录执行：

```powershell
pnpm install
pnpm build
dsh plugin --profile web add D:\ai\dsh-feature-dev
dsh --profile web --dump-config
```

最后一条命令应能看到 `dsh-feature-dev`。开发修改后，重新执行 `pnpm build`，再按你的 DSH 插件管理流程刷新或重新安装。

## 首次在业务项目中使用

打开业务项目所在的 DSH 会话后，可选地创建知识库时效标记并建立项目知识：

```text
/knowledge-base --project-root .
```

`/knowledge-base` 建立或刷新 `app-knowledge-base/`，让后续的服务路由和设计阶段有可读上下文。

## 从 MRD 到归档

最短路径是使用端到端编排：

```text
/mrd-to-code https://example.com/share_doc/?token=xxx --feature-dir req/create-order
```

它依次完成：MRD 读取与澄清、服务路由、PRD、技术方案、TDD 实现和归档。工作流在 PRD、技术方案和测试规格等需要决策的位置暂停。阅读提示后选择操作，例如：

```text
/confirm --project-root . --feature-dir req/create-order --gate pre_prd --choice accept
/resume  --project-root . --feature-dir req/create-order
```

不要跳过确认，也不要反复轮询。运行被中断或阻塞时，先解决提示中的原因，再显式恢复。

## 分步使用

如果希望分阶段控制，可依次使用：

```text
/implementation-plan <MRD URL> --feature-dir req/create-order
/code-gen-tdd --feature-dir req/create-order
/archive --feature-dir req/create-order
```

常用辅助命令：

| 目标 | 命令示例 |
| --- | --- |
| 单独澄清 MRD | `/prd-clarify --feature-dir req/create-order --clarify-mode=batch` |
| 变更前查看影响面 | `/influence-menu OrderService.charge` |
| 修复已有需求中的 bug | `/bugfix --feature-dir req/create-order bug描述：支付失败后订单未回滚` |
| 查看运行状态 | `/status --project-root . --feature-dir req/create-order` |

## 运行状态与产物

每次运行的权威状态都保存在：

```text
<feature-dir>/ai/execution-state.json
```

同目录的 `execution-state.md` 用于阅读，审计事件也会被持久化。常见需求产物包括：

```text
<feature-dir>/mrd-original.md
<feature-dir>/prd.md
<feature-dir>/tech-design.md
<feature-dir>/ai/test_spec.md
<feature-dir>/archive-report.md
```

具体产物依赖于所运行的工作流。

## 本仓库开发与验证

修改源码或提示词后，在本仓库根目录运行：

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:package
```

更多设计背景请参阅 [ARCHITECTURE.md](ARCHITECTURE.md)、[TECH_DESIGN.md](TECH_DESIGN.md) 和 [USER_GUIDE.md](USER_GUIDE.md)。
