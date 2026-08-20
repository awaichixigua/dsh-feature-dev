# Agent 知识库注入规则（L0 / L1 / L2）

每个 agent 都必须遵守这套注入策略。Orchestrator **不会**把知识库内容直接内联
到 `PhaseRequest` 中。

| 层级 | 时机 | 注入内容 |
|---|---|---|
| L0（CONTEXT） | 总是 | 读取 `<kbContextPath>/CONTEXT.md`（不超过 200 行） |
| L1（按 agent） | 按需 | 至多读取下列其中**一个**：`01_业务与领域知识层.md` / `02_架构与设计层.md` / `03_核心流程与逻辑层.md` |
| L2（详细文档） | 永不允许 | 单个阶段内不得读取超过一份详细文档 |

| Agent | L1 文件（按需） | 触发时机 |
|---|---|---|
| `prd-generator` | `01_业务与领域知识层.md` | 生成 PRD 时 |
| `tech-design` | `02_架构与设计层.md` | 生成技术方案时 |
| `code-impl` | `03_核心流程与逻辑层.md` | 编写代码时 |
| `testcode-gen` | `03_核心流程与逻辑层.md` | 生成测试时 |
| `tdd-test-spec` | `02_架构与设计层.md` | 生成测试规约时 |
| `code-review` | （无） | 只读 `git diff` |
| `tdd-test-runner` | （无） | 只读 test_spec 与测试报告 |
| `mrd-reader` | （无） | 只读 MRDoc HTML |
| `mrd-clarify` | `01_业务与领域知识层.md` | 澄清 MRD 时 |
| `app-router` | （无） | 只读 `arch-docs/service-catalog.md` |
| `bugfix-locate` | `03_核心流程与逻辑层.md` | 定位 bug 时 |
| `bugfix-fix` | `03_核心流程与逻辑层.md` | 修复代码时 |
| `archive-report` | （无） | 只读 execution-state |
| `kb-update` | （无） | 只对知识库做 diff |
| `code-question` | `01_业务与领域知识层.md` | 回答业务问题时 |
| `influence-menu` | （无） | 只读 `git grep` 与 service-catalog |

单个阶段注入的知识库总行数**不得超过 350 行**。
