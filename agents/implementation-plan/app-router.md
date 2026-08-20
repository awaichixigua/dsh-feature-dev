---
name: app-router
phase: SERVICE_ROUTER
workflow: implementation-plan
model_role: planning
output: apps.json
---

# Agent: app-router

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
