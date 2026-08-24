# dsh-feature-dev 发布与安装指南

本文档介绍 `dsh-feature-dev` 插件的三种分发方式，按推荐顺序排列：

| 方式 | 适用场景 | 是否需要 npm 账号 |
| --- | --- | --- |
| 一、本地安装验证 | 在本机 Harness 中实际跑通 `/mrd-to-code` 流程 | 否 |
| 二、打包成 `.tgz` 分发 | 公司暂无 npm 私服，内部小范围传包 | 否 |
| 三、发布到 npm | 正式发布、版本化管理、对外分发 | 是 |

> 建议先走 **方式一** 验证插件在 Harness 中能稳定运行；稳定后再确定 npm scope 并发布到 npm。

---

## 方式一：本地安装验证

目前就可以直接执行。

```powershell
cd D:\ai\dsh-feature-dev

pnpm build
pnpm test:package

dsh plugin --profile web add D:\ai\dsh-feature-dev
dsh --profile web --dump-config
```

如果同时需要 headless：

```powershell
dsh plugin --profile headless add D:\ai\dsh-feature-dev
dsh --profile headless --dump-config
```

重启 Harness 后，在对话框输入：

```text
/mrd-to-code
```

也可以用自然语言调用：

```text
使用 dsh-feature-dev，根据这个 MRD 完成功能开发：https://...
```

---

## 方式二：打包成 `.tgz` 分发

适合公司内部暂时没有 npm 私服的情况。

```powershell
cd D:\ai\dsh-feature-dev

pnpm build
pnpm test:package
pnpm pack
```

把生成的 `.tgz` 文件发给对方，安装命令：

```powershell
dsh plugin --profile web add D:\packages\your-org-dsh-feature-dev-0.1.0.tgz
```

> 把路径里的 `your-org-dsh-feature-dev-0.1.0.tgz` 替换成实际生成的文件名。

---

## 方式三：发布到 npm

### 3.1 发布前准备

发布前需要先处理两件事：

1. **本机尚未登录 npm**，需要执行 `npm login`。
2. **包名还是占位值** `@your-org/dsh-feature-dev`，需要把下面两个地方改成你实际拥有的 npm scope，例如 `@my-company/dsh-feature-dev`：
   - [`package.json` 第 2 行](../../package.json#L2)
   - [`cordis.patch.yml` 第 3 行](../../cordis.patch.yml#L3)

> ⚠️ 两处包名必须保持一致。

### 3.2 执行发布

```powershell
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
```

如果是公司私有 npm 仓库，先配置 `.npmrc`，再发布：

```powershell
npm publish --registry https://你的npm私服地址
```

### 3.3 安装已发布的版本

```powershell
dsh plugin --profile web add @my-company/dsh-feature-dev@0.1.0
dsh --profile web --dump-config
```

> 把 `@my-company/dsh-feature-dev@0.1.0` 替换成你实际的 scope 和版本号。

---

## 后续版本发布

每次发布都必须先提高版本号，再走一遍构建与发布流程：

```powershell
npm version patch --no-git-tag-version
pnpm build
pnpm test:package
npm publish --access public
```

用户端更新命令：

```powershell
dsh plugin --profile web add @my-company/dsh-feature-dev@latest
```

---

## 总结

- **现阶段推荐**：先采用「本地安装」验证实际 Harness 对话调用效果。
- **稳定后**：确定 npm scope，再正式发布到 npm。
- **临时分发**：用 `.tgz` 包内部小范围传递。

---

## 常见问题

### `headless` 是什么？

`headless` 指「不带网页聊天界面的 DeepSeek Harness 运行模式」。

| Profile | 用途 |
| --- | --- |
| `web` | 有聊天页面，用户在对话框输入 `/mrd-to-code` 或自然语言 |
| `headless` | 没有页面，通过命令行、脚本、CI/CD 或自动化任务运行 |

**日常使用建议**：如果只是在 Harness 页面里对话，安装 `web` 就够了：

```powershell
dsh plugin --profile web add D:\ai\dsh-feature-dev
```

**`headless` 适用的场景**：

- 在 CI 中根据 MRD 自动生成代码
- 定时执行知识库更新或归档
- 从其他程序调用 Harness
- 服务器没有图形界面
- 批量处理多个需求

安装到 headless Profile 的命令：

```powershell
dsh plugin --profile headless add D:\ai\dsh-feature-dev
```

> `headless` 不会给插件增加新功能，只是把同一套 Skills 和 Tools 装到另一个运行环境中。
> 如果你目前只需要在网页里跟 Harness 交互，可以先不管 `headless`，只安装 `web`。
