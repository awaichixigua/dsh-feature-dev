# dsh-feature-dev 原生插件技术方案

> 文档状态：Draft  
> 版本：v0.2.0  
> 编写日期：2026-08-19  
> 项目目录：`D:\ai\dsh-feature-dev`  
> 参考项目：`D:\ai\feature-dev`（只读，不修改）  
> 目标运行时：`deepseek-ai/deepseek-harness` Developer Preview

## 1. 方案结论

新建独立项目 `dsh-feature-dev`，面向 DeepSeek Harness 原生开发，不在原 `feature-dev` 仓库中增加适配层，也不要求原项目保持双端兼容。

两个项目的关系为：

```text
D:\ai\feature-dev
  Claude Code 版本
  只读参考源
  不修改、不依赖、不随 DSH 项目发布

             一次性迁移 / 人工同步规则
                        │
                        ▼

D:\ai\dsh-feature-dev
  DeepSeek Harness 原生版本
  独立 Git 仓库
  独立 npm 包
  独立 Skill / Tool / Workflow / UI 生命周期
  独立版本、测试和发布
```

运行时不得依赖 `D:\ai\feature-dev` 的绝对路径。需要复用的 Agent、规则、模板和确定性脚本应迁入新项目，经过 DSH 语义改造后成为新项目资产。

## 2. 建设目标

### 2.1 功能目标

1. 作为 DeepSeek Harness Cordis Bundle 安装。
2. 仅通过对话框即可发现和调用所有研发流程。
3. 支持自然语言触发和 `/skill-name` 显式触发。
4. 提供结构化的运行、恢复、确认、状态查询和诊断工具。
5. 使用 DSH 原生 Subagent、Workflow、Tool、Skill 和生命周期扩展。
6. 覆盖初始化、知识库、实施方案、代码生成/TDD、Bugfix、归档和代码问答。
7. 使用持久状态实现跨会话恢复。
8. 流程阶段、门禁、重试和停止条件由代码控制。

### 2.2 工程目标

- 新项目不包含 `.claude-plugin/`。
- 新项目不包含 Claude `commands/*.md`。
- 新项目不包含 Claude Hook Bridge。
- 新项目不使用 `$ARGUMENTS`、`CLAUDE_PLUGIN_ROOT` 或 Claude Marketplace 路径。
- 新项目不出现 `sonnet`、`haiku` 等 Claude 模型角色。
- 原项目不作为 npm 包依赖、Git submodule 或运行时文件源。
- 领域规则与 DSH 运行时实现分层，避免业务 Prompt 与 Harness API 相互污染。

### 2.3 非目标

- 首期不开发独立 Web 页面。
- 首期不兼容 `/feature-dev:xxx` Claude 命令格式。
- 首期不保证与 Claude 版本生成的正文逐字一致。
- 首期不接入所有可选插件；GitNexus、Beads、外部文档同步按阶段接入。
- 不在新项目内维护 Claude Code 发布物。

## 3. 用户入口

首期只有对话框入口。安装 Bundle 后，用户在 DeepSeek Harness 对话框输入 `/` 即可发现以下 Skill：

```text
/mrd-to-code
/knowledge-base
/implementation-plan
/code-gen-tdd
/bugfix
/archive
/prd-clarify
/influence-menu
```

### 3.1 显式调用

```text
/implementation-plan MRD地址：https://example/share_doc/?token=xxx
```

```text
/code-gen-tdd --feature-dir req/create-order --feature-id F-001 --to phase3
```

```text
/bugfix --feature-dir req/create-order bug描述：支付失败后订单状态没有回滚
```

```text
/archive --feature-dir req/create-order
```

### 3.2 自然语言调用

```text
使用 dsh-feature-dev，根据这个 MRD 生成 PRD 和技术方案：<url>
```

```text
继续 req/create-order，只实现 F-001，并执行到代码审查
```

```text
修复 req/create-order 中支付超时后状态未回滚的问题
```

### 3.3 原命令映射

