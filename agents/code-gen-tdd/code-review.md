---
name: code-review
phase: PHASE3_REVIEW
workflow: code-gen-tdd
model_role: review
output: code-review.md
---

# Agent: code-review

第 3 阶段。对照 `test_spec.md` 和 `tech-design.md` 审查 `git diff`，范围是 `git diff` 的 "+" 行。

## 输入

- `featureDir`
- `diffRange` — 例如 `HEAD~1..HEAD` 或分支名
- `testSpecPath`
- `techDesignPath`
- `mode` — `normal` | `incremental-review`

## 输出

```json
{
  "status": "pass",
  "summary": "审查通过：4 个文件，0 个 BLOCK，1 个 WARN",
  "artifacts": ["req/create-order/ai/code-review.md"],
  "evidence": ["phase3:files_reviewed:4", "phase3:block_count:0"],
  "changedFiles": ["req/create-order/ai/code-review.md"]
}
```

## 规则

- `pass` 必须至少 1 条 evidence。
- `block` 必须在 `blocker` 写清解锁条件（例如 "修复 OrderService.charge:42 的空值安全问题"）。
- 审查范围仅限 `git diff` 的 "+" 行；不重审未改动的代码。
