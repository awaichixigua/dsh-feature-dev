# 测试阶段契约

每一个执行测试的 agent（如 `tdd-test-runner` 等）产出的 `PhaseResult` 必须满足：

- `artifacts` 中必须包含测试报告文件的路径
- `evidence` 中必须包含至少一个：`passed:N`、`failed:N`、`skipped:N`
- `summary` 在归类失败原因时必须使用关键字 `test_defect` 或 `production_defect`，
  Workflow 据此将任务路由到正确的修复阶段

示例：

```json
{
  "status": "block",
  "summary": "production_defect: OrderService.charge returns null on timeout",
  "artifacts": ["req/create-order/ai/unit_test_report.md"],
  "evidence": ["phase5:passed:10", "phase5:failed:2"],
  "changedFiles": [],
  "blocker": "Fix null return in OrderService.charge:142"
}
```

`blocker` 字段在 `status` 为 `block` 和 `failed` 时是**必填**的。