| 原 Claude 命令 | 新项目调用 |
|---|---|
| `/feature-dev:01-knowledge-base` | `/knowledge-base` |
| `/feature-dev:02-implementation-plan` | `/implementation-plan` |
| `/feature-dev:03-code-gen-tdd` | `/code-gen-tdd` |
| `/feature-dev:04-archive` | `/archive` |
| `/feature-dev:bugfix` | `/bugfix` |
| `/feature-dev:prd-clarify` | `/prd-clarify` |
| `/feature-dev:influence-menu` | `/influence-menu` |
| `/feature-dev:fix-beads-duplicates` | 首期不提供；后续以需要确认的维护工具实现 |

## 4. 总体架构

```text
用户对话
   │
   ├─ /skill-name
   └─ 自然语言
          │
          ▼
    DSH Skill Provider
          │
          ▼
   Invocation Normalizer
          │
          ▼
   Feature Dev Tools
          │
          ▼
   Workflow State Machine
      │       │       │
      │       │       └─ Gate / Validator / Lifecycle
      │       └───────── State Repository
      └───────────────── Subagent / Script Executor
                              │
                              ▼
                     业务工程正式产物
```

### 4.1 分层

| 层 | 职责 |
|---|---|
| Domain Assets | Skill、Agent Prompt、规则、模板、决策树 |
| Workflow Core | Invocation、状态机、门禁、产物校验、恢复 |
| DSH Adapter | Cordis Bundle、Skill Provider、Tools、Subagent、Workflow |
| Project Runtime | Git、构建、测试、文件和外部能力 |

## 5. 项目目录

```text
D:\ai\dsh-feature-dev\
├─ package.json
├─ pnpm-lock.yaml
├─ tsconfig.json
├─ tsconfig.json
├─ cordis.patch.yml
├─ README.md
├─ docs/
│  ├─ TECH_DESIGN.md
│  ├─ USER_GUIDE.md
│  ├─ DEVELOPMENT.md
│  └─ COMPATIBILITY.md
├─ src/
│  ├─ index.ts
│  ├─ config.ts
│  ├─ skills/
│  │  └─ provider.ts
│  ├─ tools/
│  │  ├─ run.ts
│  │  ├─ resume.ts
│  │  ├─ status.ts
│  │  ├─ confirm.ts
│  ├─ runtime/
│  │  ├─ invocation.ts
│  │  ├─ project-root.ts
│  │  ├─ state-repository.ts
│  │  ├─ state-machine.ts
│  │  ├─ gate-engine.ts
│  │  ├─ artifact-validator.ts
│  │  ├─ lifecycle.ts
│  │  └─ errors.ts
│  ├─ executors/
│  │  ├─ subagent.ts
│  │  ├─ inline.ts
│  │  └─ script.ts
│  └─ workflows/
│     ├─ implementation-plan.ts
│     ├─ code-gen-tdd.ts
│     ├─ bugfix.ts
│     └─ archive.ts
├─ skills/
│  ├─ mrd-to-code/SKILL.md
│  ├─ knowledge-base/SKILL.md
│  ├─ implementation-plan/SKILL.md
│  ├─ code-gen-tdd/SKILL.md
│  ├─ bugfix/SKILL.md
│  ├─ archive/SKILL.md
│  ├─ prd-clarify/SKILL.md
│  └─ influence-menu/SKILL.md
├─ agents/
├─ rules/
├─ templates/
├─ scripts/
├─ schemas/
│  ├─ invocation.schema.json
│  ├─ phase-result.schema.json
│  └─ execution-state.schema.json
└─ tests/
   ├─ unit/
   ├─ contract/
   ├─ integration/
   └─ fixtures/
```

新项目不沿用原项目中的 `.workflow` 隐藏目录。确定性脚本、模板和状态协议分别迁入 `scripts/`、`templates/` 和 `schemas/`，使 npm 发布内容更清晰。

## 6. Bundle 设计

### 6.1 package.json

```json
{
  "name": "@your-org/dsh-feature-dev",
  "version": "0.1.0",
  "description": "Native MRD-to-code workflow bundle for DeepSeek Harness",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "files": [
    "lib",
    "cordis.patch.yml",
    "skills",
    "agents",
    "rules",
    "templates",
    "scripts",
    "schemas"
  ],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "<pinned-version>",
    "@deepseek-ai/dsh-skill": "<pinned-version>",
    "@deepseek-ai/dsh-tools": "<pinned-version>",
    "@deepseek-ai/dsh-subagent": "<pinned-version>",
    "@deepseek-ai/dsh-workflow": "<pinned-version>"
  }
}
```

