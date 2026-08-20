# 工具错误格式

所有 `feature_dev_*` 工具在出错时都返回如下统一结构：

```json
{
  "ok": false,
  "error": {
    "code": "E_VALIDATION",
    "message": "人类可读的描述",
    "details": { ... 可选 ... }
  }
}
```

| 错误码 | 类别 | 触发场景 |
|---|---|---|
| `E_VALIDATION` | input | 参数错误、缺少必填字段、互斥冲突 |
| `E_NOT_FOUND` | state | featureDir 不存在、缺少 execution-state.json |
| `E_FORBIDDEN` | policy | 路径越权、命中禁止的路径片段 |
| `E_CONFLICT` | state | execution-state.json 已存在、运行已完成 |
| `E_STATE_MACHINE` | state | 非法的阶段流转 |
| `E_GATE` | gate | 闸门当前状态无法升起 / 解除 |
| `E_DSH_COMPAT` | runtime | DSH peer 依赖版本不匹配 |
| `E_EXECUTOR` | runtime | subagent 调用失败 |
| `E_INTERNAL` | runtime | 未归类错误 |

模型和用户在收到 `E_FORBIDDEN`、`E_CONFLICT`、`E_STATE_MACHINE` 时**不应**直接重试，
应先修复根因。
