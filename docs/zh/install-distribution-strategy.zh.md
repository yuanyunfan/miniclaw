---
doc_id: install-distribution-strategy
lang: zh
translation_of: docs/install-distribution-strategy.md
translation_status: current
source_sha256: 6fcff18ae4e196c8e8c40ecfafadf64bd85b0c5cdb71626d494a2305e402763e
---
# MiniClaw Install And Distribution Strategy

> 结论：MiniClaw 1.0 应使用 GitHub Releases 加 repo installer 作为稳定分发路径，暂时不应定位为直接 public npm runtime。目标用户是 technical user：能 clone repo、创建 Discord application、配置 credentials、运行 `pnpm`，并维护本地 PM2 常驻进程。

## Product Boundary

MiniClaw 是 local-first、Discord-native integration hub。它运行在用户自己的 Mac 上，通过 Discord 交互，并把 configuration、secrets、cron state、SQLite state、provider sessions 和 logs 存在 `~/.miniclaw/`。

这使它不同于普通 npm library 或 cloud SaaS：

- 安装需要本地环境检查。
- runtime 需要 Node 22、pnpm，可选 PM2。
- Claude、Codex、MCP、proxy 和 CLI configuration 可能已经存在于用户机器上。
- WeChat、email、stock 等 account-backed providers 是渐进能力，不应阻塞 first run。
- deployment 指本地 long-running PM2 app，而不是 cloud service。

安装体验应该分层：先跑通 minimal bot，再按需启用 cron、providers、Auto Doctor 和 private-data capabilities。

## Target First-Run Flow

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

后续可以引入 one-line install command：

```bash
curl -fsSL https://raw.githubusercontent.com/yuanyunfan/miniclaw/main/install.sh | bash
```

在 installer 更成熟前，clone-and-review path 仍应作为默认文档路径，因为用户可以先检查脚本再执行。

## Installer Requirements

`install.sh` 只应自动化环境准备。

它应该：

- 检查 `node >= 22`
- 启用 `corepack`
- 准备 repo 声明的 pnpm 版本
- 运行 `pnpm install --frozen-lockfile`
- 创建 `~/.miniclaw/`
- 仅在缺失时复制 `config.example.yaml` 到 `~/.miniclaw/config.yaml`
- 仅在缺失时创建 minimal `.env`
- 可选安装 Git hooks
- PM2 缺失时给出提示
- 运行 `pnpm run build` 做基础验证

它不应该：

- 自动写入真实 tokens
- 覆盖已有 `~/.miniclaw/config.yaml`
- 未经明确确认就注册 Discord slash commands
- 未经明确确认就启动 PM2
- 把 provider account setup 放入 first-run blocker path

## Setup Wizard

`pnpm run setup` 只应收集最小必要数据：

- Discord bot token
- Discord client ID
- Discord guild ID
- allowed user ID
- default runtime：`codex` 或 `claude`
- 是否启用 Smart Router
- 是否现在注册 slash commands
- 是否配置 PM2

输出目标：

- `.env` 保存 secrets 和 early process environment
- `~/.miniclaw/config.yaml` 保存 structured configuration

安全规则：

- 写入前展示 target path
- 永远不要把 token 写进 repo examples
- 默认不覆盖 `.env`
- 修改已有文件前 backup 或展示 diff
- Discord IDs 必须作为字符串写入 YAML，避免大整数被 unsafe number coercion

## Setup Doctor

`pnpm run doctor:setup` 应把安装失败转换成可读 diagnostics。

检查项应包括：

- Node、pnpm 和可选 PM2 是否可用
- `pnpm install --frozen-lockfile`
- `pnpm run build`
- `.env` 是否存在且 required keys 是否存在
- `~/.miniclaw/config.yaml` 是否存在，以及 Discord ID 是否按字符串处理
- Discord token、client ID、guild ID、allowed user ID 是否存在
- slash command registration status
- PM2 app 是否存在、online、是否 restart loop

示例输出：

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

## README Installation Layers

README installation docs 应保持分层：

1. 五分钟本地 bot：
   - install dependencies
   - create config
   - fill minimum Discord fields
   - register slash commands
   - run `pnpm dev` or PM2
   - test `/health` and `@MiniClaw hello`
2. durable local runtime：
   - `pnpm run build`
   - `pm2 start ecosystem.config.cjs`
   - `pnpm safe-restart`
   - inspect `~/.miniclaw/logs/`
   - use `/health` and `pnpm run doctor`
3. advanced capabilities：
   - Smart Router
   - task intake channels
   - cron jobs
   - WeChat provider
   - email provider
   - stock providers
   - Auto Doctor
   - Stage and Ralph experiments

## Config Example Shape

`config.example.yaml` 应把 minimal runnable config 和 advanced examples 分开。

minimal profile：

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

runtime:
  default_agent: codex

tasks:
  default_cwd: "~"
  max_concurrent_tasks: 1
```

advanced provider 和 cron examples 应放在后续注释区或 `docs/providers/**/*.md`，不应进入 first-run path。

## Release Boundary

GitHub Releases 应作为 1.0 release boundary，因为 MiniClaw 仍是 repo-first local runtime。

release artifacts 应包括：

- 清晰 tag 的 `vX.Y.Z` source
- 来自 `CHANGELOG.md` 的 release notes
- source archive 或 tarball
- install 和 upgrade notes
- breaking changes 和 migration notes
- 是否需要重新注册 slash commands
- 是否包含 DB schema 或 config 变更

npm package 应等待 MiniClaw 具备稳定 CLI surface、`bin`/`exports` boundary 和更清楚的用户预期后再推进。

## Docker Position

Docker 可以作为后续 deployment option，但不是 first-stage install path。MiniClaw 当前依赖本地 Discord、Claude/Codex、MCP、provider sessions、PM2 和 `~/.miniclaw/` state。过早 containerize 这些边界会让 first-run setup 更难，而不是更简单。
