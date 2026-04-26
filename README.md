# MiniClaw 🤖

极简 AI 助手 — 通过 Discord 沟通，通过 Claude Code Agent SDK 执行任务。

个人单用户，本地 Mac 常驻运行，~1000 行核心代码。

## 功能

| 触发方式 | 引擎 | 能力 |
|----------|------|------|
| `#chat` 频道直接发消息 | Claude Code Agent SDK | 搜索、读写文件、执行命令 — 等同 Claude Code |
| `@MiniClaw` 在任意频道 | Claude Code Agent SDK | 同上 |
| `/task <描述>` | Claude Code Agent SDK | 创建独立线程，实时进度，完成 Embed |
| `/status` | — | 查看活跃/历史任务 |
| `/cancel <id>` | — | 终止运行中的任务 |
| `/resume <id> <指令>` | — | 恢复之前的 session 继续执行 |

**交互细节：**
- 收到消息 → 👀 反应 → 处理中实时显示工具调用步骤 → 完成 ✅ / 失败 ❌
- `/task` 自动创建 Discord 线程隔离上下文，embed 展示耗时、费用、轮次
- 中间步骤可读化：`🔌 github: search_repositories`、`⚡ Bash ls -la`、`🌐 WebSearch ...`
- 支持代理（ClashX / VPN），HTTP + WebSocket 双通道

## 架构

```
Discord 消息
  ↓
Bot 事件监听 (discord.js v14)
  ├─ @mention / #chat → Agent SDK query() → 流式回调 → Discord 回复
  └─ /task → 创建线程 → Agent SDK query() → 进度推送 → 完成 Embed
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
| `ANTHROPIC_API_KEY` | Anthropic API Key |
| `MINICLAW_ALLOWED_USER_ID` | 你的 Discord 用户 ID |

可选配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MINICLAW_PROXY` | — | HTTP 代理地址（如 `http://127.0.0.1:7890`） |
| `MINICLAW_AUTO_REPLY_CHANNELS` | — | 免 @ 自动回复的频道 ID（逗号分隔） |
| `MINICLAW_DEFAULT_CWD` | `~/Code` | Agent SDK 默认工作目录 |
| `MINICLAW_MAX_CONCURRENT_TASKS` | `3` | /task 最大并发数 |
| `MINICLAW_DEFAULT_BUDGET_USD` | `1.0` | 单次任务费用上限 |
| `MINICLAW_DEFAULT_MAX_TURNS` | `30` | 单次任务最大轮次 |
| `MINICLAW_MODEL` | `claude-sonnet-4-6` | Claude 模型 |
| `MINICLAW_DB_PATH` | `~/.miniclaw/data.db` | SQLite 数据库路径 |

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
pm2 start ecosystem.config.cjs
```

## 项目结构

```
src/
├── index.ts              # 入口：初始化 DB → 注册命令 → 启动 Bot
├── bot.ts                # Discord 事件监听 + 消息路由
├── config.ts             # 环境变量加载
├── proxy.ts              # HTTP + WebSocket 代理注入
├── agent/
│   ├── chat.ts           # @mention/auto-reply 对话（Agent SDK）
│   └── task.ts           # /task 任务执行（Agent SDK + 流式进度）
├── commands/
│   ├── register.ts       # Slash command 注册
│   └── handlers.ts       # /task /status /cancel /resume 处理
├── discord/
│   ├── chunks.ts         # 消息分片（2000 字符 + 代码围栏平衡）
│   ├── formatter.ts      # Embed 模板（启动/完成/失败/状态）
│   └── progress.ts       # 进度更新推送（节流 + 编辑式）
└── store/
    └── db.ts             # SQLite 存储（tasks + chat_history）
```

## 技术栈

- **TypeScript (ESM)** + Node.js 22+
- **discord.js v14** — Discord Bot
- **@anthropic-ai/claude-agent-sdk** — Claude Code 完整能力
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
