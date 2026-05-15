# MiniClaw 🤖

[English](README.en.md) | 简体中文

Docs website: https://yuanyunfan.github.io/miniclaw/

个人 Discord-native AI 自动化 Hub — 统一 chat、task、cron、provider 数据采集和私有日报，可在 Claude Code / Codex 之间切换执行。

MiniClaw 面向单用户、本地 Mac 常驻运行。Discord 是入口和交付层，MiniClaw 负责消息路由、任务线程、定时调度、长期记忆、只读数据 provider、私有数据日报和 Stage 多 agent 控制台。

核心定位：

- **Discord-native**：chat、task、task intake channel、cron 结果都在 Discord 中交互和留痕。
- **Agent runtime 可切换**：Claude Code / Codex 是执行引擎，MiniClaw 负责统一 session、进度、输出和配置继承。
- **Local-first automation**：个人配置、cron、provider state 和 secrets 都放在 `~/.miniclaw/`，repo 内只保留通用代码。
- **Provider-driven reports**：微信公众号、邮件、信用卡、股票账户等数据先由只读 provider 结构化采集，再交给 LLM 总结。
- **Private-data aware**：券商、邮箱、公众号等敏感能力默认只读、脱敏输出，不把个人 cookie、token、账号和授权码写入 Git。

> 📖 **想直观了解架构？** 看 [`docs/architecture.md`](docs/architecture.md) — 系统架构图 + @mention 时序图 + /task Supervisor 时序图，10 分钟看懂全局。完整文档索引见 [`docs/README.md`](docs/README.md)。

## 功能

| 触发方式 | 引擎 | 能力 |
|----------|------|------|
| `#chat` 频道直接发消息 | `config.yaml` 选择 Claude / Codex | 搜索、读取文件、执行安全命令 |
| `@MiniClaw` 在任意频道 | `config.yaml` 选择 Claude / Codex | 同上 |
| Smart Router 按钮确认 | `config.yaml` 选择 Claude Code / Codex | 在 chat 入口识别自然语言 task prompt，确认后升级为 `/task` 线程 |
| task intake 频道普通消息 | `config.yaml` 选择 Claude Code / Codex | 无需 @mention，直接创建 task thread，走 `/task` 同一套输出链路 |
| `/task <描述>` | `config.yaml` 选择 Claude Code / Codex | 创建独立线程，状态卡片 + 实时进度 + Markdown 最终结果 |
| cron 定时任务 | Claude Code / Codex + pre_provider | 到点自动采集数据、执行分析并推送 Discord |
| `/status` | — | 查看活跃/历史任务 |
| `/health` | — | 查看 MiniClaw 进程、任务和 cron 健康状态 |
| `/agent-config` | — | 查看当前 provider、模型、Codex/Claude settings、MCP、skills 继承摘要 |
| `/cancel <id>` | — | 终止运行中的任务 |
| `/resume <id> <指令>` | — | 恢复之前的 session 继续执行（不能跨 provider 恢复） |
| `/remember <text>` / 直接发"记住:..." | — | 写入长期记忆 `~/.miniclaw/memories/MEMORY.md` |
| `/forget <id>` | — | 从长期记忆移除指定条目 |
| `/memories` | — | 列出当前所有长期记忆 |

**交互细节：**
- 收到消息 → 👀 反应 → 处理中实时显示工具调用步骤 → 完成 ✅ / 失败 ❌
- `/task` 自动创建 Discord 线程隔离上下文，embed 只承载任务元数据；最终结果用普通 Markdown 消息分片发送，保留更宽的阅读区域
- `/task` 保留一条 persistent progress message，执行中持续 edit，完成后变成 Execution Summary，可回看最近工具调用
- 中间步骤可读化：`🔌 github: search_repositories`、`⚡ Bash ls -la`、`🌐 WebSearch ...`
- 支持代理（ClashX / VPN），HTTP + WebSocket 双通道

**内置数据能力：**

- `wechat-mp`: 微信公众号文章采集和日报推送。
- `email-query`: 通用只读邮箱查询 capability。
- `cmb-credit-card-email`: 招商信用卡邮件消费解析。
- `futu-stock`: 富途 OpenD 只读账户快照和持仓盈亏。
- `eastmoney-jywg-readonly`: 东方财富 `jywg.18.cn` 只读账户快照和持仓盈亏。
- `stock-portfolio`: 聚合多券商持仓，生成统一人民币口径盈亏、Top gainers/losers 和股票日报上下文。

## 架构

```
Discord 消息
  ↓
Bot 事件监听 (discord.js v14)
  ├─ @mention / #chat → Provider chat → 流式回调 → Discord 回复
  └─ /task → 创建线程 → Provider task → 状态卡片 + 进度摘要 + Markdown 结果
  ↓
SQLite 持久化（任务状态 + 对话历史）
```

