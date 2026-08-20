---
name: prd-clarify
description: 对已有 MRD 进行独立需求澄清，不生成 PRD 或技术方案。触发词：澄清需求、问几个问题、需求澄清、PRD 澄清。
user-invocable: true
disable-model-invocation: false
argument-hint: --feature-dir <path> [--clarify-mode=dialogue|batch]
---

# prd-clarify

用于已有 `mrd-original.md` 的预澄清，输出可供实施方案流程使用的澄清结论。

```text
/prd-clarify --feature-dir req/create-order
/prd-clarify --feature-dir req/create-order --clarify-mode=batch
```

调用 `feature_dev_run`：

```json
{
  "workflow": "prd-clarify",
  "projectRoot": "<业务项目根目录>",
  "featureDir": "<需求目录>",
  "options": { "clarifyMode": "dialogue 或 batch" }
}
```

若工具返回待澄清问题或阻塞原因，原样向用户说明并等待其输入。不要代替用户决定未确认事项，也不要自动恢复或轮询。
