# dsh-feature-dev rules/

Subagents 使用的领域规则。

## 目录与加载约定

执行器在派发子代理时按以下目录生成必读清单：

| 目录 | 作用范围 |
|---|---|
| `common/` | 每个 agent 必读的公共规则；会递归收集全部 `.md` 文件，例如知识库注入、时序预算、错误格式 |
| `<agent-name>/index.md` | 仅同名 agent 必读的规则索引；索引按任务类型选择专题规则 |
| `library/` | 可复用的按需专题规则；不会被自动加载，必须由某个 agent 的 index 指向 |

例如：

| 文件 | 作用范围 |
|---|---|
| `code-impl/index.md` | `code-impl` 的 Java 实现规则路由 |
| `testcode-gen/index.md` | `testcode-gen` 的测试生成规则路由 |
| `tdd-test-runner/index.md` | `tdd-test-runner` 的测试执行规则路由 |
| `library/java/quality-gate.md` | Java 实现与 Review 共用的按需质量门禁 |
| `library/testing/spec-format.md` | 测试规格格式规则 |

## 禁止出现的引用（静态扫描）

`skills/`、`agents/`、`rules/`、`templates/` 下的每个文件都**不得**出现以下 token
（它们是早期 Claude-only 项目残留的痕迹）：

- `$ARGUMENTS` / `${ARGUMENTS}`
- `CLAUDE_PLUGIN_ROOT`
- `$HOME/.claude`
- `/feature-dev:`（作为命令前缀时）
- `/plugin install`
- `/compact`
- `Task tool`
- `TodoWrite`
- `AskUserQuestion`
- `sonnet` / `haiku`（用于指代模型角色时）

以上扫描由 `scripts/scan-claude-keywords.ts` 强制执行。
