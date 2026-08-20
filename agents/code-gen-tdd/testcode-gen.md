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
