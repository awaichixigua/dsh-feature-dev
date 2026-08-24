# dsh-feature-dev 发布与安装指南

本文档介绍 `dsh-feature-dev` 插件的四种分发方式，按推荐顺序排列：

| 方式 | 适用场景 | 是否需要 npm 账号 |
| --- | --- | --- |
| 一、本地安装验证 | 在本机 Harness 中实际跑通 `/mrd-to-code` 流程 | 否 |
| 二、GitLab `git+URL` 安装 | 团队内部基于 GitLab 分发，自动构建 + 版本化管理 | 否 |
| 三、打包成 `.tgz` 分发 | 临时一次性发包、不想走 git | 否 |
| 四、发布到 npm | 正式发布、版本化管理、对外分发 | 是 |

> 建议先走 **方式一** 验证插件在 Harness 中能稳定运行；之后再用 **方式二** 在团队内分发；最终要对外开放时再走 **方式四** 发布到 npm。

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

## 方式二：GitLab `git+URL` 安装

适合**公司内部有 GitLab**、不想额外搭 npm 私服的场景。安装命令直接走 git 源，体验和 `github:user/repo` 一样丝滑。

仓库地址（当前）：

```text
http://gitlab.iheatingos.com:8083/engios/dsh-feature-dev.git
```

### 2.1 用户侧安装

```powershell
# 最新版本
dsh plugin --profile web add git+http://gitlab.iheatingos.com:8083/engios/dsh-feature-dev.git

# 指定版本（推荐，便于回滚与回归）
dsh plugin --profile web add git+http://gitlab.iheatingos.com:8083/engios/dsh-feature-dev.git#v0.1.1
```

> 安装时 dsh CLI 会在本地执行 `git clone` → `pnpm install` → 触发 `prepare` 钩子现场编译 `lib/`，最后由 Cordis 加载 `lib/index.js`。

### 2.2 维护者侧一次配置

只需一次，确保 `package.json` 里有以下字段（当前仓库已配置好）：

```json
{
  "name": "@engios/dsh-feature-dev",
  "scripts": {
    "prepare": "pnpm build"
  },
  "repository": {
    "type": "git",
    "url": "http://gitlab.iheatingos.com:8083/engios/dsh-feature-dev.git"
  }
}
```

并保持 `cordis.patch.yml` 中的插件名与 `package.json#name` **严格一致**。

### 2.3 一键发版

```powershell
# 修订号 +1 (0.1.1 → 0.1.2)
pnpm release:patch

# 次版本号 +1 (0.1.1 → 0.2.0)
pnpm release:minor

# 主版本号 +1 (0.1.1 → 1.0.0)
pnpm release:major
```

脚本会自动完成：

1. 检查工作区干净（避免误带脏文件）
2. 更新 `package.json#version`
3. 跑 `pnpm build` + `pnpm test:package`（冒烟测试）
4. `git add package.json` → `git commit`
5. 打 tag（如 `v0.1.2`）→ `git push origin HEAD` + `git push origin v0.1.2`
6. 打印新版本的安装命令

### 2.4 GitLab 私服的坑

| 场景 | 风险 | 怎么避 |
| --- | --- | --- |
| 自建 GitLab 启用了 SSO / 2FA | 匿名克隆 401 | 用 Personal Access Token，URL 写成 `https://oauth2:<TOKEN>@gitlab.iheatingos.com:8083/...`；或配 SSH 部署密钥用 `git+ssh://git@...` 形式 |
| `prepare` 钩子没装 | 拉下来 `lib/` 空，插件加载失败 | 确认 `package.json` 里有 `"prepare": "pnpm build"` |
| 没打 tag | 默认拉 `main` 分支，版本不可控 | 必须用 `pnpm release:*` 或手动 `git tag v0.1.1 && git push origin v0.1.1`，安装时用 `#v0.1.1` 锁版本 |
| 私有仓库 + 公网用户 | 对方克隆被拒 | 仓库设为 group 内可见，或改走 npm 私服（Verdaccio） |

---

## 方式三：打包成 `.tgz` 分发

适合临时一次性发包、不想走 git 的场景。

```powershell
cd D:\ai\dsh-feature-dev

pnpm build
pnpm test:package
pnpm pack
```

把生成的 `.tgz` 文件发给对方，安装命令：

```powershell
dsh plugin --profile web add D:\packages\engios-dsh-feature-dev-0.1.1.tgz
```

> 把路径里的 `engios-dsh-feature-dev-0.1.1.tgz` 替换成实际生成的文件名（pnpm pack 出来的文件名格式是 `<name>-<version>.tgz`）。

---

## 方式四：发布到 npm

### 4.1 发布前准备

发布前需要先处理两件事：

1. **本机尚未登录 npm**，需要执行 `npm login`。
2. **包名已经统一为** `@engios/dsh-feature-dev`，确认下面两个地方保持一致：
   - [`package.json#name`](../../package.json#L2)
   - [`cordis.patch.yml` 第 3 行](../../cordis.patch.yml#L3)

> ⚠️ 两处包名必须保持一致。

### 4.2 执行发布

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

### 4.3 安装已发布的版本

```powershell
dsh plugin --profile web add @engios/dsh-feature-dev@0.1.1
dsh --profile web --dump-config
```

### 4.4 后续版本发布

每次发布都必须先提高版本号，再走一遍构建与发布流程。推荐直接用脚本：

```powershell
# 修订号 +1 (0.1.1 → 0.1.2)
pnpm release:patch

# 然后再发到 npm
npm publish --access public
```

或者手动：

```powershell
npm version patch --no-git-tag-version
pnpm build
pnpm test:package
npm publish --access public
```

用户端更新命令：

```powershell
dsh plugin --profile web add @engios/dsh-feature-dev@latest
```

---

## 总结

按成熟度选路径：

| 阶段 | 推荐方式 | 命令 |
| --- | --- | --- |
| **本机验证** | 方式一：本地安装 | `dsh plugin --profile web add D:\ai\dsh-feature-dev` |
| **团队内分发** | 方式二：GitLab `git+URL` | `dsh plugin --profile web add git+http://gitlab.iheatingos.com:8083/engios/dsh-feature-dev.git#v0.1.1` |
| **临时一次性发包** | 方式三：`.tgz` 分发 | `dsh plugin --profile web add <file>.tgz` |
| **正式对外发布** | 方式四：发布到 npm | `dsh plugin --profile web add @engios/dsh-feature-dev@<version>` |

发版脚本（GitLab + npm 路径都用得上）：

```powershell
pnpm release:patch   # 修订号 +1
pnpm release:minor   # 次版本号 +1
pnpm release:major   # 主版本号 +1
```

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
