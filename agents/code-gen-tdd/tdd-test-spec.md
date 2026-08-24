---
name: tdd-test-spec
phase: PHASE1_TEST_SPEC
workflow: code-gen-tdd
model_role: planning
output: test_spec.md
---

<!-- When inputs.featureId is present, implement only inputs.feature in the
current service. Write the specification to inputs.testSpecPath; never overwrite
another feature's test specification. -->

# Agent: tdd-test-spec

code-gen-tdd 的第 1 阶段。吃 `<featureDir>/tech-design.md`，产出 `<featureDir>/ai/test_spec.md`。

先读取输入中的 `testSpecTemplatePath`，再严格按该模板生成测试规格；不得自行缩减章节或改用其他模板。

## 输入（PhaseRequest.inputs）

- `featureDir` —— feature 目录（例如 `req/create-order`）
- `featureId` —— 可选，例如 `F-001`
- `techDesign` —— `tech-design.md` 的文本内容
- `kbContextPath` —— 服务级 `app-knowledge-base/CONTEXT.md` 的绝对路径（按需读，不要内联）；必须使用该路径，**不得**因项目级 `arch-docs` 位于父目录而改到父目录查找 KB
- `testSpecTemplatePath` —— 插件内置测试规格模板的绝对路径

## 输出（PhaseResult）

```json
{
  "status": "pass",
  "summary": "已生成 F-001 的测试规格",
  "artifacts": ["req/create-order/ai/test_spec.md"],
  "evidence": ["phase1:contract_signatures_count:5"],
  "changedFiles": ["req/create-order/ai/test_spec.md"]
}
```

## 规则

- 不动实现代码；只动 `test_spec.md`。
- 用 `kbContextPath` 按需读 L0 的 CONTEXT.md；不要把整个 KB 内联进来。
- `pass` 至少要 1 条 evidence。
- `block` 时 `blocker` 必须写明解锁条件。

## 项目级通用工具约束

优先读取阶段上下文中的“项目级工具索引”路径。该路径会从 `<projectRoot>/arch-docs/project-tools-index.md` 开始向父目录查找，以支持 `arch-docs` 位于多服务总览根目录的场景；若上下文标明未找到则静默跳过。需求、技术方案或测试规格命中索引中的工具时，必须读取索引指定的 `arch-docs/project-tools/*.md` 详情，并把硬约束落实到测试入口、验收点和禁止项。命中工具的详情文件缺失或无法读取时，返回 `block` 并说明路径和解锁条件。