DeepSeek Harness 处于 Developer Preview。开发和发布必须锁定已验证版本，并在启动时检查关键能力和版本范围。

### 6.2 cordis.patch.yml

```yaml
- insert:
    - id: dsh-feature-dev
      name: '@your-org/dsh-feature-dev'
      config:
        defaultWorkflow: code-gen-tdd
        subagentProvider: spawn
        strictGates: true
        maxTotalAgents: 24
        maxRepairAttempts: 3
```

### 6.3 插件入口

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.js'
import { registerSkills } from './skills/provider.js'
import { registerTools } from './tools/index.js'
import { registerLifecycle } from './runtime/lifecycle.js'

export const name = 'dsh-feature-dev'

export const inject = [
  'tools',
  'skills',
  'subagents',
  'workflowEngine',
  'systemPrompt',
]

export function apply(ctx: Context, config: Config): void {
  registerSkills(ctx, config)
  registerTools(ctx, config)
  registerLifecycle(ctx, config)
}
```

## 7. Skill 设计

### 7.1 Frontmatter

```yaml
---
name: code-gen-tdd
description: 生成代码并执行可恢复的 TDD 验证循环。适用于已有技术方案后实现完整需求或指定功能点。
user-invocable: true
disable-model-invocation: false
---
```

### 7.2 Skill 职责

Skill 只负责：

1. 判断用户意图是否匹配。
2. 说明必要参数和产物。
3. 从当前请求形成规范化 Invocation。
4. 调用 `feature_dev_run`、`feature_dev_resume` 等工具。
5. 展示结果或确认门。

Skill 不负责：

- 自行维护完整状态机。
- 自行决定重试和停止条件。
- 直接拼接任意 shell 命令。
- 绕过工具修改 `execution-state.json`。
- 引用原 Claude 项目路径。

### 7.3 Skill Provider

插件以内置 Provider 注册打包后的 `skills/`，使用 `import.meta.url` 解析包根目录。Skill 的 `resourceBase` 指向自身目录，内部资源只使用相对路径。

## 8. Tool 设计

### 8.1 工具清单

| Tool | 用途 | 是否修改业务工程 |
|---|---|---:|
| `feature_dev_run` | 创建并执行工作流 | 是 |
| `feature_dev_resume` | 从持久状态继续 | 是 |
| `feature_dev_status` | 查询状态与产物 | 否 |
| `feature_dev_confirm` | 提交确认门决定 | 仅状态 |

### 8.2 Invocation

```ts
interface FeatureDevInvocation {
  workflow:
    | 'knowledge-base'
    | 'implementation-plan'
    | 'code-gen-tdd'
    | 'bugfix'
    | 'archive'
    | 'prd-clarify'
    | 'influence-menu'
  projectRoot: string
  featureDir?: string
  featureId?: string
  target?: string
  rawUserRequest?: string
  options: {
    resume: boolean
    unitTests: boolean
    skipUnitTests?: boolean // false 时才生成并执行单测；默认跳过
    generateUnitTestsOnly: boolean
    clarifyMode?: 'dialogue' | 'batch'
  }
}
```

工具参数通过 Schema 校验。工作流内部不得重新解析用户命令字符串。

## 9. Workflow 设计

### 9.1 工作流清单

| Workflow | 阶段 |
|---|---|
| `implementation-plan` | MRD 读取 → 澄清 → 服务路由 → PRD → 技术方案 |
| `code-gen-tdd` | TestSpec → 实现 → Review → 测试生成 → 测试执行 → 汇总 |
| `bugfix` | 定位（只读）→ 用户确认定位与修复方向 → 影响分析 → 文档修订 → 代码修复 → 验证 → 报告 |
| `archive` | 快照 → 新鲜度检查 → 知识库更新 → 报告 |

### 9.2 固定编排

Workflow 脚本由插件代码拥有，用户和模型只能提供参数，不能提供或修改脚本正文。

```ts
const run = ctx.workflowEngine.start({
  script: CODE_GEN_TDD_SCRIPT,
  meta: CODE_GEN_TDD_META,
  args: normalizedInvocation,
  subagentProvider: config.subagentProvider,
  maxTotalAgents: config.maxTotalAgents,
  parent: exec.agent,
  signal: exec.signal,
})
```

### 9.3 Code Gen TDD 状态机

```text
INITIALIZED
  → PHASE1_TEST_SPEC
  → AWAITING_TEST_SPEC_CONFIRMATION
  → PHASE2_IMPLEMENTATION
  → PHASE3_REVIEW
      ├─ PASS/WARN → PHASE4_TEST_GENERATION
      └─ BLOCK → PHASE2_REPAIR → PHASE3_REVIEW
  → PHASE5_TEST_EXECUTION
      ├─ PASS/SKIPPED → PHASE6_SUMMARY
      ├─ PRODUCTION_DEFECT → PHASE2_REPAIR
      └─ TEST_DEFECT → PHASE4_REPAIR
  → COMPLETED | BLOCKED | INTERRUPTED
