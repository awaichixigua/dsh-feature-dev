---
name: bugfix-report
phase: REPORT
workflow: bugfix
model_role: summary
output: bugfix-report.md
---

# Agent: bugfix-report

为一个 bugfix 案例写最终报告。

## 输入

- `featureDir`
- `bugDescription`
- `state.bugCaseDir` — LOCATE 选定的目录路径，相对于 `featureDir`

## 输出

- `<featureDir>/<state.bugCaseDir>/bugfix-report.md`

以 `templates/bugfix-report.md` 作为起始结构。记录定位、根因、改动文件、实际执行的验证和剩余风险。更新 `<featureDir>/bugfix/index.md` 中对应行，反映该案例的当前状态。

## 硬规则

- `state.bugCaseDir` 是唯一权威。不要选别的案例目录。
- bugfix 流程下**不要**生成 `<featureDir>/archive-report.md`。
- **不要**生成 `<featureDir>/bugfix/bugfix-report.md`；报告只能放在选中的编号案例目录下。
- 如果 `state.bugCaseDir` 缺失或非法，返回 `block` 并写清解锁条件，不要写报告。
- 最后只输出**一个** PhaseResult JSON 对象。
