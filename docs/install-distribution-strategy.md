# MiniClaw 安装与分发改造建议

> 结论：MiniClaw 1.0 的产品化路径是 GitHub Release + repo installer，而不是直接 npm publish 主 runtime。目标用户先定义为技术用户：能 clone repo、配置 Discord app、运行 pnpm/PM2；产品体验目标是“5 分钟跑起最小 Discord bot，后续再按需开启 cron、provider、Auto Doctor 和私有数据能力”。

## 背景判断

MiniClaw 当前定位是 local-first Discord-native automation hub。它长期运行在用户自己的 Mac 上，通过 Discord 交互，依赖本机 `~/.miniclaw/` 目录保存配置、secrets、provider state、cron state、SQLite DB 和私有数据。

这意味着它和普通 npm library 或云端 SaaS 不同：

- 安装者需要准备 Discord application / bot token / guild / user id。
- 运行环境需要 Node 22、pnpm、可选 PM2。
- Claude Code / Codex provider 可能依赖用户本机登录态、CLI 配置、MCP、skills 和代理。
- 微信、邮箱、股票账户等 provider 都是进阶能力，不应该出现在首次安装的阻塞路径里。
- Deploy 的真实目标不是某个云环境，而是用户本机正在运行的 PM2 app。

所以安装体验要分层：先让新人跑通最小功能，再逐步引导高级能力。

## 目标体验

外部用户的理想路径应该是：

```bash
git clone https://github.com/yuanyunfan/miniclaw.git
cd miniclaw
./install.sh
pnpm run setup
pnpm run doctor:setup
pnpm register
pnpm run build
pm2 start ecosystem.config.cjs
```

更成熟后可以进一步提供一条命令安装：

```bash
curl -fsSL https://raw.githubusercontent.com/yuanyunfan/miniclaw/main/install.sh | bash
```

但在安装器成熟前，不建议把 curl pipe shell 作为主路径。先保留 clone 后执行脚本，便于用户 inspect。

## 推荐改造

### 1. 新增安装器

新增 `install.sh`，负责把“准备开发/运行环境”的步骤自动化。

应该执行：

- 检查 Node 版本是否满足 `>=22`。
- 启用 `corepack` 并准备 repo 声明的 pnpm 版本。
- 运行 `pnpm install --frozen-lockfile`。
- 创建 `~/.miniclaw/`。
- 如果 `~/.miniclaw/config.yaml` 不存在，从 `config.example.yaml` 复制。
- 如果 `.env` 不存在，从 `.env.example` 复制或生成最小模板。
- 可选安装 git hooks。
- 可选提示安装 PM2。
- 运行 `pnpm run build` 做基础验证。

不应该执行：

- 不自动写入真实 token。
- 不自动注册 Discord slash commands，除非用户已经完成配置并明确确认。
- 不自动启动 PM2，除非用户明确选择。
- 不修改用户现有 `~/.miniclaw/config.yaml`，只做缺失文件初始化。

### 2. 新增交互式配置向导

新增 `scripts/setup.ts`，并在 `package.json` 暴露：

```bash
pnpm run setup
```

向导只问最小必要信息：

- Discord Bot Token。
- Discord Client ID。
- Discord Guild ID。
- Allowed User ID。
- 默认 provider：`codex` 或 `claude`。
- 是否启用 Smart Router。
- 是否现在注册 slash commands。
- 是否现在配置 PM2 常驻运行。

输出文件：

- `.env`：只放 secrets 和启动前必须生效的 env。
- `~/.miniclaw/config.yaml`：放结构化配置。

安全要求：

- token 写入前提示目标路径。
- 永远不把 token 写进 repo 内文档或 example 文件。
- 如果 `.env` 已存在，默认不覆盖，先生成 diff-style summary 或备份。
- Discord ID 必须按字符串写入 YAML，避免超大整数被 YAML 解析成不安全 number。

### 3. 新增 setup doctor

新增 `scripts/setup-doctor.ts`，并暴露：

```bash
pnpm run doctor:setup
```

它负责把安装问题变成可读诊断，而不是让用户读 stack trace。

检查项：

- Node / pnpm / PM2 是否可用。
- `pnpm install --frozen-lockfile` 是否能通过。
- `pnpm run build` 是否能通过。
- `.env` 是否存在，关键字段是否为空。
- `~/.miniclaw/config.yaml` 是否存在，Discord ID 是否为字符串。
- `DISCORD_TOKEN`、client id、guild id、allowed user id 是否齐全。
- 当前 provider 的最小配置是否可用。
- slash commands 是否可能需要注册。
- PM2 app 是否已经存在、是否 online、是否 restart loop。

输出格式建议：

```text
MiniClaw Setup Doctor

OK   Node >= 22
OK   pnpm 10.33.0
WARN PM2 not installed; production local run will need pm2
FAIL DISCORD_TOKEN missing in .env

Next:
1. Edit .env and set DISCORD_TOKEN
2. Run pnpm register
3. Run pnpm run build
```

### 4. 重写 README 安装路径

README 应该把安装分成三层，不要把所有 provider 能力堆在 Quick Start 中。

第一层：5 分钟跑起来。

- 安装依赖。
- 创建配置。
- 填 Discord 最小字段。
- 注册 slash commands。
- `pnpm dev` 或 PM2 启动。
- 在 Discord 里测试 `/health` 和 `@MiniClaw hello`。

第二层：本机常驻运行。