```

阶段推进、重试上限、目标 Phase 和完成判断全部由 State Machine 决定。

## 10. Agent 协议

### 10.1 请求

```ts
interface PhaseRequest {
  runId: string
  workflow: string
  phase: string
  projectRoot: string
  featureDir?: string
  featureId?: string
  promptPath: string
  inputs: Record<string, unknown>
  expectedArtifacts: string[]
  mode: 'normal' | 'incremental-fix' | 'incremental-review'
}
```

### 10.2 返回

```ts
interface PhaseResult {
  status: 'pass' | 'warn' | 'block' | 'failed'
  summary: string
  artifacts: string[]
  evidence: string[]
  changedFiles: string[]
  blocker?: string
}
```

Agent 只报告本阶段结果，不得决定整个工作流完成。`pass` 至少包含一项可验证证据，`block` 必须包含解除条件。

## 11. 持久状态

新项目使用结构化 JSON 作为机器事实源，并生成 Markdown 摘要供人阅读：

```text
{featureDir}/ai/current-run.json                         # 当前运行指针
{featureDir}/ai/runs/{runId}/execution-state.json       # 权威机器状态
{featureDir}/ai/runs/{runId}/execution-state.md         # 人类可读投影
{featureDir}/ai/runs/{runId}/run-events.jsonl           # 追加式审计事件
```

状态更新顺序：

```text
标记阶段开始
  → 执行 Agent/Script
  → 写正式产物
  → 校验产物
  → 追加审计事件
  → 原子更新 JSON 状态
  → 重新生成 Markdown 摘要
