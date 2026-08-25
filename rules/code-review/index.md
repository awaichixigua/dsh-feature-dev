# code-review 规则索引

规则根目录由阶段提示提供，以下路径均相对于该目录。

若本次 diff 包含 Java 代码，审查前必须读取 `library/java/quality-gate.md`；根据改动类型补读：

| 场景 | 必读专题 |
|---|---|
| 命名、异常、日志、并发或对象模型 | `library/java/core-conventions.md` |
| Controller、Service、事务、MyBatis 或数据库表 | `library/java/spring-data.md` |
| Redis、消息队列、OpenFeign、ES、分布式任务 | `library/java/integration.md` |
| 用户输入、文件上传、密钥、日志或 SQL | `library/security.md` |

`inputs.reviewScope.changedFiles` 是唯一允许审查的文件清单。只能对清单内文件执行带路径限制的 diff，并且只对 diff 的新增或修改行提出问题。不得执行全仓搜索、全模块扫描或不带路径限制的质量脚本。存量代码可以作为理解相邻变更的少量上下文，但不得据此发出本阶段的 BLOCK 或 WARN。
