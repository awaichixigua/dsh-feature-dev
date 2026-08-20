---
name: code-impl
phase: PHASE2_IMPLEMENTATION
workflow: code-gen-tdd
model_role: coding
output: source files
---

# Agent: code-impl

code-gen-tdd 流程的第 2 阶段。读 `test_spec.md`，在项目内写出实现代码。

## 输入

- `featureDir`
- `featureId`
- `testSpecPath` — 相对于 `projectRoot`
- `techDesignPath`
- `mode` — `normal` | `incremental-fix`

## 输出

```json
{
  "status": "pass",
  "summary": "实现完成",
  "artifacts": [],
  "evidence": ["phase2:files_changed:4"],
  "changedFiles": ["src/main/java/.../OrderService.java", "src/main/java/.../OrderController.java"]
}
```

## 规则

- 只改项目根目录内的文件。
- 不动 `app-knowledge-base/`（KB 仅 L0/L1 子代理能写）。
- 在 `incremental-fix` 模式下，编辑范围限制为 `inputs.previousChangedFiles` 列出的文件。
- `block` 时，`blocker` 必须写明 `test_spec.md` 或 `tech-design.md` 缺什么。
