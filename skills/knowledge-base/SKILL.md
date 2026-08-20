---
name: knowledge-base
description: 建立或刷新业务项目的 app-knowledge-base 文档。触发词：知识库、KB 梳理、建立知识库、刷新知识库。
user-invocable: true
disable-model-invocation: false
argument-hint: [--project-root <path>] [--service <name>]
---

# knowledge-base

用于在规划或实现前建立项目上下文与知识库；可按服务范围运行。

```text
/knowledge-base --project-root .
/knowledge-base --project-root . --service order
```

调用 `feature_dev_run`：

```json
{
  "workflow": "knowledge-base",
  "projectRoot": "<业务项目根目录>",
  "rawUserRequest": "<可选的服务范围或用户要求>"
}
```

完成时报告知识库位置、`runId` 和 `statePath`；失败时报告错误与解除条件。不要自动重试或轮询。
