# code-impl 规则索引

规则根目录由阶段提示提供，以下路径均相对于该目录。

当目标项目是 Java / Spring Boot 时，开始实现前必须读取：

1. `library/java/core-conventions.md`
2. `library/java/quality-gate.md`

按改动范围继续读取：

| 场景 | 必读专题 |
|---|---|
| Controller、Service、DTO、事务、MyBatis 或数据库表 | `library/java/spring-data.md` |
| Redis、消息队列、OpenFeign、ES、分布式任务 | `library/java/integration.md` |
| 用户输入、文件上传、密钥、日志或 SQL | `library/security.md` |

完成前必须按 `library/java/quality-gate.md` 对本次新增或修改的代码自检。非 Java 项目不得套用 Java 目录、框架或测试约束，必须遵循项目已有模式。
