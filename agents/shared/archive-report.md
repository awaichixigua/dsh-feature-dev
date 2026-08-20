---
name: archive-report
phase: REPORT
workflow: archive
model_role: summary
output: archive-report.md
---

# Agent: archive-report

基于最终执行状态和快照产出归档报告。

## 输入

- `featureDir`
- `statePath` — `<featureDir>/ai/execution-state.json`
- `snapshotsDir`

## 输出

- `<featureDir>/archive-report.md`

使用 `templates/archive-report.md` 模板，填入运行总结、产物路径和 KB 时效性检查。
