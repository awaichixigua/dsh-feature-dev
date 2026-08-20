# bugfix-fix 规则索引

规则根目录由阶段提示提供，以下路径均相对于该目录。

若修复目标是 Java / Spring Boot，先读取 `library/java/core-conventions.md` 与 `library/java/quality-gate.md`。涉及 Controller、事务、数据库或 MyBatis 时补读 `library/java/spring-data.md`；涉及安全、日志、输入校验或 SQL 时补读 `library/security.md`。

修复范围只限缺陷报告定位的代码及为恢复编译、测试所需的直接依赖；不得把规则加载变成无关重构。
