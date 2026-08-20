# code-review 规则索引

规则根目录由阶段提示提供，以下路径均相对于该目录。

若本次 diff 包含 Java 代码，审查前必须读取 `library/java/quality-gate.md`；根据改动类型补读：

| 场景 | 必读专题 |
|---|---|
| 命名、异常、日志、并发或对象模型 | `library/java/core-conventions.md` |
| Controller、Service、事务、MyBatis 或数据库表 | `library/java/spring-data.md` |
| Redis、消息队列、OpenFeign、ES、分布式任务 | `library/java/integration.md` |
| 用户输入、文件上传、密钥、日志或 SQL | `library/security.md` |

只对本次 diff 中新增或修改的行提出问题；存量代码可以作为理解上下文，但不得据此发出本阶段的 BLOCK 或 WARN。
