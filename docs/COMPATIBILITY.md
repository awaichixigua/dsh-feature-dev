# DSH 兼容性矩阵

DSH 处于 **Developer Preview** 阶段,公共 API 可能会变。本文档记录 `dsh-feature-dev` 构建和测试所基于的 DSH peer 依赖版本,以及我们为把 Workflow Core 与这些变更隔离开所做的调整。

## 固定的 peer 依赖

| 包 | 版本范围 | 说明 |
|---|---|---|
| `@deepseek-ai/cordis` | `^0.0.0-dev.20260819` | `Context`、`apply`、`inject` |
| `@deepseek-ai/dsh-skill` | `^0.0.0-dev.20260819` | `registerSkill`、`Skill` 形态 |
| `@deepseek-ai/dsh-tools` | `^0.0.0-dev.20260819` | Tool 注册 |
| `@deepseek-ai/dsh-subagent` | `^0.0.0-dev.20260819` | `spawnSubagent`、`appendAndAsk` |
| `@deepseek-ai/dsh-workflow` | `^0.0.0-dev.20260819` | `workflowEngine.start` |

这些版本目前是占位值。首个正式发布版会固定到第一个通过集成测试的 DSH 构建上。

## 适配层范围

为最小化 DSH API 变更带来的影响,每个 DSH 接口都被隔离在唯一的适配器后面:

| 适配器 | 用途 |
|---|---|
| `src/index.ts` | 唯一知道 DSH `Context` 形态的文件。 |
| `src/skills/provider.ts` | 唯一调用 `registerSkill` 的文件。 |
| `src/executors/spawn-port.ts` | 唯一引用 `@deepseek-ai/dsh-subagent` 的 `spawnSubagent` 的文件。 |
| `src/executors/inline.ts` | 唯一引用 `appendAndAsk` 的文件。 |
| `src/tools/contract.ts` | 唯一决定 Tool 返回结果形态的位置。 |

如果 DSH 重命名了上述任一项,我们只改适配器,bundle 的其余部分不受影响。

## 如何应对 API 变更

1. **检测** — `scripts/verify-dsh-versions.ts` 在 CI 中以及 `pnpm verify:dsh` 时运行。它会检查每个 peer 依赖是否已安装,并报告实际解析到的版本。
2. **隔离** — 由适配层文件吸收变更。除非存在语义层面的 gap,否则不会修改 Workflow Core 代码。
3. **沟通** — 每次 DSH API 升级都会在 `CHANGELOG.md`(TODO) 中加一节,并 bump `package.json` 的 `dsh:` 字段中的 `cordis-bundle-api`。

## Cordis patch 格式

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

默认不配置 `models`：子代理继承当前父对话的 provider、model 和
maxTokens，因此不要求额外的 DeepSeek API Key。需要按角色覆盖时，可显式增加
`models.planning/coding/review/summary`；所填 provider 必须已在 DSH 中配置凭据。

`cordis.patch.yml` 是完整 Cordis patch DSL 的一个刻意精简的子集。我们只依赖其中这些特定键;超出这个集合的内容会被忽略。

## 运行时 profile

| Profile | 用途 | 说明 |
|---|---|---|
| `web` | 终端用户对话(推荐) | 完整的 Skill / Tool 表面 |
| `headless` | CI / 脚本化 | 同样的表面,无 UI |

bundle 本身不为特定 profile 注册任何专属代码。

## DSH 必须提供的能力

- 一个 `Context` 对象,其 `registerSkill` 可调用。
- 一种把 Bundle 中的 Tool 暴露给对话的机制(如 `registerTool`)。
- 一个 `workflowEngine` 服务,用来驱动长时间运行的工作流。
- 一个能根据给定的 prompt 路径和入参运行子 agent、并返回字符串的子 agent 系统。

我们不依赖任何 UI 钩子、hook bridge 或模型专属的路由。
