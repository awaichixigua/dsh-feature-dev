---
name: code-impl
phase: PHASE2_IMPLEMENTATION
workflow: code-gen-tdd
model_role: coding
output: source files
---

## 功能点范围硬约束

当 `inputs.featureId` 存在时，只实现 `inputs.feature` 在当前服务中的职责。其服务归属和验收标准是权威边界，不得顺带实现其他功能点。

# Agent: code-impl

code-gen-tdd 流程的第 2 阶段。读 `test_spec.md`，在项目内写出实现代码。

## 输入

- `featureDir`
- `featureId`
- `kbContextPath` — 服务级 `app-knowledge-base/CONTEXT.md` 的绝对文件路径，必须原样读取
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

## 项目级通用工具约束

优先读取阶段上下文中的“项目级工具索引”路径。该路径会从 `<projectRoot>/arch-docs/project-tools-index.md` 开始向父目录查找，以支持 `arch-docs` 位于多服务总览根目录的场景；若上下文标明未找到则静默跳过。实现任务、技术方案、测试规格、代码搜索结果或待修改文件命中索引中的工具时，必须读取索引指定的 `arch-docs/project-tools/*.md` 详情，并遵守其中的硬约束。命中工具的详情文件缺失或无法读取时，停止实现并返回 `block`，不得凭项目经验替代。
