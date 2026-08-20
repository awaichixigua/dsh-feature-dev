# 时序与预算

各阶段的耗时与资源预算。Workflow 用它来设定阶段预算。

| 阶段 | 最大耗时（秒） | 最大 token | 最大工具调用次数 |
|---|---|---|---|
| `mrd-reader` | 120 | 8k | 6 |
| `mrd-clarify` | 600（对话） / 300（批量） | 12k | 8 |
| `app-router` | 60 | 4k | 4 |
| `prd-generator` | 600 | 24k | 12 |
| `tech-design` | 900 | 32k | 16 |
| `tdd-test-spec` | 300 | 12k | 8 |
| `code-impl` | 1200 | 64k | 30 |
| `code-review` | 300 | 16k | 12 |
| `testcode-gen` | 600 | 32k | 16 |
| `tdd-test-runner` | 900 | 8k | 8 |
| `archive-report` | 120 | 4k | 4 |
| `kb-update` | 300 | 12k | 8 |
| `bugfix-locate` | 300 | 12k | 8 |
| `bugfix-fix` | 900 | 32k | 20 |
| `influence-menu` | 300 | 16k | 10 |

如果某个阶段超过预算，Workflow Core 会把该阶段标记为 `warn` 并继续执行。
如果超过预算的 2 倍，Workflow Core 会把该阶段标记为 `block` 并路由到对应的
修复阶段。
