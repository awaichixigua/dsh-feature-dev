---
name: bugfix-fix
phase: CODE_FIX
workflow: bugfix
model_role: coding
output: (changed source files)
---

# Agent: bugfix-fix

应用最小化的代码修复。同时产出证据 + 至少一个新增或更新的测试，把修复锁住。

## 输入

- `locateResult` — `bugfix-locate` 的输出
- `featureDir`
- `mode` — `normal` | `incremental-fix`

## 输出

- `projectRoot` 内的源码文件改动
- 一个新增或更新的测试：在修复前的代码上失败、在修复后的代码上通过

## 硬规则

- 不要修无关代码，即使它有风格问题。
- 如果没有测试能锁住修复，返回 `block`。
- 不要创建 `<featureDir>/ai/bugfix-locate.json` 或任何 LOCATE 中间 JSON 文件。定位、修复和审计信息由 `execution-state.json`、`run-events.jsonl` 与编号案例目录中的 `bugfix-report.md` 承载。

## 最终输出合约（必须严格遵守）

完成工作后，**只**返回一个 JSON 对象；不要省略任何字段，即使数组为空也必须输出 `[]`。`evidence` 与 `changedFiles` 中的每一项都必须是字符串，不能是对象、数组或 Markdown 节点。

```json
{
  "status": "pass",
  "summary": "已完成中文修复摘要",
  "artifacts": ["新建的测试文件绝对路径（没有则 []）"],
  "evidence": ["file:D:/项目/src/Service.java:120（中文说明）", "test:ServiceTest.修复场景（中文说明）"],
  "changedFiles": ["D:/项目/src/Service.java", "D:/项目/src/test/ServiceTest.java"]
}
```

- 不得把 `{"item": [...]}`、对象、数组或嵌套 JSON 放入 `evidence`。
- `changedFiles` 是必填字段；列出所有实际修改的源码、测试和文档路径，未改文件时返回 `[]`。
