# dsh-feature-dev 用户指南

## 工作原理

`dsh-feature-dev` 以 Cordis Bundle 的形式注册。安装后,在任意对话中输入 `/` 即可发现 skill。

```
/mrd-to-code          端到端 MRD → 归档
/knowledge-base       建立 / 刷新应用知识库
/implementation-plan  从 MRD 生成 PRD + 技术方案
/code-gen-tdd         通过可恢复的 TDD 循环生成代码
/bugfix               修复现有 feature 目录中的 bug
/archive              归档已完成的需求
/prd-clarify          仅做 PRD 澄清
/influence-menu       查看符号的影响面
```

`/bugfix` 会先跑一个只读的 LOCATE 阶段,然后暂停并展示定位证据与修复方向。源码或文档的改动**必须**在用户确认 `proceed` 之后才开始。

## 端到端示例

```text
User: /mrd-to-code https://example.com/share_doc/?token=abc
DSH:  正在阅读 MRD... 在继续之前请先回答 3 个问题。
User: 1) 按次计费, 2) 是幂等的, 3) 美元
DSH:  已写入 <featureDir>/mrd-clarified.md。服务路由:order-svc (主), payment-svc (协作)。
      PRD 草案已生成,请审阅。
User: /confirm pre_prd accept
DSH:  正在生成技术方案... 完成,请审阅。
User: /confirm pre_tech_design proceed
DSH:  正在生成测试规格... 完成,请审阅。
User: /confirm post_test_spec accept
DSH:  正在实现... 审阅... 测试... 全部通过,已归档。
```

## 恢复中断的运行

```text
User: /code-gen-tdd --feature-dir req/create-order --resume
DSH:  从 PHASE2_IMPLEMENTATION 恢复。Run-id: <runId>。
```

## 查看运行状态

```text
User: /status --project-root . --feature-dir req/create-order
DSH:  runId: <runId>, status: running, currentPhase: PHASE4_TEST_GENERATION, repairCount: 0
```

## 提交确认门

```text
User: /confirm --project-root . --feature-dir req/create-order --gate pre_prd --choice accept
DSH:  已处理。0 个待确认项。
```

## 旧 Claude 命令的映射

| 旧 | 新 |
|---|---|
| `/feature-dev:01-knowledge-base` | `/knowledge-base` |
| `/feature-dev:02-implementation-plan` | `/implementation-plan` |
| `/feature-dev:03-code-gen-tdd` | `/code-gen-tdd` |
| `/feature-dev:04-archive` | `/archive` |
| `/feature-dev:bugfix` | `/bugfix` |
| `/feature-dev:prd-clarify` | `/prd-clarify` |
| `/feature-dev:influence-menu` | `/influence-menu` |
| `/feature-dev:fix-beads-duplicates` | (v0.1 中未提供) |

## 触发短语(模型调用)

每个 skill 在其 SKILL.md 中声明哪些自然语言短语会激活它。例如 `mrd-to-code` 会被 "mrd to code"、"全流程"、"一键研发"、"从需求到代码" 等短语触发。

## 隐私

- Bundle 资源是只读的。
- 所有写入都在 `projectRoot` 内。`projectRoot` 之外的文件不会被触碰。
- `execution-state.json` 中永远不包含 `SERVICE_REPO_ACCESS_KEY` 或任何其他密钥。
- 日志输出永远不包含 API key、token 或数据库口令。
