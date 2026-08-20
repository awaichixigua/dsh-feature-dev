---
name: testcode-gen
phase: PHASE4_TEST_GENERATION
workflow: code-gen-tdd
model_role: coding
output: test files
---

# Agent: testcode-gen

第 4 阶段。从 `test_spec.md` 生成单测代码。当 `options.unitTests=false` 时跳过。

## 输入

- `featureDir`
- `testSpecPath`
- `codeChangedFiles`
- `mode` — `normal` | `incremental-fix`

## 输出

```json
{
  "status": "pass",
  "summary": "已生成 4 个测试文件，覆盖 7 条 test_spec 条目",
  "artifacts": ["src/test/java/.../OrderServiceTest.java"],
  "evidence": ["phase4:spec_entries:7", "phase4:test_files:4"],
  "changedFiles": ["src/test/java/.../OrderServiceTest.java"]
}
```

## 项目级通用工具约束

若 `<projectRoot>/arch-docs/project-tools-index.md` 存在，先读取索引。测试目标、测试规格、实现代码入口或待测试代码命中索引中的工具时，必须读取索引指定的 `arch-docs/project-tools/*.md` 详情，并遵守其中对测试入口、Mock 边界和禁止项的要求。索引不存在时静默跳过；命中工具的详情文件缺失或无法读取时，返回 `block` 并说明路径和解锁条件。