## 快速开始

### 1. 5 分钟最小可运行

```bash
git clone https://github.com/yuanyunfan/miniclaw.git
cd miniclaw
./install.sh
pnpm run setup
pnpm run doctor:setup
pnpm register
pnpm dev
```

安装器只初始化依赖和缺失模板，不写入真实 token，不覆盖已有 `~/.miniclaw/config.yaml`。交互式 `pnpm run setup` 会写入 `.env` 和 `~/.miniclaw/config.yaml`，并在覆盖前备份旧文件。

启动后在 Discord 中验证：

```text
/health
@MiniClaw hello
```

### 2. 最小配置含义

`.env` 只放 secrets 和启动前必须生效的值：

- `DISCORD_TOKEN`: Discord Bot Token。
- `MINICLAW_CONFIG`: 配置文件路径，默认推荐 `~/.miniclaw/config.yaml`。
- `ANTHROPIC_API_KEY`: Claude provider 使用时必填。
- `OPENAI_API_KEY`: Codex 可选；如果本机已经 `codex login`，通常可以不填。
- `MINICLAW_PROXY`: 可选 HTTP 代理。它仍是 env，因为代理必须在 YAML loader 初始化前注入。

`~/.miniclaw/config.yaml` 放结构化配置。默认安装 profile 保守使用 Codex、本机 cwd、显式 @mention 和关闭 Smart Router：

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
agent:
  provider: codex
  default_cwd: "~"
  max_concurrent_tasks: 1
  budget_usd: 1.0
  max_turns: 30
```

完整模板见 [`config.example.yaml`](config.example.yaml)。Discord ID 必须加引号，避免 YAML 把超大整数解析成不安全的 number。

`routing.smart_router.enabled: true` 后，MiniClaw 会在 chat 入口执行 LLM-first capability 路由：普通解释问题继续走 chat，需要改文件、跑命令、Git、运行态排查或持久化输出的请求会显示“转为 task / 继续 chat / 取消”按钮；`routing.smart_router.auto_task_channels` 仅适合专门的受信 task 频道。

配置优先级：

```text
内置默认值 < ~/.miniclaw/config.yaml < 环境变量覆盖
```

旧的 `MINICLAW_*` env 变量仍兼容，并且优先级高于 YAML；推荐只在部署临时覆盖时使用。显式清空数组可用 `none`。除旧版 budget/max turns 空值继续兼容为 `unlimited` 外，空字符串通常会被视为未配置，避免 `.env` 里的空值意外覆盖 YAML。

切换到 Codex 的最小配置：

```bash
MINICLAW_AGENT_PROVIDER=codex
# 可选：OPENAI_API_KEY=...
# 可选：MINICLAW_CODEX_MODEL=gpt-5.5
```

如果你希望 MiniClaw 尽量复用本机 Codex CLI 的 `~/.codex/config.toml`、MCP 和 skills，把对应 Codex override 设为 `inherit`：

```bash
MINICLAW_AGENT_PROVIDER=codex
MINICLAW_CODEX_MODEL=inherit
MINICLAW_CODEX_REASONING_EFFORT=inherit
MINICLAW_CODEX_TASK_SANDBOX=inherit
MINICLAW_CODEX_APPROVAL_POLICY=inherit
MINICLAW_CODEX_WEB_SEARCH=inherit
MINICLAW_CODEX_NETWORK_ACCESS=inherit
```

在 YAML 中也可以这样写：

```yaml
agent:
  provider: codex
codex:
  model: inherit
  reasoning_effort: inherit
  sandbox:
    task: inherit
    chat: read-only
  approval_policy: inherit
  web_search: inherit
  network_access: inherit
```

运行 `/agent-config` 可在 Discord 中检查当前配置文件路径、provider/model、Codex MCP/skills、Claude settings/MCP/skills 的继承摘要。

### 3. 本机常驻运行

```bash
pnpm build
pm2 start ecosystem.config.cjs
pm2 status miniclaw
```

运行中更新必须优先走安全重启，避免打断正在执行的 task/chat：

```bash
pnpm safe-restart
pnpm run doctor
```

安装和部署细节见 [`docs/runbooks/install.md`](docs/runbooks/install.md) 与 [`docs/runbooks/local-deploy.md`](docs/runbooks/local-deploy.md)。Release 版本用于稳定安装和回滚边界；当前推荐 GitHub Release + installer，而不是直接 npm publish 主 runtime。

### 4. 高级能力按需开启

如果你想快速创建一套基础 "hermes-style" 频道结构（4 分类 + 13 个核心频道，对应一批通用定时简报任务），跑下面 2 个**可选模板**脚本：

```bash
# 1. 在你的 Discord guild 里创建 4 分类 + 13 频道（需要 bot 有 Manage Channels 权限）
#    输出 channel ID 映射到 ~/.miniclaw/channel-map.json
pnpm tsx scripts/setup-miniclaw-channels.ts

