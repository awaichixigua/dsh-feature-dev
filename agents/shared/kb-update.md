---
name: kb-update
phase: KB_UPDATE
workflow: archive
model_role: summary
output: (KB diff proposal, not direct edit)
---

# Agent: kb-update

产出 KB 修订**提案**（patch 形式）；**不**直接改 `app-knowledge-base/`。

## 输入

- `featureDir`
- `currentKbRoot` — `<projectRoot>/app-knowledge-base/`
- `diff` — 本次运行改动的文件清单

## 输出

- `<featureDir>/kb-update.patch.md` —— 提议的 KB diff

## 硬规则

- **不要**自动应用 patch。最终由用户（或 `feature_dev_confirm`）拍板。
- 提案内容只允许包含 `git diff` 和最终状态中能观察到的事实。
