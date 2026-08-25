---
name: mrd-to-code
description: 从 MRD 或直接输入的需求完成规划、实现和归档的端到端研发流程；在关键节点等待人工确认。触发词：mrd to code、全流程、一键研发、从 MRD 生成代码、从需求到代码。
user-invocable: true
disable-model-invocation: false
argument-hint: <MRD URL 或需求描述> --feature-dir <path> [--clarify-mode=dialogue|batch]
---

# mrd-to-code

用于从 MRD 或直接输入的需求启动完整需求交付。编排器依次运行实施方案、TDD 实现与归档，并使用一份持久化状态。直接输入需求时，内容会保存为 `mrd-original.md`，不会访问 MRDoc。

`--feature-dir` 必填，使用 `{版本号}_{需求编号}_{中文需求标题}` 形式。MRD 读取或直接需求的来源整理和服务路由会在 `.tmp/<feature-dir 的目录名>` 中暂存，目录由 runtime 管理，不能替代正式需求目录名；既然已提供 `featureDir`，不再使用 MRD URL hash。若服务范围无法自动识别，主会话负责收集服务及仓库路径并写入暂存 `apps.json`；恢复后不重新启动 app-router。

## 启动硬约束

- 用户未传 `--project-root` 时，省略工具参数 `projectRoot`，由 runtime 直接使用当前工作目录。不得为推断项目根目录而执行 Bash、搜索 `req/`、枚举 Git 仓库或检索业务代码，也不得先向用户追问 `projectRoot`。
- 收到需求来源和 `--feature-dir` 后立即调用 `feature_dev_run`。不得在工具调用前定位需求服务或检查已有 `req/`；端到端流程必须先进入 `implementation-plan`，由其中的 `app-router` 完成首次服务识别。
- 只有工具明确返回 `pendingMainAction.kind = route_services` 或服务范围确认门时，主会话才询问服务信息。
- 分支准备完全交给 `implementation-plan` 的门禁；主会话不得创建或推送 `release` 别名分支，也不得在 `feature_dev_resume` 前自行修改服务仓库分支。

```text
/mrd-to-code https://example.com/share_doc/?token=xxx --feature-dir req/create-order
/mrd-to-code "用户可按订单编号查询物流状态，并查看最新节点" --feature-dir req/query-logistics
```

调用 `feature_dev_run`：

```json
{
  "workflow": "mrd-to-code",
  "featureDir": "<需求目录>",
  "mrdUrl": "<MRD URL；与 rawUserRequest 二选一>",
  "rawUserRequest": "<直接输入的需求；与 mrdUrl 二选一>",
  "options": { "clarifyMode": "dialogue 或 batch" }
}
```

仅当用户显式提供 `--project-root` 时，才把该绝对路径作为 `projectRoot` 传入；否则不要构造或补全此字段。

遇到确认门或澄清阻塞时，展示结果并等待用户选择；选择后调用 `feature_dev_confirm`，由用户显式恢复。不要跳过门禁、自动恢复或轮询。完成时报告 `runId`、主要产物和 `statePath`。
