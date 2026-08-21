# 开发指南

## 项目结构

```
dsh-feature-dev/
├─ package.json
├─ tsconfig.json
├─ tsconfig.json               TypeScript 构建配置
├─ cordis.patch.yml            Cordis patch
├─ src/                        TypeScript 源码
│  ├─ index.ts                 插件入口 (Cordis apply)
│  ├─ config.ts                默认配置 + 覆盖配置
│  ├─ types/contracts.ts       领域类型
│  ├─ runtime/                 Workflow Core
│  │  ├─ invocation.ts         规范化器
│  │  ├─ paths.ts              路径/边界安全
│  │  ├─ state-repository.ts   JSON + 事件日志 + MD
│  │  ├─ state-machine.ts      阶段状态机
│  │  ├─ gate-engine.ts        确认门
│  │  ├─ artifact-validator.ts 产物校验
│  │  ├─ lifecycle.ts          DSH 生命周期钩子
│  │  └─ errors.ts             错误层级
│  ├─ executors/               子 agent 适配器
│  ├─ skills/provider.ts       Skill 注册
│  ├─ tools/                   feature_dev_run / resume / status / confirm
│  └─ workflows/               implementation-plan / code-gen-tdd / bugfix / archive
├─ skills/<name>/SKILL.md      10 个 skill
├─ agents/                     16 个子 agent 规格
├─ rules/                      领域规则
├─ templates/                  产品模板
├─ schemas/                    JSON Schema
├─ scripts/                    CLI 辅助
└─ tests/
   ├─ unit/
   ├─ contract/
   └─ integration/
```

## 构建

```powershell
pnpm install
pnpm build
```

构建产物是 `lib/index.js` 和 `lib/types/index.d.ts`(类型声明文件)。构建过程**不会**复制 `skills/`、`agents/`、`rules/`、`templates/`、`scripts/`、`schemas/` —— 这些目录原样发布(在 `package.json` 的 `files` 字段中声明)。

## 类型检查

```powershell
pnpm typecheck
```

这是严格类型检查(`strict`、`noUncheckedIndexedAccess`、`noImplicitReturns`)。新增 `any` 需要显式的 `@ts-expect-error`,或者在 PR 中给出针对性的理由说明。

## 测试

```powershell
pnpm test:unit         # 纯逻辑测试
pnpm test:contract     # skill 发现、包清单
pnpm test:integration  # 端到端,使用占位子 agent
pnpm test:scan         # Claude 关键词残留扫描
pnpm test:package      # 验证 npm `files` 是否包含所有必需内容
```

测试通过 Node 22 内置的 test runner 配合 `tsx` 运行。我们**不**依赖 Jest / Vitest;这种测试运行器的选择让产物更轻量,并与 DSH 的运行时保持一致。

## 新增工作流

1. 把 workflow id 加到 `src/runtime/invocation.ts` 的 `KNOWN_WORKFLOWS` 中。
2. 在 `src/runtime/state-machine.ts` 中添加 FSM 边。
3. 在 `src/workflows/<name>.ts` 中实现工作流,并接入到 `src/workflows/runner.ts`。
4. 在 `src/workflows/artifacts.ts` 中声明产物期望。
5. 在 `skills/<name>/SKILL.md` 添加一个 skill。
6. 补充单元测试和集成测试。
7. 更新 `docs/TECH_DESIGN.md` 和 `docs/USER_GUIDE.md`。

## 新增子 agent

子 agent 提示词按所属 workflow 分目录存放；被多个 workflow 共用的放 `agents/shared/`，由 `src/workflows/agent-prompt-path.ts` 的 `resolveAgentPromptPath(packageRoot, workflow, subagent)` 解析（先看 `agents/<workflow>/<subagent>.md`，缺则回落 `agents/shared/<subagent>.md`）。

