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

## 项目级通用工具约束

优先使用阶段上下文中的“项目级工具索引”路径。该路径会从 `<projectRoot>/arch-docs/project-tools-index.md` 开始向父目录查找，以支持 `arch-docs` 位于多服务总览根目录的场景；若上下文标明未找到则静默跳过。找到索引时，必须在生成技术方案前按以下顺序执行：

1. 读取索引，确认工具的触发关键词、详情路径和硬约束摘要。
2. 根据 MRD、PRD、服务范围分析和候选改动判断命中的工具。
3. 对每个命中工具，读取索引指定的 `arch-docs/project-tools/*.md` 详情，并将其中硬约束应用到技术方案、任务拆解、接口契约、测试策略和风险评估。

若命中工具的详情文件缺失或无法读取，返回 `block`，在 `blocker` 中说明文件路径和解锁条件；不得凭经验继续生成技术方案。

## 硬规则

- 不要引入没在设计里登记的全局类型。
- 跨服务依赖必须在 `dependencies:` 段声明。
