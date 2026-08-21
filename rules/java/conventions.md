# Java / Spring Boot 编码规范

当项目配置 `tech_stack=java-spring-boot` 时，由 `code-impl` 和 `testcode-gen` 使用。

## 分层

```
controller/  → service/  → repository/  → entity/
   (HTTP)      (逻辑)      (JPA)         (JPA 实体)
```

- Controller：保持薄，只委托给一个 service 方法。
- Service：业务逻辑；以方法边界作为事务边界。
- Repository：继承 `JpaRepository`；不写业务逻辑。
- Entity：JPA 映射的实体，不写逻辑。

## 测试规范

- JUnit 5 + Mockito。
- 一个 service 对应一个测试类。
- 方法命名：`methodName_condition_expectedResult`。
- 覆盖率目标：新增代码的 branch 覆盖率 ≥ 80%。

## 代码风格

- 4 空格缩进。
- DTO 使用 record（`public record OrderDto(...)`）。
- 可空返回值使用 `Optional`；公共 API 禁止返回 `null`。
- 日志：状态流转用 SLF4J 的 INFO，热路径用 DEBUG。

## 禁止

- Controller 直接访问 Repository。
- `System.out.println`。
- 字段注入（必须用构造器注入）。
- 硬编码的密钥。
- 测试中使用 `Thread.sleep`。