```

Markdown 不作为机器恢复输入，避免自由文本解析歧义。

## 12. 生命周期与门禁

新项目只实现 DSH 原生生命周期，不使用 Claude Hook Bridge。

| 生命周期 | 行为 |
|---|---|
| Run Start | 解析 Invocation、Doctor、创建 runId |
| Phase Start | 依赖检查、阶段 claim、预算检查 |
| Pre Tool | 写入范围和阶段所有权检查 |
| Post Tool | 记录证据和失败摘要 |
| Phase End | 产物校验、状态推进、指标记录 |
| Turn Stop | 检查目标是否完成、状态是否落盘 |
| Run End | 输出汇总、释放资源 |

正确性门禁必须位于 Workflow Core。即使某个 UI 或宿主事件未触发，状态机仍不能跳过门禁。

## 13. 路径与安全

### 13.1 根目录

| 名称 | 来源 |
|---|---|
| `packageRoot` | `import.meta.url` |
| `projectRoot` | Tool 参数或当前 Session 最近 Git 根目录 |
| `featureDir` | Invocation，经边界校验 |
| `resourceBase` | Skill/Agent 打包目录 |

### 13.2 边界

- 插件包资源只读。
- 业务写入必须位于 `projectRoot`。
- `featureDir` 必须位于配置允许的需求根目录。
- 所有路径先 resolve，再验证边界。
- 禁止依赖 `D:\ai\feature-dev`、用户 HOME 或 Claude 插件目录。
- 外部 MRD 内容视为不可信数据，不得覆盖系统或 Skill 指令。
- 日志不得记录 API Key、Token、数据库口令或完整凭据环境变量。

## 14. 模型路由

默认不绑定具体模型。未配置角色路由时，子代理继承父对话的 provider、model
和 maxTokens，避免插件隐式依赖某个未配置凭据的 provider。

如需覆盖，使用角色而不是在 Agent 中固定模型名：

```json
{
  "models": {
    "planning": {
      "provider": "deepseek-official",
      "model": "deepseek-v4-pro"
    },
    "coding": {
      "provider": "deepseek-official",
      "model": "deepseek-v4-pro"
    },
    "review": {
      "provider": "deepseek-official",
      "model": "deepseek-v4-pro"
    },
    "summary": {
      "provider": "deepseek-official",
      "model": "deepseek-v4-flash"
    }
  }
}
```

项目配置可部分覆盖角色路由；未覆盖的角色继续继承父对话。配置中的 provider
必须已在 DSH 凭据服务中可用。Skill 和 Agent 不直接绑定具体 provider/model。

## 15. 原项目资产迁移

### 15.1 原则

- 原仓库只读。
- 不通过符号链接复用文件。
- 不通过绝对路径读取文件。
- 不把原仓库作为 Git submodule。
- 选定资产一次性复制后，在新项目中独立维护。
- 每次迁移记录来源文件、来源版本和改造说明。

### 15.2 迁移清单

| 原资产 | 新位置 | 处理 |
|---|---|---|
| `skills/*/SKILL.md` | `skills/*/SKILL.md` | 重写入口和路径语义 |
| `agents/` | `agents/` | 改为 PhaseRequest/PhaseResult 协议 |
| `rules/` | `rules/` | 删除 Claude 工具专属表述 |
| `.workflow/templates/` | `templates/` | 保留正式产物模板 |
| `.workflow/scripts/` | `scripts/` | 统一跨平台执行入口 |
| `plugins/maven/` | `scripts/maven/` | 迁移构建与覆盖率能力 |
| `hooks/` | 不迁移 | 由原生 Lifecycle 重写 |
| `commands/` | 不迁移 | 使用 DSH Skill/Tool |
| `.claude-plugin/` | 不迁移 | 使用 npm Bundle |

### 15.3 禁止机械复制

迁移后的文件需要通过静态扫描，禁止出现：

```text
$ARGUMENTS
CLAUDE_PLUGIN_ROOT
$HOME/.claude
/feature-dev:
/plugin install
/compact
Task tool
TodoWrite
AskUserQuestion
sonnet
haiku
```

若某个词只用于迁移说明，必须位于 `docs/migration/`，不能进入运行时 Skill 和 Agent。

## 16. 测试

### 16.1 单元测试

- Invocation 规范化和参数互斥。
- 路径解析与越界防护。
- 状态机合法迁移。
- Gate 判断和停止条件。
- PhaseResult Schema。
- 产物校验。
- DSH 版本与能力检查。

### 16.2 契约测试

- 全部 Skill 可列举、加载和显式调用。
- Skill 名称、描述和调用权限正确。
- 五个 Tool Schema 稳定。
- Subagent 返回可映射为 PhaseResult。
- Workflow 取消、失败、阻塞和完成均能持久化。
- npm 发布包包含所有被引用资源。

### 16.3 集成测试

1. 本地 MRD 生成 PRD 和技术方案。
2. `code-gen-tdd` 运行到指定 Phase。
3. 中断后从正确 Phase 恢复。
4. Review BLOCK 自动回流实现阶段。
5. 单测关闭、开启、仅生成三种模式。
6. 功能点模式不修改其他功能点。
7. 多服务路由不在聚合目录误建需求空间。
8. Doctor 发现缺失配置但不修改业务代码。

## 17. 发布与安装

### 17.1 开发态

```powershell
dsh plugin --profile web add D:\ai\dsh-feature-dev
```

### 17.2 npm

```powershell
dsh plugin --profile web add @your-org/dsh-feature-dev
```

### 17.3 验证

```powershell
dsh --profile web --dump-config
dsh --profile headless --dump-config
```

安装后新建会话，在输入框输入 `/`，验证 Skill 清单和描述。

## 18. 实施计划

### 阶段 A：独立项目骨架

- 初始化独立 Git/npm/TypeScript 项目。
- 建立 Cordis Bundle 和版本兼容检查。
- 建立测试框架、Lint、Build 和发布包检查。

验收：Bundle 可被 DSH Profile 加载。

### 阶段 B：Skill 与只读能力

- 迁移并改造 Skill。
- 实现 Skill Provider。
- 实现 Invocation、Status 和 Doctor。
- 增加 Claude 专属关键词静态扫描。

验收：对话框 `/` 可发现全部 Skill，Status/Doctor 可调用。

### 阶段 C：Implementation Plan

- 迁移 MRD Reader、Clarify、Router、PRD、Tech Design Agent。
- 实现状态仓库、Gate、Confirm 和恢复。

验收：从 MRD 到 PRD/技术方案可运行和恢复。

### 阶段 D：Code Gen TDD

- 迁移 TestSpec、实现、Review、测试生成和测试运行 Agent。
- 实现固定 Workflow、回流和停止条件。

验收：完整 Fixture 和功能点 Fixture 通过。

### 阶段 E：其他工作流

- 实现 Init、Knowledge Base、Bugfix、Archive、Code Question。
- 按需接入 GitNexus、Beads 和外部文档同步。

验收：主命令映射全部具备 DSH 对话入口。

### 阶段 F：发布

- npm 打包和安装测试。
- Web/headless Profile 回归。
- 用户文档、升级和回滚说明。

## 19. 首期任务拆解

| ID | 任务 | 优先级 |
|---|---|---|
| DSH-001 | 初始化 `D:\ai\dsh-feature-dev` Git/npm/TS 项目 | P0 |
| DSH-002 | 锁定并验证 DSH 依赖版本 | P0 |
| DSH-003 | 实现 Bundle Manifest 和 Cordis Patch | P0 |
| DSH-004 | 实现 Package Root 与 Project Root Resolver | P0 |
| DSH-005 | 实现 Skill Provider | P0 |
| DSH-006 | 迁移并改造 `mrd-to-code/knowledge-base` Skills | P0 |
| DSH-007 | 迁移并改造 `implementation-plan/code-gen-tdd` Skills | P0 |
| DSH-008 | 定义 Invocation 和 PhaseResult Schema | P0 |
| DSH-009 | 实现 State Repository 和 State Machine | P0 |
| DSH-010 | 实现 Status/Doctor Tools | P1 |
| DSH-011 | 实现 Subagent Executor | P0 |
| DSH-012 | 实现 Implementation Plan Workflow | P0 |
| DSH-013 | 实现 Confirm/Resume Tools | P0 |
| DSH-014 | 实现 Code Gen TDD Workflow | P0 |
| DSH-015 | 实现原生 Lifecycle 和 Gate | P0 |
| DSH-016 | 实现契约、集成和发布包测试 | P0 |
| DSH-017 | 迁移 Bugfix/Archive/Code Question | P1 |
| DSH-018 | npm 发布与 Profile 安装验证 | P1 |

## 20. 风险

| 风险 | 应对 |
|---|---|
| DSH Developer Preview API 变化 | 精确锁版、适配层集中、启动兼容检查 |
| 机械迁移残留 Claude 语义 | 静态扫描和 Skill 契约测试 |
| DeepSeek 长流程偏航 | 固定 Workflow、结构化返回、强门禁 |
| 状态与产物不一致 | JSON 权威状态、事件日志、Reconcile |
| 多 Agent 工作树冲突 | 同服务修改阶段串行、明确文件所有权 |
| 新旧项目规则漂移 | 新项目独立版本；只在明确迁移任务中同步 |
| npm 包遗漏 Prompt/模板 | 发布包快照和资源引用完整性测试 |

## 21. 验收标准

- 原 `D:\ai\feature-dev` 仓库无新增或修改文件。
- `D:\ai\dsh-feature-dev` 是独立可构建项目。
- Bundle 可安装到 DSH `web` 和 `headless` Profile。
- 输入 `/` 可以发现全部首期 Skill。
- 不使用 Claude command、Hook、模型名或安装路径。
- `feature_dev_run/status/resume/confirm` 可用。
- Implementation Plan 和 Code Gen TDD 各至少一条端到端 Fixture 通过。
- 中断后可从持久状态恢复。
- 关闭原项目或移动原项目目录不影响新插件运行。
- npm 发布包不包含凭据、临时文件或对原仓库的引用。

## 22. 参考资料

- DeepSeek Harness：<https://github.com/deepseek-ai/deepseek-harness>
- 架构：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.zh.md>
- Bundle：<https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/README.zh.md>
- Skill 文件系统：<https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.zh.md>
- Skill Tool：<https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/tool-skill/README.zh.md>
- Subagent：<https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/README.zh.md>
- Workflow：<https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/README.zh.md>
