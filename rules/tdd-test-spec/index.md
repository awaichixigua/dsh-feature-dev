# tdd-test-spec 规则索引

规则根目录由阶段提示提供，以下 `library/...` 路径均相对于规则根目录（`<rulesRoot>/library/...`），**不得**相对于本 index 所在的 `tdd-test-spec/` 目录解析。

生成或补充测试规格前必须读取：

1. `library/testing/test-first.md`
2. `library/testing/spec-format.md`
3. `library/testing/coverage.md`

涉及外部依赖、Spring MVC、数据库、消息或 OpenFeign 时，再读取 `library/testing/test-environment.md`。测试规格的章节结构以阶段输入中的 `testSpecTemplatePath` 为唯一模板来源；专题规则只能补充质量要求，不得创造第二套模板。
