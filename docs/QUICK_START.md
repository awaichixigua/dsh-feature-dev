# Quick Start

本指南用于在 DSH 中安装并使用 `dsh-feature-dev`。它是一个面向业务项目的工作流插件，不是业务项目本身。

## 前置条件

- Node.js 22 或更高版本。
- 已安装并可运行 DeepSeek Harness。
- 一个业务 Git 仓库。MRD 工作流启动时须提供符合 `{版本号}_{需求编号}_{中文需求标题}` 格式的正式需求目录名，例如 `req/2.0.0_103111_fastjson替换为jackson`。

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
/mrd-to-code https://example.com/share_doc/?token=xxx --feature-dir req/2.0.0_103111_fastjson替换为jackson
```

它依次完成：MRD 读取与澄清、服务路由、PRD、技术方案、TDD 实现和归档。服务路由后会先展示 `apps.json`，确认服务范围正确后才会准备服务需求分支；工作流也会在 PRD、技术方案和测试规格等需要决策的位置暂停。阅读提示后选择操作，例如：

```text
/confirm --project-root . --feature-dir req/create-order --gate pre_prd --choice accept
```

确认成功后，会话会自动调用恢复操作继续工作流；不需要用户再单独输入 `/resume`。

不要跳过确认，也不要反复轮询。运行被中断或阻塞时，先解决提示中的原因，再显式恢复。

MRD URL 的抓取、解析和服务路由会先在 `.tmp/<featureDir 的目录名>` 暂存；这是 runtime 管理的内部目录，不是可省略 `--feature-dir` 的理由。因为 `featureDir` 已提供，暂存目录不再使用 MRD URL hash。若服务范围无法自动识别，主会话会收集 `primary`、`collaborators`、`readOnly` 和可写服务仓库路径，写入暂存目录的 `apps.json` 后继续运行，不会重新启动 app-router。

## 分步使用

如果希望分阶段控制，可依次使用：

```text
/implementation-plan <MRD URL> --feature-dir req/2.0.0_103111_fastjson替换为jackson
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
