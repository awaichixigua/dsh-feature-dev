# DSH Compatibility Matrix

DSH is in **Developer Preview** and its public API may change. This document
records the versions of the DSH peer dependencies that `dsh-feature-dev`
is built and tested against, plus the changes we made to insulate the
Workflow Core from those changes.

## Pinned peer deps

| Package | Version range | Notes |
|---|---|---|
| `@deepseek-ai/cordis` | `^0.0.0-dev.20260819` | `Context`, `apply`, `inject` |
| `@deepseek-ai/dsh-skill` | `^0.0.0-dev.20260819` | `registerSkill`, `Skill` shape |
| `@deepseek-ai/dsh-tools` | `^0.0.0-dev.20260819` | Tool registration |
| `@deepseek-ai/dsh-subagent` | `^0.0.0-dev.20260819` | `spawnSubagent`, `appendAndAsk` |
| `@deepseek-ai/dsh-workflow` | `^0.0.0-dev.20260819` | `workflowEngine.start` |

These versions are placeholders. The real first release will be pegged to
the first DSH build that passes the integration tests.

## Adapter surface

To minimize the impact of DSH API churn, every DSH surface is hidden
behind a single adapter:

| Adapter | Purpose |
|---|---|
| `src/index.ts` | The only file that knows the DSH `Context` shape. |
| `src/skills/provider.ts` | The only file that calls `registerSkill`. |
| `src/executors/spawn-port.ts` | The only file that imports `@deepseek-ai/dsh-subagent`'s `spawnSubagent`. |
| `src/executors/inline.ts` | The only file that imports `appendAndAsk`. |
| `src/tools/contract.ts` | The only place that decides the Tool result shape. |

If DSH renames any of those, we change the adapter and the rest of the
bundle is unaffected.

## How we handle API changes

1. **Detection** — `scripts/verify-dsh-versions.ts` runs in CI and on
   `pnpm verify:dsh`. It checks each peer dep is installed and reports
   the resolved version.
2. **Containment** — adapter files absorb the change. Workflow Core code
   is not modified unless a semantic gap forces it.
3. **Communication** — every DSH API bump adds a section to
   `CHANGELOG.md` (TODO) and bumps the `cordis-bundle-api` field in
   `package.json` `dsh:`.

## Cordis patch format

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

`cordis.patch.yml` is a deliberate subset of the full Cordis patch DSL.
We rely on these specific keys; anything outside this set is ignored.

## Runtime profiles

| Profile | Used for | Notes |
|---|---|---|
| `web` | End-user dialog (recommended) | Full Skill/Tool surface |
| `headless` | CI / scripted | Same surface, no UI |

The bundle does not register any profile-specific code.

## What DSH must provide

- A `Context` object whose `registerSkill` is callable.
- A way to expose a Tool from a Bundle to the dialog (e.g. `registerTool`).
- A `workflowEngine` service to drive long-running workflows.
- A Subagent system that can run a child agent with a given prompt path
  and inputs, and return a string.

We do not depend on any UI hooks, hook bridge, or model-specific routing.