- `pnpm run build`
- `pm2 start ecosystem.config.cjs`
- `pnpm safe-restart`
- 查看 `~/.miniclaw/logs/`
- 使用 `/health` 和 `pnpm run doctor`

第三层：高级能力。

- Smart Router。
- task intake channel。
- cron。
- WeChat provider。
- email provider。
- stock provider。
- Auto Doctor。
- Stage。

### 5. 提供 minimal profile

当前 `config.example.yaml` 应该明确拆分为“默认最小可运行”和“高级示例”。

最小 profile 应只覆盖：

```yaml
discord:
  client_id: "your_discord_application_id"
  guild_id: "your_discord_guild_id"
  allowed_user_id: "your_discord_user_id"

routing:
  auto_reply_channels: []
  task_channels: []
  smart_router:
    enabled: false

agent:
  provider: codex
  default_cwd: "~"
  max_concurrent_tasks: 1
```

高级 provider 示例可以留在同一个 example 文件底部注释区，或拆到 `docs/providers/**/*.md`。首次安装不应该要求用户理解微信、邮箱、股票和 cron。

### 6. Release artifact 优先于 npm publish

MiniClaw 1.0 使用 GitHub Release 作为稳定安装和回滚边界，不把当前主 runtime 发布到 npm。

原因：

- MiniClaw 当前是 repo-first local runtime，不是稳定 CLI package。
- 项目现在有最小 `files` whitelist 作为防误发布边界，但还没有稳定 `bin`、`exports`、postinstall、安全沙箱和 npm CLI UX。
- `miniclaw` npm 包名已经存在，直接发布会遇到命名和用户预期问题。
- GitHub Release 更适合附带源码、lockfile、config example、PM2 config 和迁移说明。

推荐 Release 内容：

- `v1.0.0` tag。
- Release notes 从 `CHANGELOG.md` 固化。
- `miniclaw-v1.0.0.tar.gz`。
- 安装说明链接到 README 和本文件。
- Breaking changes / migration notes。
- 是否需要重跑 `pnpm register`。
- 是否有 DB schema / config 变更。

### 7. Docker 不是第一阶段

Docker 可以作为后续选项，但不适合作为第一安装路径。

原因：

- MiniClaw 强依赖本机 `~/.miniclaw/`。
- Codex / Claude Code / MCP / browser / provider 登录态常常依赖宿主机环境。
- Discord bot 长驻可以容器化，但私有 provider、浏览器登录态和本地 CLI 继承会变复杂。

除非后续把 provider state、browser automation、Codex/Claude runtime 继承边界重新设计，否则 Docker-first 会制造比解决更多的问题。

## 分阶段实施

### Phase 1：本机安装体验

交付物：

- `install.sh`
- `pnpm run setup`
- `pnpm run doctor:setup`
- README Quick Start 重写
- `docs/runbooks/install.md` 或本文件扩展为安装 runbook

验收标准：

- 新用户 clone repo 后，不需要读完整 README 就能完成最小 bot 启动。
- 配置缺失时，setup doctor 给出明确 next steps。
- 不会覆盖已有 `.env` 或 `~/.miniclaw/config.yaml`。

### Phase 2：Release 标准化

交付物：

- `.github/workflows/release.yml`
- `CHANGELOG.md` `[Unreleased]` 到版本段落的流程。
- Release artifact。
- Release checklist。

验收标准：

- 每个 release tag 都经过 `pnpm run quality:push`。
- Release notes 明确安装、升级、重启和 slash command 注册要求。
- 用户可以从 GitHub Release 找到稳定版本和回滚点。

### Phase 3：半自动本机 Deploy

交付物：

- `docs/runbooks/local-deploy.md`
- 可选 `scripts/deploy-local.ts`
- deploy 后 health / doctor 检查。

推荐流程：

```bash
git fetch origin
git checkout main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run build
pnpm safe-restart
pnpm run doctor
```

验收标准：

- 不在 active tasks / active chats 存在时强制重启。
- deploy 后能确认 PM2、Discord gateway、cron 和 provider 基础状态。
- 回滚路径清楚。

### Phase 4：再考虑 npm / Docker / self-hosted runner

只有当 Phase 1-3 稳定后，再判断是否需要：

- `create-miniclaw` npm initializer。
- scoped package，例如 `@yuanyunfan/create-miniclaw`。
- 主 runtime package，例如 `@yuanyunfan/miniclaw`。
- Docker image。
- GitHub Actions self-hosted runner + environment approval 的半自动 deploy。

## 不建议现在做的事

- 不建议直接 npm publish 当前 repo。
- 不建议把 push to main 直接绑定到自动 PM2 restart。
- 不建议把所有 provider 配置塞进 Quick Start。
- 不建议安装器自动创建 Discord application，因为这涉及浏览器登录、权限和账号上下文。
- 不建议安装器修改或覆盖用户已有 `~/.miniclaw` 状态。

## 最小改动清单

如果只做一个最小闭环，优先顺序是：

1. 新增 `install.sh`。
2. 新增 `scripts/setup.ts` 并挂到 `pnpm run setup`。
3. 新增 `scripts/setup-doctor.ts` 并挂到 `pnpm run doctor:setup`。
4. 精简 README Quick Start。
5. 增加 GitHub Release workflow。

这条路径比先做 Deploy 更直接提升外部用户安装成功率，也比 npm / Docker 更符合 MiniClaw 当前 local-first 架构。
