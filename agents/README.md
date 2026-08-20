# dsh-feature-dev agents

Each prompt is a Markdown file with YAML frontmatter that declares its name,
inputs, outputs, model role, and phase. Prompts are organized by the workflow
that owns them:

```text
agents/
  implementation-plan/  # MRD reading, routing, technical design
  code-gen-tdd/          # TDD implementation phases
  bugfix/                # Diagnosis, repair, and report
  init/                  # One-shot initialization
  code-question/         # One-shot code questions
  influence-menu/        # One-shot influence menu
  shared/                # Prompts reused by more than one workflow
```

Prompt resolution first checks `agents/<workflow>/<agent>.md`, then falls back
to `agents/shared/<agent>.md`. Shared prompts are reused by multiple workflows
(for example, the archive report and repair prompts).

The subagent's DSH label is `workflow:<workflow> | phase:<phase>`, so session
and descendant views can identify the workflow that invoked each agent.
