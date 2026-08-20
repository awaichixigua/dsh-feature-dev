---
name: mrd-to-code
description: 从 MRD 开始完成规划、实现和归档的端到端研发流程；在关键节点等待人工确认。触发词：mrd to code、全流程、一键研发、从 MRD 生成代码、从需求到代码。
user-invocable: true
disable-model-invocation: false
argument-hint: <MRD URL> --feature-dir <path> [--clarify-mode=dialogue|batch]
---

# mrd-to-code

用于从 MRD 启动完整需求交付。编排器依次运行实施方案、TDD 实现与归档，并使用一份持久化状态。

```text
/mrd-to-code https://example.com/share_doc/?token=xxx --feature-dir req/create-order
```

调用 `feature_dev_run`：

```json
{
  "workflow": "mrd-to-code",
  "projectRoot": "<业务项目根目录>",
  "featureDir": "<需求目录>",
  "mrdUrl": "<MRD URL>",
  "options": { "clarifyMode": "dialogue 或 batch" }
}
```

遇到确认门或澄清阻塞时，展示结果并等待用户选择；选择后调用 `feature_dev_confirm`，由用户显式恢复。不要跳过门禁、自动恢复或轮询。完成时报告 `runId`、主要产物和 `statePath`。
