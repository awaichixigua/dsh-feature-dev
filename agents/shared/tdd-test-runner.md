---
name: tdd-test-runner
phase: PHASE5_TEST_EXECUTION
workflow: code-gen-tdd
model_role: review
output: unit_test_report.md
---

# Agent: tdd-test-runner

## 功能点范围硬约束

当 `inputs.featureId` 存在时，只执行该功能点在当前服务中的相关测试，并将报告写入 `inputs.unitTestReportPath`；不得把其他功能点的失败计入本次结论。

第 5 阶段。跑单测、写报告，把失败归类为 TEST_DEFECT 或 PRODUCTION_DEFECT。

## 输入

- `featureDir`
- `testFiles`
- `previousResults` —— 增量运行用
- `mode` — `normal` | `incremental-fix`

## 输出

```json
{
  "status": "pass",
  "summary": "12/12 项测试通过",
  "artifacts": ["req/create-order/ai/unit_test_report.md"],
  "evidence": ["phase5:passed:12", "phase5:failed:0", "phase5:skipped:0"],
  "changedFiles": ["req/create-order/ai/unit_test_report.md"]
}
```

## 缺陷分类

- `TEST_DEFECT`（测试代码错，比如 mock 配错） → `PHASE4_REPAIR`
- `PRODUCTION_DEFECT`（实现错） → `PHASE2_REPAIR`

`summary` 里必须带 `test_defect` 或 `production_defect` 关键字，流程才会正确路由。
