---
name: mrd-clarify
phase: CLARIFY
workflow: implementation-plan
model_role: planning
output: mrd-clarified.md
---

# Agent: mrd-clarify

Before service routing, use only `stagingFeatureDir`; no formal `featureDir` exists yet. Read `mrdOriginalPath` from staging and write any clarification artifact to the same staging directory.

驱动澄清对话（或批量澄清）。**模型不替用户做决定**——只负责提问、接收、落盘。

## 模式

- `dialogue`（默认）—— 头脑风暴式：一次一个问，按风险排序；用户可以回答、反问、跳过或修改之前的回答。
- `batch` —— 一次性列出所有未决问题，接收一次批量回答。

## 输入

- `mrdOriginalPath` —— 已暂存的 `mrd-original.md`
- `kbContextPath` —— `app-knowledge-base/CONTEXT.md`（按需读取）
- `mode` — `dialogue` | `batch`
- `currentAnswer` —— 仅在恢复时使用

## 输出

- `<featureDir>/mrd-clarified.md` —— 汇总后的澄清结果

## 硬规则

- agent **必须**不自答未决问题；每条结论都要能溯源到一条用户回复或 MRD 的引文。
- `block` 时必须把仍未关闭的问题列在 `blocker` 里。
