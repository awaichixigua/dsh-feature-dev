---
name: code-gen-tdd
description: 基于已确认的技术方案生成代码，并执行可恢复的 TDD 验证循环。触发词：生成代码、写代码、TDD、实现 F-xxx。
user-invocable: true
disable-model-invocation: false
argument-hint: --feature-dir <path> [--feature-id F-001] [--skip-unit-tests=false]
---

# code-gen-tdd

适用于已有 `tech-design.md` 的需求实现。工作流会自行处理测试规格、实现、审查、测试生成与执行；不要绕开它直接开始实现。

```text
/code-gen-tdd --feature-dir req/create-order
/code-gen-tdd --feature-dir req/create-order --feature-id F-001
/code-gen-tdd --feature-dir req/create-order --skip-unit-tests=false
```

调用 `feature_dev_run`：

```json
{
  "workflow": "code-gen-tdd",
  "projectRoot": "<业务项目根目录>",
  "featureDir": "<需求目录>",
  "featureId": "<可选功能 ID>",
  "options": { "skipUnitTests": true }
}
```

默认跳过单元测试的生成和执行。只有显式传入 `--skip-unit-tests=false` 时才执行单测。
当且仅当用户提供该参数时，才将工具调用中的 `options.skipUnitTests` 设为 `false`；其他情况必须为 `true` 或省略。

工具返回确认门时先展示给用户，并在其选择后调用 `feature_dev_confirm`。不要自动确认、自动恢复或轮询。完成时报告 `runId`、产物和 `statePath`；失败或中止时报告错误与解除条件。
