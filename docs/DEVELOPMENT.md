# Development Guide

## Project layout

```
dsh-feature-dev/
├─ package.json
├─ tsconfig.json
├─ tsconfig.json               TypeScript build config
├─ cordis.patch.yml            Cordis patch
├─ src/                        TypeScript source
│  ├─ index.ts                 Plugin entry (Cordis apply)
│  ├─ config.ts                Default + override config
│  ├─ types/contracts.ts       Domain types
│  ├─ runtime/                 Workflow Core
│  │  ├─ invocation.ts         Normalizer
│  │  ├─ paths.ts              Path/boundary safety
│  │  ├─ state-repository.ts   JSON + event log + MD
│  │  ├─ state-machine.ts      Phase transitions
│  │  ├─ gate-engine.ts        Confirmations
│  │  ├─ artifact-validator.ts Artifact presence
│  │  ├─ lifecycle.ts          DSH lifecycle hooks
│  │  └─ errors.ts             Error hierarchy
│  ├─ executors/               Subagent adapters
│  ├─ skills/provider.ts       Skill registration
│  ├─ tools/                   feature_dev_run / resume / status / confirm
│  └─ workflows/               implementation-plan / code-gen-tdd / bugfix / archive
├─ skills/<name>/SKILL.md      10 skills
├─ agents/                     16 subagent specs
├─ rules/                      Domain rules
├─ templates/                  Product templates
├─ schemas/                    JSON Schemas
├─ scripts/                    CLI helpers
└─ tests/
   ├─ unit/
   ├─ contract/
   └─ integration/
```

## Build

```powershell
pnpm install
pnpm build
```

This produces `lib/index.js` + `lib/types/index.d.ts` (declaration files).
The build **does not** copy `skills/`, `agents/`, `rules/`, `templates/`,
`scripts/`, or `schemas/` — those ship as-is (declared in `package.json`
`files`).

## Typecheck

```powershell
pnpm typecheck
```

This is a strict typecheck (`strict`, `noUncheckedIndexedAccess`,
`noImplicitReturns`). Adding `any` requires an explicit `@ts-expect-error`
or a focused justification in the PR.

## Tests

```powershell
pnpm test:unit         # pure logic tests
pnpm test:contract     # skill discovery, package manifest
pnpm test:integration  # end-to-end with placeholder subagents
pnpm test:scan         # Claude-keyword residue scan
pnpm test:package      # verifies npm `files` would include everything required
```

Tests run under Node 22's built-in test runner via `tsx`. We do **not**
depend on Jest / Vitest; the test runner choice keeps the bundle
lightweight and matches DSH's runtime.

## Adding a new workflow

1. Add the workflow id to `KNOWN_WORKFLOWS` in `src/runtime/invocation.ts`.
2. Add the FSM edges in `src/runtime/state-machine.ts`.
3. Implement the workflow in `src/workflows/<name>.ts` and wire it into
   `src/workflows/runner.ts`.
4. Add the artifact expectations in `src/workflows/artifacts.ts`.
5. Add a skill in `skills/<name>/SKILL.md`.
6. Add unit + integration tests.
7. Update `docs/TECH_DESIGN.md` and `docs/USER_GUIDE.md`.

## Adding a new subagent

1. Write `agents/<agent-name>.md` with the PhaseRequest/PhaseResult contract.
2. Add a Phase invocation in the relevant workflow.
3. If the agent's output is non-trivial, write a unit test for the
   `parsePhaseResult` cases it produces.

## Compatibility with the DSH API

DSH is in Developer Preview. The peer dep ranges in `package.json` are
deliberately pinned to a known good build. When DSH publishes a new
version:

1. Run `pnpm verify:dsh` to check current installation.
2. Run `pnpm test:integration` against the new peer version.
3. If something broke, isolate the change to a small adapter inside
   `src/executors/`, `src/skills/provider.ts`, or `src/index.ts`. Do NOT
   leak DSH API shapes into the Workflow Core.

## Where to add logging

Use the `ctx.logger` provided by the DSH harness at `apply()` time. Avoid
`console.*` inside `src/` (it makes test output noisy and is harder to
redirect).

## Coding conventions

- ESM only (`"type": "module"`).
- No `any` in new code without a justification comment.
- One public export per file unless they are tightly coupled.
- Errors extend `FeatureDevError` (see `src/runtime/errors.ts`).
- File I/O uses `node:fs` and `node:path`; never `path.join` with
  user-supplied strings without `resolve` first.
- Shell calls use `execFileSync` (no shell) and `windowsHide: true`.

## Releasing

1. Bump `version` in `package.json`.
2. Update `docs/CHANGELOG.md` (TODO: not yet added).
3. `pnpm build && pnpm test:scan && pnpm test:package`.
4. `npm publish` (or whatever release mechanism your org uses).