# 2. 把 ~/.miniclaw/cron/*.yaml 的 channel: 字段批量替换为新创建的 channel ID + 启用
python3 scripts/update-cron-channels.py
```

频道结构：

| 分类 | 频道 |
|---|---|
| 🤖 AI | daily-ai-news / daily-ai-frontier / daily-tech-radar / daily-github-trending / daily-app-trending |
| 👤 PERSONAL | daily-token-dashboard |
| 💹 STOCK | daily-stock-market（基础模板）；股票日报推荐按需拆为 daily-us-stock / daily-cn-stock |
| 📰 NEWS | news-domestic / news-international / trending / tldr / monitor-github-repo |

微信公众号日报 `daily-wechat-mp` 需要额外的公众号后台登录态和 `daily-wechat-article` 频道，默认不由模板脚本创建。配置方式见 [`docs/features/02-wechat-mp-provider.md`](docs/features/02-wechat-mp-provider.md)。

股票日报如果接入富途/东方财富，推荐使用 `stock-portfolio` 聚合 provider，并拆成 `daily-us-stock`、`daily-cn-stock` 两个频道。配置方式见 [`docs/features/10-stock-portfolio-provider.md`](docs/features/10-stock-portfolio-provider.md)。

如果你想用**自己的**频道结构（而不是 hermes-style），跳过这两个脚本，直接 `vim ~/.miniclaw/cron/*.yaml` 改各自的 `channel: "<id>"`。

专门收任务的频道推荐写入 `routing.task_channels`，也可以用旧 env `MINICLAW_TASK_CHANNELS` 临时覆盖。这些频道里普通消息会直接创建 task thread 并进入 `/task` 同一套执行和输出链路，不需要 `@MiniClaw`，也不会走轻量 chat。

## 项目结构

```
src/
├── index.ts              # 入口：初始化 DB → 注册命令 → 启动 Bot
├── bot.ts                # Discord 事件监听 + 消息路由
├── config.ts             # YAML + env layered 配置加载
├── proxy.ts              # HTTP + WebSocket 代理注入
├── agent/
│   ├── chat.ts           # @mention/auto-reply 对话（Agent SDK）
│   ├── codex.ts          # Codex SDK 封装
│   ├── runtime-config.ts # /agent-config 运行时继承摘要
│   ├── session.ts        # provider-prefixed session id
│   └── task.ts           # /task 任务执行（Claude/Codex + 流式进度）
├── commands/
│   ├── register.ts       # Slash command 注册
│   └── handlers.ts       # /task /status /cancel /resume 处理
├── cron/                 # node-cron 调度、runner、state 持久化
├── capabilities/
│   └── email/            # 通用只读邮箱能力（IMAP、MIME 解析、脱敏、dedupe state）
├── discord/
│   ├── chunks.ts         # 消息分片（2000 字符 + 代码围栏平衡）
│   ├── formatter.ts      # Embed 模板（启动/完成/失败/状态）
│   └── progress.ts       # 进度更新推送（节流 + 编辑式）
├── providers/
│   ├── wechat-mp/        # 微信公众号 pre-provider
│   ├── email-query/      # 通用邮件查询 pre-provider
│   ├── cmb-credit-card-email/ # 招商信用卡邮件消费解析 pre-provider
│   ├── eastmoney-jywg-readonly/ # 东方财富 jywg.18.cn 只读股票日报 pre-provider
│   ├── futu-stock/       # 富途账户只读股票日报 pre-provider
│   └── stock-portfolio/  # 聚合多个只读股票账户 provider，生成 CNY 盈亏汇总
├── mcp/
│   ├── eastmoney-jywg/   # 东方财富 jywg.18.cn 只读 MCP server
│   └── futu-stock/       # 富途 OpenD 只读 MCP server
├── memory/               # markdown 长期记忆
├── stage/                # pnpm stage 多 agent TUI
└── store/
    └── db.ts             # SQLite 存储（tasks + chat_history）
```

## 技术栈

- **TypeScript (ESM)** + Node.js 22+
- **discord.js v14** — Discord Bot
- **@anthropic-ai/claude-agent-sdk** — Claude Code 完整能力
- **@openai/codex-sdk** — Codex coding agent
- **better-sqlite3** — 轻量持久化
- **pm2** — 进程守护

## 代理支持

在中国大陆等需要 VPN 的网络环境下，通过 `MINICLAW_PROXY` 配置 ClashX 等代理：

```
MINICLAW_PROXY=http://127.0.0.1:7890
```

同时覆盖 REST API（undici ProxyAgent）和 WebSocket（ws monkey-patch），无需额外配置。

## License

MIT
