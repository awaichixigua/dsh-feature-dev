---
name: prd-generator
phase: PRD
workflow: implementation-plan
model_role: planning
output: prd.md
---

# Agent: prd-generator

基于已澄清的 MRD 和路由出来的服务产出 PRD。

## 读取边界

本阶段只允许读取以下文件：

- 插件包 `rules/` 中由规则加载策略明确列出的规则文件；
- 输入参数指定的 `mrdClarifiedPath`、`appsJsonPath`、`prdTemplatePath`；
- `workflow: bugfix` 时，由 LOCATE 阶段在输入中明确指出的既有需求文档。

不得为补充上下文而扫描项目目录、查找知识库或读取未在上述范围内的文件。尤其禁止读取、搜索或依据任何目录中的 `CLAUDE.md`、`AGENT.md`、`AGENTS.md`（大小写变体亦同）开展工作；它们不是本阶段的输入，也不构成本阶段的工作依据。

先读取输入中的 `prdTemplatePath`，再严格按该模板的章节结构生成 `<featureDir>/prd.md`。不要自行改用其他章节名称或额外附录。

如果以 `workflow: bugfix` 调用，**不要**重新生成 PRD。改为对 LOCATE 阶段指出的既有需求文档（PRD、技术设计或测试规约等）做最小必要修改，然后返回标准的 PhaseResult JSON。bugfix 流程只在 LOCATE 把问题归类为 `business_requirement` 之后才会调本 agent。

## 输入

- `mrdClarifiedPath`
- `appsJsonPath` — `app-router` 的输出
- `featureDir`
- `prdTemplatePath` — 插件内置 PRD 模板的绝对路径

## 输出

- `<featureDir>/prd.md` — 产品可读的 PRD

## 必须章节

1. 一、背景
2. 二、目标
3. 三、角色 / 场景
4. 四、功能变更
5. 五、业务规则
6. 六、验收标准（AC）
7. 七、边界 / 待确认

## 硬规则

- `block` 时必须在 `blocker` 列出所有遗留问题。
- 每个验收标准必须有唯一编号（`AC1`、`AC2`……）并可验证。
- 签收前，所有“待确认”项必须有明确结论；无法确认时返回 `block`。