1. **写提示词**。在 `agents/<workflow>/<agent>.md`（或 `agents/shared/<agent>.md`）创建 Markdown：YAML frontmatter + 正文。
   - frontmatter 必填：`name`、`phase`、`workflow`、`model_role`（`planning | coding | review | summary`）、`output`。`phase` 决定子会话的 `workflow:<w> | phase:<p>` 标签；`model_role` 决定执行器从 `opts.models` 里挑哪条模型路由，缺了就用 `defaultModel` 再落到 DSH 父路由。
   - frontmatter 里的 `workflow` / `phase` 必须与第 2 步在 workflow 阶段表里登记的 id 一致。
   - 正文按「输入 / 输出 / 必须章节 / 硬规则」组织。最终输出必须严格遵守 `PhaseResult` JSON 合约（`status` 枚举 `pass | warn | block | failed`、`summary`、`artifacts`、`evidence`、`changedFiles`、`blocker?`）；自然语言用简体中文，但 JSON 键名和 `status` 枚举保持原样。`evidence` 项必须是字符串；`pass` 但 `evidence` 为空会被 `parsePhaseResult` 自动降级为 `warn`。
2. **接到 workflow 驱动**。在 `src/workflows/<workflow>.ts` 的阶段列表里加一个 `PhaseSpec`，把 `subagent` 字段填成提示词文件名（不含 `.md`）。`promptPath` 由 `resolveAgentPromptPath` 自动算出，无需手写。
   - 如果 `phase` 是新阶段名（不只是复用现有阶段），还要在 `src/runtime/state-machine.ts` 加 FSM 边，并在 `src/workflows/artifacts.ts` 里登记阶段期望的产物。
   - 全新 workflow 才需要动 `src/runtime/invocation.ts` 的 `KNOWN_WORKFLOWS`——那一节归「新增工作流」。
3. **配套规则**。`src/executors/protocol.ts` 的 `buildRuleLoadingPolicy` 会在 prompt 里强制子 agent 先读 `rules/common/*.md`（缺失会抛 `ExecutorError`），再按需读 `rules/<agent>/index.md`。
   - 有专属约束的 agent：在 `rules/<agent>/index.md` 列主题规则；index 缺失会跳过专属规则。
   - 纯靠公共规则的 agent：至少确认 `rules/common/` 下已经有它需要的主题。
4. **如果是 shared agent**（被 ≥ 2 个 workflow 复用），把它登记到 `agents/README.md` 的「shared 子 agent 的复用关系」表里；frontmatter 的 `workflow` 写成它首次出现的那个 workflow。
5. **补测试**。
   - `PhaseResult` 解析非平凡时（自定义 `bugClassification`、宽松 evidence 等），在 `tests/unit/` 给 `parsePhaseResult` 加场景。
   - 参与 project-tools 流程的 agent 追加到 `tests/contract/project-tools-loading.test.ts` 的 `AGENTS` 白名单（该测试会校验 frontmatter / 正文里出现 `arch-docs/project-tools-index.md` 的引用与 `block` 行为）。
   - 跑 `pnpm test:package` 确认 `agents/<新路径>` 被 `package.json` 的 `files` 包含。
6. **更新文档**。在 `docs/TECH_DESIGN.md` 与 `docs/USER_GUIDE.md` 的相关章节里登记新阶段 / 新 agent。

## 与 DSH API 的兼容性

DSH 处于 Developer Preview。`package.json` 中的 peer dep 版本范围是有意固定到某个已知可用版本的。当 DSH 发布新版本时:

1. 跑 `pnpm verify:dsh` 检查当前安装情况。
2. 跑 `pnpm test:integration` 对新 peer 版本做集成测试。
3. 如果出了问题,把改动隔离到 `src/executors/`、`src/skills/provider.ts` 或 `src/index.ts` 内的小适配层中。**不要**让 DSH API 的具体形态渗透到 Workflow Core。

## 日志放哪里

使用 DSH harness 在 `apply()` 时提供的 `ctx.logger`。在 `src/` 中避免使用 `console.*`(会让测试输出很乱,而且更难重定向)。

## 编码约定

- 仅 ESM(`"type": "module"`)。
- 新代码里如非必要不写 `any`,必须带说明注释。
- 每个文件一个公共导出,除非它们紧密耦合。
- 错误类继承自 `FeatureDevError`(见 `src/runtime/errors.ts`)。
- 文件 I/O 使用 `node:fs` 和 `node:path`;对用户输入的字符串做 `path.join` 前必须先 `resolve`。
- Shell 调用使用 `execFileSync`(不经 shell)并设置 `windowsHide: true`。

## 发布

1. 在 `package.json` 里 bump `version`。
2. 更新 `docs/CHANGELOG.md`(TODO: 暂未添加)。
3. `pnpm build && pnpm test:scan && pnpm test:package`。
4. `npm publish`(或你们组织使用的其他发布机制)。
