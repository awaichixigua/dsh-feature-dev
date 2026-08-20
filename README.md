# dsh-feature-dev

> Native MRD-to-code workflow bundle for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (Developer Preview).

`dsh-feature-dev` brings the full MRD → PRD → Tech Design → Code → Archive
flow to DeepSeek Harness, as a Cordis Bundle. It is a **standalone npm
package** that does not depend on or modify the original Claude-only
`feature-dev` project.

| | |
|---|---|
| Project | `D:\ai\dsh-feature-dev` |
| Reference (read-only) | `D:\ai\feature-dev` |
| Runtime | DeepSeek Harness Developer Preview |
| Node | ≥ 22 |
| License | (TBD) |

## Quick start

```powershell
# dev install
dsh plugin --profile web add D:\ai\dsh-feature-dev

# npm install (once published)
dsh plugin --profile web add @your-org/dsh-feature-dev

# verify
dsh --profile web --dump-config
```

In a conversation, type `/` to discover the skills:

```
/mrd-to-code
/knowledge-base
/implementation-plan
/code-gen-tdd
/bugfix
/archive
/prd-clarify
/influence-menu
```

## What's in the box

- 4 DSH tools: `feature_dev_run`, `feature_dev_resume`, `feature_dev_status`, `feature_dev_confirm`
- 10 skills (the 9 above + `mrd-to-code` as the end-to-end entry)
- 4 full workflows: `implementation-plan`, `code-gen-tdd`, `bugfix`, `archive`
- 3 fixed state machines (one per multi-phase workflow)
- Persistent JSON state with atomic writes + audit log + MD projection
- 16 subagent prompts (in `agents/`)
- 5 product templates (in `templates/`)
- 3 JSON Schemas (in `schemas/`)
- 8 unit tests, 2 contract tests, 2 integration tests

## What's NOT in scope (first release)

- Independent web UI.
- Compatibility with the legacy `/feature-dev:xxx` Claude command format.
- Verbatim parity with the Claude-only version's wording.
- Optional plugin integrations (GitNexus, Beads, external doc sync) — added per phase.

See `docs/TECH_DESIGN.md` §2.3 for the full list of non-goals.

## Architecture (one-line per layer)

- **Domain Assets** — Skill SKILL.md, Agent .md, rules, templates, decision trees.
- **Workflow Core** — `src/runtime/` and `src/workflows/`. State machine, gates, artifacts, recovery.
- **DSH Adapter** — `src/skills/provider.ts`, `src/tools/`, `src/executors/`. Talks to DSH.
- **Project Runtime** — git, build, test, files.

## Documentation

- [TECH_DESIGN.md](docs/TECH_DESIGN.md) — full technical design
- [USER_GUIDE.md](docs/USER_GUIDE.md) — end-user command reference
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) — how to develop this bundle
- [COMPATIBILITY.md](docs/COMPATIBILITY.md) — DSH API compatibility matrix
- [migration/MIGRATION.md](docs/migration/MIGRATION.md) — notes on what changed vs. the Claude version

## Development

```powershell
# typecheck
pnpm typecheck

# build
pnpm build

# all tests
pnpm test

# unit only
pnpm test:unit

# contract only
pnpm test:contract

# integration only
pnpm test:integration

# static scan for Claude placeholders
pnpm test:scan

```

## License

TBD.
