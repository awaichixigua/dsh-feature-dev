# testcode-gen 规则索引

规则根目录由阶段提示提供，以下路径均相对于该目录。

生成或修复测试代码前必须读取：

1. `library/testing/test-first.md`
2. `library/testing/test-code.md`
3. `library/testing/validation.md`

按场景补读：外部依赖、Spring MVC、数据库、消息或 OpenFeign 读取 `library/testing/test-environment.md`；覆盖率不足时读取 `library/testing/coverage.md`。测试只覆盖 `test_spec.md` 中声明的功能点与依赖，不得为了凑覆盖率篡改生产逻辑或删除有效用例。
