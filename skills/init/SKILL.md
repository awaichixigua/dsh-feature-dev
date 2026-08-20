---
name: init
description: 可选地创建项目知识库时效标记。触发词：初始化、init、初始化项目。
user-invocable: true
disable-model-invocation: false
argument-hint: [--project-root <path>]
---

# init

`init` 是可选的一次性准备工作，不是后续工作流的前置条件。它只创建知识库时效标记；不会生成项目配置文件或业务目录。

```text
/init --project-root .
```

调用 `feature_dev_run`：

```json
{
  "workflow": "init",
  "projectRoot": "<业务项目根目录>"
}
```

完成时报告 `app-knowledge-base/KB_FRESHNESS.md`、`runId` 和 `statePath`。若失败，报告错误与解除条件；不要自行重试。
