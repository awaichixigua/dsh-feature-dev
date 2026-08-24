---
name: bugfix
description: 在已有需求目录中定位并最小化修复缺陷，可按需同步文档和测试。触发词：bugfix、修 bug、修复 bug。
user-invocable: true
disable-model-invocation: false
argument-hint: --feature-dir <path> bug描述：<text> [--auto-comit]
---

# bugfix

适用于已有需求目录中的具体缺陷。保留症状、复现步骤、期望行为及必要的接口或日志上下文；调用前移除密钥、Cookie 和授权信息。

```text
/bugfix --feature-dir req/create-order bug描述：支付失败后订单状态没有回滚
/bugfix --feature-dir req/create-order bug描述：支付失败后订单状态没有回滚 --auto-comit
```

调用 `feature_dev_run`：

```json
{
  "workflow": "bugfix",
  "projectRoot": "<业务项目根目录>",
  "featureDir": "<已有需求目录>",
  "bugDescription": "<脱敏后的缺陷描述>",
  "bugCaseId": "<可选纯数字编号>",
  "options": { "unitTests": false, "autoCommit": true }
}
```

`--auto-comit` 在修复成功后自动执行 `git add --all`、`git commit` 和 `git push`，包括新增文件。`--auto-commit` 为兼容拼写。

工作流先定位，再决定是否修订文档、代码和测试。展示其待确认项或阻塞原因；用户选择后才调用 `feature_dev_confirm`。不要在父对话中手动续跑阶段。完成时报告 `runId`、修复报告和 `statePath`。
