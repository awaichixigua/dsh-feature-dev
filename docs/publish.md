方式一：本地安装验证
目前就可以执行：
cd D:\ai\dsh-feature-dev

pnpm build
pnpm test:package

dsh plugin --profile web add D:\ai\dsh-feature-dev
dsh --profile web --dump-config
如果同时需要 headless：
dsh plugin --profile headless add D:\ai\dsh-feature-dev
dsh --profile headless --dump-config
重启 Harness 后，在对话框输入：
/mrd-to-code
也可以自然语言调用：
使用 dsh-feature-dev，根据这个 MRD 完成功能开发：https://...
方式二：打包成 tgz 分发
适合公司内部暂时没有 npm 私服的情况：
cd D:\ai\dsh-feature-dev

pnpm build
pnpm test:package
pnpm pack
然后把生成的 .tgz 文件发给其他人，对方安装：
dsh plugin --profile web add D:\packages\your-org-dsh-feature-dev-0.1.0.tgz
方式三：发布到 npm
当前还需要先处理两件事：
本机尚未登录 npm，需要执行 npm login。
包名还是占位值 @your-org/dsh-feature-dev。
把下面两个地方改成你实际拥有的 npm scope，例如 @my-company/dsh-feature-dev：
[package.json (line 2)](/D:/ai/dsh-feature-dev/package.json:2)
[cordis.patch.yml (line 3)](/D:/ai/dsh-feature-dev/cordis.patch.yml:3)
两处包名必须一致。
然后执行：
cd D:\ai\dsh-feature-dev

npm login
npm whoami

pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
pnpm test:package
pnpm test:scan
pnpm verify:dsh

npm publish --access public
如果是公司私有 npm 仓库，则配置 .npmrc 后发布：
npm publish --registry https://你的npm私服地址
发布完成后安装：
dsh plugin --profile web add @my-company/dsh-feature-dev@0.1.0
dsh --profile web --dump-config
后续版本发布
每次发布都必须提高版本号：
npm version patch --no-git-tag-version
pnpm build
pnpm test:package
npm publish --access public
然后用户更新：
dsh plugin --profile web add @my-company/dsh-feature-dev@latest
目前最适合先采用“本地安装”，验证实际 Harness 对话调用；稳定后再确定 npm scope 并正式发布。


17:39






headless是什么





17:41






headless 指“不带网页聊天界面的 DeepSeek Harness 运行模式”。
简单区分：
Profile	用途
web	有聊天页面，用户在对话框输入 /mrd-to-code 或自然语言
headless	没有页面，通过命令行、脚本、CI/CD 或自动化任务运行

你的日常使用如果只是在 Harness 页面里对话，安装 web 就够了：
dsh plugin --profile web add D:\ai\dsh-feature-dev
headless 更适合这些场景：
在 CI 中根据 MRD 自动生成代码
定时执行知识库更新或归档
从其他程序调用 Harness
服务器没有图形界面
批量处理多个需求
例如安装到 headless Profile：
dsh plugin --profile headless add D:\ai\dsh-feature-dev
它不会给插件增加新功能，只是把同一套 Skills 和 Tools 装到另一个运行环境中。
所以你现在可以暂时不管 headless，只安装 web。