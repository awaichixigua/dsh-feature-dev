# Development Guide

本指南对应 `dsh-feature-dev` 0.1.4。工作流状态、门禁和子代理输出均由 runtime 约束；改动不能只修改 Skill 文案。

## 项目结构

```text
dsh-feature-dev/
├─ package.json                 包元数据、脚本和发布清单
├─ cordis.patch.yml             Cordis Bundle 默认配置
├─ src/
│  ├─ index.ts                  Bundle 入口与公开导出
│  ├─ config.ts                 默认配置与深度合并
│  ├─ dsh/                      DSH SDK、上下文适配
│  ├─ types/contracts.ts        跨层 TypeScript 合约
│  ├─ tools/                    run / confirm / resume / status
│  ├─ workflows/                工作流、阶段驱动、分支准备
│  ├─ runtime/                  状态机、持久化、路径、门禁、Git
│  ├─ executors/                子代理协议与 DSH 适配
│  └─ metrics/                  可选指标采集和上报
├─ skills/<name>/SKILL.md       8 个可发现 Skill
├─ agents/                      16 个阶段子代理提示词
├─ rules/                       公共、专属和按需规则
├─ templates/                   PRD、测试、归档等模板
├─ schemas/                     Invocation、PhaseResult、State JSON Schema
├─ scripts/                     静态扫描、打包校验、发布、DSH 校验
├─ tests/unit/                  纯逻辑与状态机测试
├─ tests/contract/              Bundle 资源与注册契约测试
└─ tests/integration/           多阶段工作流夹具测试
```

`lib/` 是构建产物，不能作为源码修改目标。`package.json#files` 定义 npm 包要带上的运行资产；修改 agent、Skill、规则或 schema 后要运行打包校验。

## 本地环境

要求 Node.js 22 或更高版本。首次安装与构建：

```powershell
pnpm install
pnpm build
```

将本地 Bundle 加载到 DSH：

```powershell
dsh plugin --profile web add D:\ai\dsh-feature-dev
dsh --profile web --dump-config
```

开发期间修改后重新运行 `pnpm build`，再刷新或重新安装本地插件。`pnpm build` 只编译 `src/` 到 `lib/`；运行资产由发布清单原样携带。

## 验证命令

| 命令 | 覆盖范围 |
| --- | --- |
| `pnpm typecheck` | `src/` 的严格 TypeScript 类型检查。 |
| `pnpm lint` | `src/` 与 `tests/` 的 ESLint 检查。 |
| `pnpm test:unit` | 调用参数、状态机、路径、Git、指标等单元测试。 |
| `pnpm test:contract` | Skill 发现、工具注册、资源和 schema 契约。 |
| `pnpm test:integration` | 带夹具的多阶段工作流测试。 |
| `pnpm test` | 单元测试与契约测试；不包含 integration。 |
| `pnpm test:scan` | 扫描运行资产中的 Claude 专用残留。 |
| `pnpm test:package` | 校验 `package.json#files` 与运行时必需资产。 |
| `pnpm verify:dsh` | 检查已安装 DSH peer dependency 的版本。 |

推荐提交前执行：

```powershell
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:scan
pnpm test:package
pnpm build
```

## 代码与类型约定

- 项目使用 ESM（`"type": "module"`）和 TypeScript 严格模式；`noUncheckedIndexedAccess`、`noImplicitReturns` 等均已开启。
- 相对 import 使用 `.js` 后缀，使构建后 ESM 能正确解析。
- 输入跨越 Tool 边界后必须先经 `normalizeInvocation`；不要在 workflow 或 agent 执行层重新解析命令文本。
- 对外工具返回 `ToolResult<T>`，错误使用 `FeatureDevError` 的稳定错误码。
- 文件路径必须使用 `resolve` 与 `validateFeatureDir` 等路径辅助函数验证；不得依赖未经验证的用户路径。
- 调用 Git 或其他本地可执行文件时使用 `execFileSync` / `spawnSync`，避免拼接 shell 命令，并在 Windows 设置 `windowsHide: true`。
- 不要直接写 `execution-state.json`；通过 `StateRepository` 原子写入并同步事件、Markdown 投影和 current-run 指针。

## 修改调用参数或 Tool 输出

参数变更需要保持以下层一致：

1. 在 `src/types/contracts.ts` 更新 `InvocationOptions`、`FeatureDevInvocation` 或输出类型。
2. 在 `src/runtime/invocation.ts` 处理规范化、布尔值校验、工作流限定和 CLI flag 解析。
3. 在 `src/skills/provider.ts` 的兼容参数解析中同步 flag 行为。
4. 在 `schemas/invocation.schema.json` 更新 wire schema；若参数需要跨恢复保存，也更新 `ExecutionState`、`StateRepository` 和 `schemas/execution-state.schema.json`。
5. 在 `src/tools/register.ts` 与相应 Skill 文档中说明该参数。
6. 增加 invocation、argv 或 Tool 行为测试。

