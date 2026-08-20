# dsh-feature-dev agents

每个提示词都是带 YAML frontmatter 的 Markdown 文件，用于声明其名称、输入、输出、模型角色和所属阶段。提示词按其主要归属的 workflow 分类存放。

```text
agents/
  implementation-plan/  # MRD 阅读、服务路由与技术设计
  code-gen-tdd/          # TDD 代码开发阶段
  bugfix/                # 缺陷定位、修复与报告
  influence-menu/        # 单次影响面分析
  shared/                # 被多个 workflow 共用的提示词
```

解析提示词时，系统会优先读取 `agents/<workflow>/<agent>.md`；若不存在，再回退读取 `agents/shared/<agent>.md`。

## shared 子 agent 的复用关系

| 子 agent | 共用的 workflow 与阶段 |
| --- | --- |
| `archive-report` | `code-gen-tdd` / `PHASE6_SUMMARY`；`archive` / `SNAPSHOT`、`REPORT` |
| `bugfix-fix` | `bugfix` / `CODE_FIX`；`code-gen-tdd` / `PHASE2_REPAIR` |
| `kb-update` | `archive` / `FRESHNESS_CHECK`、`KB_UPDATE`；`knowledge-base` 单次 workflow |
| `mrd-clarify` | `implementation-plan` / `CLARIFY`；`prd-clarify` 单次 workflow |
| `prd-generator` | `implementation-plan` / `PRD`；`bugfix` / `DOC_REVISION` |
| `tdd-test-runner` | `code-gen-tdd` / `PHASE5_TEST_EXECUTION`；`bugfix` / `VERIFY` |

DSH 子 agent 的标签格式为 `workflow:<workflow> | phase:<phase>`，因此可在 session 与子 agent 视图中识别其实际调用来源。
