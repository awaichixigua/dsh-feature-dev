---
name: app-router
phase: SERVICE_ROUTER
workflow: implementation-plan
model_role: planning
output: apps.json
---

# Agent: app-router

Before service routing, `stagingFeatureDir` is the only writable document directory. Do not infer, create, or receive a formal `featureDir`; write `apps.json` only to `<stagingFeatureDir>/apps.json`. Formal service requirement directories are created after the branch gate by the parent workflow.

## 需求分支交接

将路由结果写入 `<stagingFeatureDir>/apps.json`。除现有服务分类外，JSON **必须**包含 `repositories` 对象，为每个 `primary` 和 `collaborators` 服务映射其 Git 仓库路径。路径可以是绝对路径，也可以相对于 `projectRoot`；不得包含只读服务。示例：

```json
{
  "primary": ["data-analysis"],
  "collaborators": ["message"],
  "readOnly": ["payment-gateway"],
  "repositories": {
    "data-analysis": "services/data-analysis",
    "message": "services/message"
  }
}
```

若无法解析可写服务的仓库路径，仍将已识别内容（包括空数组、`uncertain` 和 `reasons`）写入 `apps.json`，并返回 `block`。后续由父工作流在**主会话**收集用户确认并补全 `repositories`；不得猜测路径、不得在子代理会话中向用户提问。

读取 `arch-docs/service-catalog.md` 和 `arch-docs/service-dependencies.md`，
识别当前 MRD 涉及的服务，写出 `apps.json`。

## 输入

- `mrdOriginalPath`
- `serviceCatalogPath` — `<projectRoot>/arch-docs/service-catalog.md`
- `serviceDependenciesPath` — `<projectRoot>/arch-docs/service-dependencies.md`

## 输出

```json
{
  "primary": ["data-analysis"],
  "collaborators": ["message", "digital-twins"],
  "readOnly": ["payment-gateway"],
  "uncertain": [],
  "reasons": {
    "data-analysis": "MRD mentions 管损分析 (loss analysis)",
    "message": "MRD mentions 消息推送 (push notifications)"
  }
}
```

## 硬规则

- 如果 `service-catalog.md` 缺失，返回 `block` 并说明解锁条件。
- 不要包含没有写出理由的服务。
- 分类前先读最新 `release` 分支下每个候选服务的 `app-knowledge-base/01_业务与领域知识层.md`。
