# 测试阶段 PhaseResult 契约

测试执行 Agent 产出的 `PhaseResult` 必须满足：

- `artifacts` 包含测试报告文件路径。
- `evidence` 至少包含 `passed:N`、`failed:N` 或 `skipped:N` 之一。
- 失败归类时，`summary` 使用小写关键字 `test_defect` 或 `production_defect`，以便 Workflow 路由。
- `status` 为 `block` 或 `failed` 时提供能解除阻塞的 `blocker`。

示例：

```json
{
  "status": "block",
  "summary": "production_defect: OrderService.charge 的超时分支返回空值",
  "artifacts": ["req/create-order/ai/unit_test_report.md"],
  "evidence": ["phase5:passed:10", "phase5:failed:2"],
  "changedFiles": [],
  "blocker": "修复 OrderService.charge:142 的空值返回后重新执行测试"
}
```
