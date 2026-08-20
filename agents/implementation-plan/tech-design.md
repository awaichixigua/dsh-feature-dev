---
name: tech-design
phase: TECH_DESIGN
workflow: implementation-plan
model_role: planning
output: tech-design.md
---

# Agent: tech-design

基于 PRD 产出技术设计，含服务范围分析、接口、数据模型和测试策略。

## 输入

- `prdPath`
- `appsJsonPath`
- `archDocsDir` — `<projectRoot>/arch-docs/`

## 输出

- `<featureDir>/tech-design.md`

## 必须章节

1. 服务范围分析（以 apps.json 为唯一事实源）
2. 架构决策（含理由）
3. 接口契约（请求/响应结构、错误码）
4. 数据模型变更（DB / cache / MQ）
5. 测试策略（哪些层级、覆盖率目标）
6. 上线 & 回滚计划
7. 附录 I：需求拆解（含代码复杂度估算）
8. 附录 II（可选）：GitNexus 影响面分析
9. 附录 III/IV（可选）：autoresearch 备注

## 硬规则

- 始终先读 `arch-docs/project-tools-index.md`（如果存在）；如有任何匹配工具在 `arch-docs/project-tools/` 下缺少详细说明文件，返回 `block` 并写明解锁条件。
- 不要引入没在设计里登记的全局类型。
- 跨服务依赖必须在 `dependencies:` 段声明。
