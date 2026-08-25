---
name: implementation-plan
description: 从 MRD 或直接输入的需求生成 PRD 和技术方案；仅产出文档，不生成业务代码。触发词：生成 PRD、生成技术方案、生成实施方案。
user-invocable: true
disable-model-invocation: false
argument-hint: <MRD URL 或需求描述> --feature-dir <需求目录名> [--clarify-mode=dialogue|batch] [--auto-comit]
---

# implementation-plan

技术方案必须包含“功能点 × 服务”矩阵，并生成 `feature-map.json`：每项功能使用稳定的 `F-xxx` ID，列出所有需要改动的可写服务和验收标准。该文件会与 `prd.md`、`tech-design.md` 一并同步到协作服务目录，供按功能点实现时使用。

`--feature-dir` 是启动 `implementation-plan` 的必填参数，且必须是 `{版本号}_{需求编号}_{中文需求标题}` 形式的正式需求目录名。MRD URL 或直接输入的需求会先暂存在 `<projectRoot>/.tmp/<feature-dir 的目录名>`；这里是来源整理和服务路由的临时运行目录，不代表省略 `featureDir`，也不得在启动前手工创建正式 `req/` 目录。既然已提供 `featureDir`，运行目录不再使用 MRD URL hash。服务路由和需求分支门禁通过后，文档和运行状态才沉淀到 `<主服务仓库>/req/<feature-dir 的目录名>`；随后由主会话在该服务仓库内完成需求澄清，并将其 `app-knowledge-base/` 作为交叉验证知识库。

## 启动硬约束

- 用户未传 `--project-root` 时，省略工具参数 `projectRoot`，由 runtime 直接使用当前工作目录。不得为推断项目根目录而执行 Bash、搜索 `req/`、枚举 Git 仓库或检索业务代码，也不得先向用户追问 `projectRoot`。
- 收到需求来源和 `--feature-dir` 后立即调用 `feature_dev_run`。不得在工具调用前询问或推断主服务、协作服务、只读服务及仓库路径；首次服务识别必须由工作流内的 `app-router` 执行。
- 只有工具明确返回 `pendingMainAction.kind = route_services` 时，主会话才收集服务范围；只有返回 `post_service_router` 确认门时，才让用户核对 app-router 的结果。

## 需求分支准备

服务路由完成后，工作流会先返回 `post_service_router` 确认门。向用户展示该确认门和选项，要求其核对 `apps.json` 中的 `primary`、`collaborators`、`readOnly` 和 `repositories` 是否覆盖了正确的服务范围。不得自行跳过或确认。用户选择 `accept` 或 `revise` 后，立即使用相同的 `projectRoot` 和 `featureDir` 调用 `feature_dev_resume` 继续工作流；前者会继续准备服务需求分支，后者会重新执行服务路由。若重新路由再次触发确认门，必须再次展示给用户，不能自动确认。

服务路由完成后、生成 PRD 前，工作流会为每个主改和协同服务准备分支。需求目录名必须为 `{版本号}_{需求编号}_{中文需求标题}`，例如 `2.1.10_98532_Engios平台接入应用`。工作流会执行 `git fetch origin --prune`；创建新的 `fun_{版本号}_{需求编号}_{标题}_{Git 用户名}` 时，先选择数字版本号最高的 `origin/v*-release`（例如 `v2.2.10-release` 高于 `v2.2.9-release`），不存在任何版本 release 分支时才使用 `origin/master`，然后只推送新建的功能分支。

服务路由必须向 `<featureDir>/apps.json` 写入 `repositories` 映射，覆盖所有可写服务。只读服务不会切换分支。若缺少仓库路径、同时缺少 `origin/v*-release` 与 `origin/master`、`git config user.name` 无效，或工作区存在脏改动，工作流会在写入 PRD 前阻塞。主会话不得创建、推送或要求用户创建名为 `release` 的本地/远程别名分支；门禁失败时只报告原始阻塞原因。

PRD 与技术方案生成后，工作流会将 `prd.md` 和 `tech-design.md` 同步到每个协作服务的 `req/<需求目录名>/`；主服务目录仍保存权威运行状态。

当工具返回 `pendingMainAction.kind = route_services` 时，表示 app-router 无法从 MRD 自动确认服务范围，而不是可跳过的错误。主会话必须读取 `mrdOriginalPath` 和可用的 `routeSnapshot`，直接向用户发起服务范围确认输入，收集 `primary`、`collaborators`、`readOnly` 及每个可写服务的 `repositories` 路径，并写入 `appsPath`。此输入已经是服务范围确认；写入后立即以工具返回的同一 `.tmp` `featureDir` 调用 `feature_dev_resume`。恢复时不会重新启动 app-router，也不会再显示重复确认门，而是直接进入需求分支门禁。

## 主会话澄清

当工具返回 `pendingMainAction.kind = clarify_mrd` 时，不得启动、恢复或向 `mrd-clarify` 子代理发送消息。主会话必须读取 `mrdOriginalPath`，并在提供了 `knowledgeBasePath` 时按需读取知识库；按 `mode` 直接在主会话向用户提问（`dialogue` 一次一个，`batch` 一次列出全部）。问题关闭后，由主会话把可追溯的最终结论写入 `mrdClarifiedPath`。

写入完成后，立即以工具最新返回的 `featureDir`（即主服务仓库中的正式需求目录，而不是 `.tmp` hash 目录或最初传入的路径）和相同的 `projectRoot` 调用 `feature_dev_resume`。恢复过程只校验 `mrd-clarified.md`，不会再启动澄清子代理；校验通过后直接进入 PRD 阶段。

适用于已有 MRD 或可直接描述、需要形成可评审 PRD 与技术方案的需求。直接输入需求时，不会访问 MRDoc；内容会先保存为 `mrd-original.md`，随后沿用相同的服务路由、澄清和文档生成流程。代码实现使用 `/code-gen-tdd`。

```text
/implementation-plan https://example.com/share_doc/?token=xxx --feature-dir req/create-order
/implementation-plan https://example.com/share_doc/?token=xxx --feature-dir req/create-order --clarify-mode=batch
/implementation-plan "用户可按订单编号查询物流状态，并查看最新节点" --feature-dir req/query-logistics
/implementation-plan "用户可按订单编号查询物流状态，并查看最新节点" --feature-dir req/query-logistics --auto-comit
```

调用 `feature_dev_run`，参数为：

```json
{
  "workflow": "implementation-plan",
  "featureDir": "<需求目录>",
  "mrdUrl": "<MRD URL；与 rawUserRequest 二选一>",
  "rawUserRequest": "<直接输入的需求；与 mrdUrl 二选一>",
  "options": { "clarifyMode": "dialogue 或 batch", "autoCommit": true }
}
```

仅当用户显式提供 `--project-root` 时，才把该绝对路径作为 `projectRoot` 传入；否则不要构造或补全此字段。

`--auto-comit` 在工作流成功完成后自动执行 `git add --all`、`git commit` 和 `git push`，因此包括新增文件和删除。`--auto-commit` 可作为兼容拼写。

工具返回待确认项时，展示其提示和选项；用户选择后调用 `feature_dev_confirm`。对于 `accept`、`proceed`、`revise`、`continue`、`skip` 或 `update`，确认成功后立即使用工具返回的相同 `projectRoot` 和最新 `featureDir` 调用 `feature_dev_resume`，并向用户报告恢复后的结果；`abort` 不恢复。不要自行跳过确认、自动确认新的确认门或轮询。完成时报告 `runId`、产物和 `statePath`；失败或中止时报告错误与解除条件。
