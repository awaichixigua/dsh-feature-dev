# 单元测试报告：{{feature_id}}

- 阶段：PHASE5_TEST_EXECUTION
- 执行时间：{{executed_at}}
- 测试框架：{{test_framework}}

## 汇总

- 总数：{{total}}
- 通过：{{passed}}
- 失败：{{failed}}
- 跳过：{{skipped}}
- 缺陷分类：{{defect_class | none}}

## 失败项

### TF-001

- 测试：`{{test_class}}.{{test_method}}`
- 错误：{{error_message}}
- 可能原因：{{analysis}}

### TF-002

- ...

## 覆盖率（如可获得）

- 分支：{{branch_pct}}%
- 行：{{line_pct}}%

## 路由规则

- 若 `defect_class=test_defect` → 下一阶段为 `PHASE4_REPAIR`
- 若 `defect_class=production_defect` → 下一阶段为 `PHASE2_REPAIR`
- 若 `defect_class=none` → 下一阶段为 `PHASE6_SUMMARY`
