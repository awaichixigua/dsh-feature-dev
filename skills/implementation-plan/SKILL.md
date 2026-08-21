---
name: implementation-plan
description: 从 MRD 生成 PRD 和技术方案；仅产出文档，不生成业务代码。触发词：生成 PRD、生成技术方案、生成实施方案。
user-invocable: true
disable-model-invocation: false
argument-hint: <MRD URL> --feature-dir <path> [--clarify-mode=dialogue|batch]
---

# implementation-plan

## 需求分支准备

服务路由完成后、生成 PRD 前，工作流会为每个主改和协同服务准备分支。需求目录名必须为 `{版本号}_{需求编号}_{中文需求标题}`，例如 `2.1.10_98532_Engios平台接入应用`。工作流会执行 `git fetch origin --prune`，然后切换到或从 `origin/release` 创建 `fun_{版本号}_{需求编号}_{标题}_{Git 用户名}`；新建分支会通过 `git push -u origin` 发布。

服务路由必须向 `<featureDir>/apps.json` 写入 `repositories` 映射，覆盖所有可写服务。只读服务不会切换分支。若缺少仓库路径、缺少 `origin/release`、`git config user.name` 无效，或工作区存在脏改动，工作流会在写入 PRD 前阻塞。

适用于已有 MRD、需要形成可评审 PRD 与技术方案的需求。代码实现使用 `/code-gen-tdd`。

```text
/implementation-plan https://example.com/share_doc/?token=xxx --feature-dir req/create-order
/implementation-plan https://example.com/share_doc/?token=xxx --feature-dir req/create-order --clarify-mode=batch
```

调用 `feature_dev_run`，参数为：

```json
{
  "workflow": "implementation-plan",
  "projectRoot": "<业务项目根目录>",
  "featureDir": "<需求目录>",
  "mrdUrl": "<MRD URL>",
  "options": { "clarifyMode": "dialogue 或 batch" }
}
```

工具返回待确认项时，展示其提示和选项；用户选择后调用 `feature_dev_confirm`。不要自行跳过确认或轮询；需要继续时由用户显式调用 `/resume`。完成时报告 `runId`、产物和 `statePath`；失败或中止时报告错误与解除条件。
