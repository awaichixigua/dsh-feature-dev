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

1. 在 `agents/<agent-name>.md` 中按 `PhaseRequest` / `PhaseResult` 协议编写。
2. 在对应的工作流中增加一个阶段调用。
3. 如果 agent 的输出非平凡,针对其产出的 `parsePhaseResult` 场景补单元测试。

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
