# MiniClaw 🤖

极简 AI 助手 — 通过 Discord 沟通，可在 Claude Code / Codex 之间切换执行任务。

个人单用户，本地 Mac 常驻运行，提供 Discord bot、cron 定时任务、长期记忆和 Stage 多 agent 控制台。

> 📖 **想直观了解架构？** 看 [`docs/architecture.md`](docs/architecture.md) — 系统架构图 + @mention 时序图 + /task Supervisor 时序图，10 分钟看懂全局。

## 功能

| 触发方式 | 引擎 | 能力 |
|----------|------|------|
| `#chat` 频道直接发消息 | `.env` 选择 Claude / Codex | 搜索、读取文件、执行安全命令 |
| `@MiniClaw` 在任意频道 | `.env` 选择 Claude / Codex | 同上 |
| `/task <描述>` | `.env` 选择 Claude Code / Codex | 创建独立线程，状态卡片 + 实时进度 + Markdown 最终结果 |
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

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入以下必填项：

| 变量 | 说明 |
|------|------|
| `DISCORD_TOKEN` | Discord Bot Token |
| `DISCORD_CLIENT_ID` | Discord Application ID |
| `DISCORD_GUILD_ID` | 目标服务器 ID |
| `ANTHROPIC_API_KEY` | Anthropic API Key（`MINICLAW_AGENT_PROVIDER=claude` 时必填） |
| `OPENAI_API_KEY` | OpenAI API Key（Codex 可选；也可复用本机 `codex login`） |
| `MINICLAW_ALLOWED_USER_ID` | 你的 Discord 用户 ID |

可选配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MINICLAW_PROXY` | — | HTTP 代理地址（如 `http://127.0.0.1:7890`） |
| `MINICLAW_AGENT_PROVIDER` | `claude` | 全局 provider：`claude` 或 `codex` |
| `MINICLAW_AUTO_REPLY_CHANNELS` | — | 免 @ 自动回复的频道 ID（逗号分隔） |
| `MINICLAW_DEFAULT_CWD` | `~/Code` | Agent SDK 默认工作目录 |
| `MINICLAW_MAX_CONCURRENT_TASKS` | `3` | /task 最大并发数 |
| `MINICLAW_DEFAULT_BUDGET_USD` | `1.0` | 单次任务费用上限 |
| `MINICLAW_DEFAULT_MAX_TURNS` | `30` | 单次任务最大轮次 |
| `MINICLAW_CHAT_TIMEOUT_MS` | `180000` | 轻量 chat 单次回复整体超时 |
| `MINICLAW_ATTACHMENT_TIMEOUT_MS` | `30000` | Discord 附件下载超时 |
| `MINICLAW_REGISTER_COMMANDS_ON_START` | `false` | 启动时是否自动注册 slash commands；命令变更后建议手动跑 `pnpm register` |
| `MINICLAW_LOG_LEVEL` | `info` | 日志级别：`debug` / `info` / `warn` / `error` |
| `MINICLAW_LOG_FORMAT` | `text` | 日志格式：`text` 或 `json`（JSON line，便于日志检索） |
| `MINICLAW_CLAUDE_MODEL` | `claude-opus-4-7` | Claude 模型（旧 `MINICLAW_MODEL` 仍兼容） |
| `MINICLAW_CLAUDE_SETTING_SOURCES` | `user,project,local` | Claude task 读取哪些本机 settings source；设为 `none` 可禁用 |
| `MINICLAW_CLAUDE_DISABLE_HOOKS` | `true` | Claude task 默认禁用 hooks，避免把本机交互 hook 带入 Discord 流程 |
| `MINICLAW_MCP_CONFIG` | `~/.claude.json` | Claude provider 读取 MCP server 的配置文件 |
| `MINICLAW_MCP_ALLOWLIST` | `exa,context7` | Claude provider 允许加载的 MCP server；`*` 表示全部 |
| `MINICLAW_CODEX_MODEL` | `gpt-5.5` | Codex 模型；可设 `inherit` 复用本机 Codex 配置 |
| `MINICLAW_CODEX_TASK_SANDBOX` | `workspace-write` | Codex `/task` 沙箱；可设 `inherit` |
| `MINICLAW_CODEX_CHAT_SANDBOX` | `read-only` | Codex chat/stage 沙箱；可设 `inherit` |
| `MINICLAW_CODEX_REASONING_EFFORT` | `medium` | Codex reasoning effort；可设 `inherit` |
| `MINICLAW_CODEX_APPROVAL_POLICY` | `never` | Codex 工具调用审批策略（如 `never` / `on-request`）；可设 `inherit` |
| `MINICLAW_CODEX_WEB_SEARCH` | `live` | Codex web search 模式（`disabled` / `cached` / `live`）；可设 `inherit` |
| `MINICLAW_CODEX_NETWORK_ACCESS` | `true` | Codex 沙箱是否允许出站网络；可设 `inherit` |
| `MINICLAW_CODEX_TIMEOUT_MS` | `900000` | Codex 单 turn 超时（毫秒，默 15 分钟） |
| `MINICLAW_DB_PATH` | `~/.miniclaw/data.db` | SQLite 数据库路径 |
| `MINICLAW_MAX_ATTACHMENT_MB` | `32` | 单附件最大大小 |
| `MINICLAW_MAX_ATTACHMENTS` | `10` | 单条消息最多处理附件数 |

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

运行 `/agent-config` 可在 Discord 中检查当前 provider/model、Codex MCP/skills、Claude settings/MCP/skills 的继承摘要。

### 3. 注册 Slash Commands

```bash
pnpm register
```

### 4. 启动

开发模式（热重载）：

```bash
pnpm dev
```

pm2 常驻运行：

```bash
pnpm build
pm2 start ecosystem.config.cjs
```

### 5. （可选）批量配置 Discord 频道与 Cron 任务

如果你想直接复用我同款的"hermes-style"频道结构（4 分类 + 13 个核心频道，对应 15 个通用定时简报任务），跑下面 2 个**可选模板**脚本：

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
| 💹 STOCK | daily-stock-market |
| 📰 NEWS | news-domestic / news-international / trending / tldr / monitor-github-repo |

微信公众号日报 `daily-wechat-mp` 需要额外的公众号后台登录态和 `daily-wechat-article` 频道，默认不由模板脚本创建。配置方式见 [`docs/wechat-mp-provider.md`](docs/wechat-mp-provider.md)。

如果你想用**自己的**频道结构（而不是 hermes-style），跳过这两个脚本，直接 `vim ~/.miniclaw/cron/*.yaml` 改各自的 `channel: "<id>"`。

## 项目结构

```
src/
├── index.ts              # 入口：初始化 DB → 注册命令 → 启动 Bot
├── bot.ts                # Discord 事件监听 + 消息路由
├── config.ts             # 环境变量加载
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
├── discord/
│   ├── chunks.ts         # 消息分片（2000 字符 + 代码围栏平衡）
│   ├── formatter.ts      # Embed 模板（启动/完成/失败/状态）
│   └── progress.ts       # 进度更新推送（节流 + 编辑式）
├── providers/
│   └── wechat-mp/        # 微信公众号 pre-provider
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
