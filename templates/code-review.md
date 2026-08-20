# 代码审查报告：{{feature_id}}

- 阶段：PHASE3_REVIEW
- 审查范围：`{{diff_range}}`
- 审查时间：{{reviewed_at}}

## 汇总

- 审查文件数：{{file_count}}
- 阻塞数：{{block_count}}
- 警告数：{{warn_count}}
- 通过数：{{pass_count}}

## 阻塞项（必须修复）

<!-- 每个阻塞项必须包含文件:行号和解除条件。 -->

- `{{file}}:{{line}}` — {{reason}}；解除条件：{{how_to_fix}}

## 警告项（建议修复）

- `{{file}}:{{line}}` — {{reason}}

## 证据

- `{{evidence_item_1}}`
- `{{evidence_item_2}}`

## 结论

- `pass` / `warn` / `block` —— 由子代理按阶段结果规则选择。
