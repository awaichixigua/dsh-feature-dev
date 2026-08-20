---
name: archive
description: 归档已完成需求，生成归档报告并检查知识库新鲜度。触发词：归档、archive、需求完成、收尾、生成需求报告。
user-invocable: true
disable-model-invocation: false
argument-hint: --feature-dir <path>
---

# archive

用于已完成实现的需求收尾。它不修改业务代码。

```text
/archive --feature-dir req/create-order
```

调用 `feature_dev_run`：

```json
{
  "workflow": "archive",
  "projectRoot": "<业务项目根目录>",
  "featureDir": "<需求目录>"
}
```

如果返回待确认项，展示提示与选项，等待用户选择后调用 `feature_dev_confirm`。不要自动恢复或轮询。完成时报告 `archive-report.md`、`runId` 和 `statePath`；失败或中止时报告解除条件。
