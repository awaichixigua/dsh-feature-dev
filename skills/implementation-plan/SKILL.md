---
name: implementation-plan
description: 从 MRD 生成 PRD 和技术方案；仅产出文档，不生成业务代码。触发词：生成 PRD、生成技术方案、生成实施方案。
user-invocable: true
disable-model-invocation: false
argument-hint: <MRD URL> --feature-dir <需求目录名> [--clarify-mode=dialogue|batch]
---

# implementation-plan

MRD URL 会先抓取到 `<projectRoot>/.tmp/mrdoc-<sha256(url)[:12]>`。服务路由和需求分支门禁通过后，文档和运行状态才沉淀到 `<主服务仓库>/req/<feature-dir 的目录名>`；随后由主会话在该服务仓库内完成 MRD 澄清，并将其 `app-knowledge-base/` 作为交叉验证知识库。hash 目录保留为原始输入审计记录。

## 需求分支准备

服务路由完成后，工作流会先返回 `post_service_router` 确认门。向用户展示该确认门和选项，要求其核对 `apps.json` 中的 `primary`、`collaborators`、`readOnly` 和 `repositories` 是否覆盖了正确的服务范围。不得自行跳过或确认。用户选择 `accept` 或 `revise` 后，立即使用相同的 `projectRoot` 和 `featureDir` 调用 `feature_dev_resume` 继续工作流；前者会继续准备服务需求分支，后者会重新执行服务路由。若重新路由再次触发确认门，必须再次展示给用户，不能自动确认。

服务路由完成后、生成 PRD 前，工作流会为每个主改和协同服务准备分支。需求目录名必须为 `{版本号}_{需求编号}_{中文需求标题}`，例如 `2.1.10_98532_Engios平台接入应用`。工作流会执行 `git fetch origin --prune`，然后切换到或从 `origin/release` 创建 `fun_{版本号}_{需求编号}_{标题}_{Git 用户名}`；新建分支会通过 `git push -u origin` 发布。

服务路由必须向 `<featureDir>/apps.json` 写入 `repositories` 映射，覆盖所有可写服务。只读服务不会切换分支。若缺少仓库路径、缺少 `origin/release`、`git config user.name` 无效，或工作区存在脏改动，工作流会在写入 PRD 前阻塞。

## 主会话澄清

当工具返回 `pendingMainAction.kind = clarify_mrd` 时，不得启动、恢复或向 `mrd-clarify` 子代理发送消息。主会话必须读取 `mrdOriginalPath`，并在提供了 `knowledgeBasePath` 时按需读取知识库；按 `mode` 直接在主会话向用户提问（`dialogue` 一次一个，`batch` 一次列出全部）。问题关闭后，由主会话把可追溯的最终结论写入 `mrdClarifiedPath`。

写入完成后，立即以工具最新返回的 `featureDir`（即主服务仓库中的正式需求目录，而不是 `.tmp` hash 目录或最初传入的路径）和相同的 `projectRoot` 调用 `feature_dev_resume`。恢复过程只校验 `mrd-clarified.md`，不会再启动澄清子代理；校验通过后直接进入 PRD 阶段。

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

工具返回待确认项时，展示其提示和选项；用户选择后调用 `feature_dev_confirm`。对于 `accept`、`proceed`、`revise`、`continue`、`skip` 或 `update`，确认成功后立即使用工具返回的相同 `projectRoot` 和最新 `featureDir` 调用 `feature_dev_resume`，并向用户报告恢复后的结果；`abort` 不恢复。不要自行跳过确认、自动确认新的确认门或轮询。完成时报告 `runId`、产物和 `statePath`；失败或中止时报告错误与解除条件。
