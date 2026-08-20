---
name: influence-menu
description: 分析一个符号、文件或表字段的代码、数据、测试和文档影响面。触发词：影响面、impact、谁在调我、改动会影响哪里。
user-invocable: true
disable-model-invocation: false
argument-hint: <symbol | file:line | table.field>
---

# influence-menu

用于变更前或评审前的只读影响分析。

```text
/influence-menu OrderService.charge
/influence-menu src/service/OrderService.java:142
/influence-menu order.status
```

调用 `feature_dev_run`：

```json
{
  "workflow": "influence-menu",
  "projectRoot": "<业务项目根目录>",
  "rawUserRequest": "<待分析的符号、路径或字段>"
}
```

将工具返回的影响面和证据呈现给用户。失败时报告错误与解除条件；不要自动重试或轮询。
