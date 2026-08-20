# Migration notes

This document records what changed between the original Claude-only
`D:\ai\feature-dev` project and the new DSH-native `D:\ai\dsh-feature-dev`.
**It is documentation only — none of the terms below appear in any
runtime skill, agent, or workflow.**

The original project is read-only and not modified by this bundle.

## Concept mapping

| Original (Claude) | New (DSH) |
|---|---|
| `.claude-plugin/plugin.json` | `package.json` `dsh.bundle.patch` |
| `commands/*.md` (Claude slash commands) | DSH `skills/*/SKILL.md` |
| `hooks/hooks.json` | DSH native lifecycle (`src/runtime/lifecycle.ts`) |
| `$ARGUMENTS` | Tool arg map (no string parsing in the workflow) |
| `CLAUDE_PLUGIN_ROOT` | `import.meta.url` resolved at apply() time |
| `~/.claude/...` paths | `import.meta.url` (package root) + `projectRoot` (user's project) |
| `Task tool` | `SubagentExecutor.run()` |
| `TodoWrite` | Append-only `run-events.jsonl` |
| `AskUserQuestion` | `GateEngine.raise()` + `feature_dev_confirm` |
| `sonnet` / `haiku` model names | `planning` / `coding` / `review` / `summary` roles |
| `feature-dev:xxx` command prefix | `xxx` Skill name |
| `.workflow/` runtime dir | `ai/` inside `featureDir` |

## File mapping

| Original | New | Notes |
|---|---|---|
| `SKILL.md` (orchestrator) | `skills/mrd-to-code/SKILL.md` | Rewritten with DSH semantics |
| `skills/00-init/SKILL.md` | `skills/init/SKILL.md` | Path-resolver rules rewritten |
| `skills/01-knowledge-base/SKILL.md` | `skills/knowledge-base/SKILL.md` | L0/L1/L2 rules moved to `rules/common/agents.md` |
| `skills/02-implementation-plan/SKILL.md` | `skills/implementation-plan/SKILL.md` | MODE A/B both retained |
| `skills/03-code-gen-tdd/SKILL.md` | `skills/code-gen-tdd/SKILL.md` | State machine matches `src/runtime/state-machine.ts` |
| `skills/04-archive/SKILL.md` | `skills/archive/SKILL.md` | 4-step flow |
| `skills/bugfix/SKILL.md` | `skills/bugfix/SKILL.md` | 6-step flow |
| `skills/code-question/SKILL.md` | `skills/code-question/SKILL.md` | One-shot |
| `skills/influence-menu/SKILL.md` | `skills/influence-menu/SKILL.md` | One-shot |
| `skills/prd-clarify/SKILL.md` | `skills/prd-clarify/SKILL.md` | One-shot |
| `agents/<name>/<name>-agent.md` (21 agents) | `agents/<name>.md` (16 agents) | Migrated with PhaseRequest/PhaseResult contract |
| `rules/common/agents.md` | `rules/common/agents.md` | Updated to DSH primitives |
| `rules/common/timing-spec.md` | `rules/common/timing-spec.md` | Per-phase wall time + token budget |
| `rules/common/error-format.md` | `rules/common/error-format.md` | Stable JSON error shape |
| `rules/java/standards/*` | `rules/library/java/*` | Curated Java coding, integration and quality-gate topics; loaded by Agent indexes on demand |
| `rules/test/*` | `rules/library/testing/*` | Curated test specification, generation, environment, coverage and validation topics; loaded by Agent indexes on demand |
| `rules/common/security.md` | `rules/library/security.md` | DSH-neutral security rules shared by implementation and review indexes |
| `.workflow/templates/*` | `templates/*` | Moved to package root |
| `.workflow/scripts/*` | `scripts/*` | Cross-platform entries only; Windows-specific kept where used |
| `plugins/maven/*` | (out of scope) | Will arrive with the Maven build profile in a later release |
| `plugins/beads/*` | (out of scope) | Coming soon |
| `plugins/gitnexus/*` | (out of scope) | Coming soon |
| `hooks/*` | (not migrated) | DSH native lifecycle replaces it |
| `commands/*` | (not migrated) | DSH skills replace them |

## Behavior deltas (intentional)

- **Skill inputs are not stringified.** A Skill that previously parsed
  `$ARGUMENTS` now uses a structured Tool arg map. This removes
  a class of injection bugs and removes the need to teach the
  Subagent to re-parse user text.
- **No `$ARGUMENTS`, `CLAUDE_PLUGIN_ROOT`, or `Task tool` in any runtime
  asset.** Enforced by `scripts/scan-claude-keywords.ts`.
- **State is JSON-authoritative.** Markdown is a generated projection.
  The original project allowed `execution-state.md` to be edited by hand;
  this bundle does not.
- **No `/feature-dev:xxx` command prefix.** Skills are discovered by
  their name only.
- **No Claude model name binding.** Roles (`planning` / `coding` /
  `review` / `summary`) are the only thing Skills and Agents see.

## What was NOT migrated

- Claude marketplace / plugin install paths.
- Hook bridge code.
- The `~/.claude/plugins/marketplaces/feature-dev/...` resource convention.
- Direct bash integration; replaced with cross-platform Node scripts.
- Beads / RTK / GitNexus plugins; they remain optional in this bundle
  and arrive per phase.

## Compatibility policy

`dsh-feature-dev` will never read files from `D:\ai\feature-dev` or any
other path containing `/feature-dev/`, `/.claude/`, or `node_modules/`.
If you want to move or delete the original project, no action is needed
on the new bundle.

The static scan in `scripts/scan-claude-keywords.ts` enforces this at
build time.