`--auto-comit` 是跨恢复参数的参考实现：它解析为 `options.autoCommit`，持久化为 `state.autoCommitRequested`，只在三个支持的 workflow 成功结束时运行 Git 发布步骤。

## 新增或修改工作流

新增 workflow 时，至少同步下列位置：

1. 在 `WorkflowId`、`KNOWN_WORKFLOWS` 和 invocation schema 中登记 id。
2. 在 `src/runtime/state-machine.ts` 定义初始阶段、合法边和失败/修复分支。
3. 在 `src/workflows/<name>.ts` 实现驱动逻辑，并在 `src/workflows/runner.ts` 路由该 id。
4. 在 `src/workflows/artifacts.ts` 定义需要 runtime 校验的产物。
5. 在 `skills/<name>/SKILL.md` 声明触发语、参数、Tool 输入与确认行为。
6. 添加对应 agent 提示词、规则和模板；如果是 one-shot workflow，确认 `oneShot` 的 agent 映射。
7. 增加 unit、contract 与 integration 测试，并更新 [ARCHITECTURE.md](ARCHITECTURE.md)、[QUICK_START.md](QUICK_START.md) 和更新日志。

修改既有阶段时，不要只改 `PhaseSpec`：同时检查阶段名是否已在状态机、确认门映射、产物校验、阶段提示词的 frontmatter 和测试夹具中使用。

## 新增或修改子代理

提示词解析顺序为 `agents/<workflow>/<agent>.md`，缺失时回退到 `agents/shared/<agent>.md`。每个提示词是带 YAML frontmatter 的 Markdown 文件。

1. 在所属目录创建或修改 agent 提示词，frontmatter 包含 `name`、`phase`、`workflow`、`model_role` 和 `output`。
2. `model_role` 使用 `planning`、`coding`、`review` 或 `summary`；未配置路由时执行器继承 DSH 父会话模型。
3. 正文明确输入、预期产物、约束和输出格式。输出必须是合法 `PhaseResult`：`status`、`summary`、`artifacts`、`evidence`、`changedFiles`，阻塞时带 `blocker`。
4. 在 workflow 阶段表引用 agent 名称，并让 `resolveAgentPromptPath` 决定实际提示词路径；不要硬编码绝对提示词路径。
5. 必需规则放入 `rules/common/`；agent 专属路由放入 `rules/<agent>/index.md`，由 index 指向 `rules/library/` 中的按需专题规则。
6. shared agent 被多个 workflow 使用时，更新 `agents/README.md` 的复用关系表。
7. 对产物路径和结构化结果变化添加测试，并运行 `pnpm test:package`。

## 调试运行

优先读取状态而非猜测当前阶段：

```text
<featureDir>/ai/current-run.json
<featureDir>/ai/runs/<runId>/execution-state.json
<featureDir>/ai/runs/<runId>/run-events.jsonl
```

- `pendingConfirmations` 表示必须先通过 `feature_dev_confirm` 处理的门。
- `pendingMainAction` 表示主会话必须完成的澄清或服务路由文件操作；完成前不能直接继续。
- `phaseHistory` 与 `lastPhaseResult` 可定位最后一个子代理结果和产物校验失败原因。
- `status=blocked` 的恢复会回退最近失败阶段；终态 `completed`、`aborted`、`failed` 不能恢复。
- 对 Git 问题，先检查 `apps.json` 的服务仓库路径、`origin/release`、Git 用户名及工作区状态。

## 配置和兼容性

默认配置位于 `src/config.ts`，Cordis patch 给出相同的启动默认值。优先通过 Bundle 配置覆盖 `strictGates`、子代理总数、修复上限、模型路由或 metrics；不要在 workflow 内硬编码环境差异。

DSH 仍处于 Developer Preview。升级 peer dependency 时运行：

```powershell
pnpm verify:dsh
pnpm test:integration
pnpm build
```

若需要适配 DSH API，将代码限制在 `src/dsh/`、`src/executors/`、`src/skills/provider.ts` 或 `src/tools/register.ts` 等适配层，不要把 SDK 细节扩散到 runtime 状态机。

## 发布

发布前先手动更新 `CHANGELOG.md`，并确保工作区干净、当前分支为 `master`。发布脚本会先构建和校验包，再更新 `package.json` 版本、创建提交和带注释 tag，并推送 `master` 与 tag：

```powershell
pnpm release:patch
pnpm release:minor
pnpm release:major
```

脚本不会更新更新日志；该步骤必须在运行发布脚本前完成。发布失败发生在创建提交前时，脚本会恢复 `package.json`；若已创建提交或 tag，则应先检查本地 Git 状态再决定如何处理。
