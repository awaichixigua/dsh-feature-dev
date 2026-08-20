# dsh-feature-dev User Guide

## How it works

`dsh-feature-dev` registers as a Cordis Bundle. After installation, type
`/` in any conversation to discover the skills.

```
/mrd-to-code          End-to-end MRD → archive
/knowledge-base       Build / refresh the app knowledge base
/implementation-plan  Generate PRD + tech design from MRD
/code-gen-tdd         Generate code with a recoverable TDD loop
/bugfix               Fix a bug inside an existing feature dir
/archive              Archive a completed feature
/prd-clarify          Run PRD clarification only
/influence-menu       Show impact surface for a symbol
```

`/bugfix` first runs a read-only LOCATE phase. It then pauses and presents the
location evidence and repair direction. Source or document changes begin only
after the user confirms `proceed`.

## End-to-end example

```text
User: /mrd-to-code https://example.com/share_doc/?token=abc
DSH:  Reading MRD... please answer 3 questions before we proceed.
User: 1) Charge is per-call, 2) Yes idempotent, 3) USD
DSH:  Wrote <featureDir>/mrd-clarified.md. Routing services: order-svc (primary), payment-svc (collaborator).
      Drafted PRD. Please review.
User: /confirm pre_prd accept
DSH:  Generating tech design... Done. Please review.
User: /confirm pre_tech_design proceed
DSH:  Generating test spec... Done. Please review.
User: /confirm post_test_spec accept
DSH:  Implementing... review... tests... all passed. Archived.
```

## Resuming an interrupted run

```text
User: /code-gen-tdd --feature-dir req/create-order --resume
DSH:  Resuming from PHASE2_IMPLEMENTATION. Run-id: <runId>.
```

## Inspecting state

```text
User: /status --project-root . --feature-dir req/create-order
DSH:  runId: <runId>, status: running, currentPhase: PHASE4_TEST_GENERATION, repairCount: 0
```

## Confirming a gate

```text
User: /confirm --project-root . --feature-dir req/create-order --gate pre_prd --choice accept
DSH:  Resolved. 0 pending.
```

## Mapping from the old Claude commands

| Old | New |
|---|---|
| `/feature-dev:01-knowledge-base` | `/knowledge-base` |
| `/feature-dev:02-implementation-plan` | `/implementation-plan` |
| `/feature-dev:03-code-gen-tdd` | `/code-gen-tdd` |
| `/feature-dev:04-archive` | `/archive` |
| `/feature-dev:bugfix` | `/bugfix` |
| `/feature-dev:prd-clarify` | `/prd-clarify` |
| `/feature-dev:influence-menu` | `/influence-menu` |
| `/feature-dev:fix-beads-duplicates` | (not in v0.1) |

## Trigger phrases (model-invocation)

Each skill declares in its SKILL.md what trigger phrases activate it via
natural language. For example, `mrd-to-code` activates on
"mrd to code", "全流程", "一键研发", "从需求到代码", etc.

## Privacy

- Bundle resources are read-only.
- All writes go to `projectRoot`. No file outside `projectRoot` is touched.
- `execution-state.json` never receives `SERVICE_REPO_ACCESS_KEY` or any
  other secret.
- Log output never includes API keys, tokens, or DB passwords.
