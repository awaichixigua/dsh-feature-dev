---
name: code-question
description: 在代码库中回答业务逻辑、表关系、状态流转和规则口径问题。触发词：代码问答、查业务逻辑、这个表是干嘛的、状态机是什么。
user-invocable: true
disable-model-invocation: false
argument-hint: <问题文本>
---

# code-question

用于只读查询，不需要需求目录，也不修改业务代码。

```text
/code-question order 表的 status 字段有哪些可能值？
```

调用 `feature_dev_run`：

```json
{
  "workflow": "code-question",
  "projectRoot": "<业务项目根目录>",
  "rawUserRequest": "<用户问题>"
}
```

将工具返回的结论、证据和文件位置直接呈现给用户。失败时报告错误与解除条件；不要自动重试或轮询。
