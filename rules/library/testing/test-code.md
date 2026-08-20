# Java 测试代码生成规范

- 测试代码以 `test_spec.md` 为边界，逐条覆盖其中可执行的用例和关键断言。
- 默认使用 JUnit 5 与 Mockito；Service 测试使用 `MockitoExtension`，HTTP 入口使用 standalone MockMvc。
- 每个 Service 对应独立测试类；测试名采用 `methodName_condition_expectedResult` 或项目既有等价命名。
- 外部依赖使用 `@Mock`、stub 或项目既有测试替身；禁止连接真实生产服务、真实消息队列或共享数据库。
- 每个测试只验证一个清晰行为，断言返回值、状态变化、异常或关键交互；禁止只断言不抛异常。
- 禁止 `Thread.sleep`、随机且不可复现的数据、依赖用例执行顺序或修改无关生产代码。
