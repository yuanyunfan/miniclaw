# MiniClaw

English | [Simplified Chinese](README.md)

Minimal AI assistant for Discord. It can run tasks through Claude Code or Codex, and is designed for a single-user local Mac setup.

MiniClaw provides a Discord bot, scheduled cron tasks, markdown-based long-term memory, and a Stage multi-agent console.

> For architecture details, see [docs/architecture.md](docs/architecture.md). It includes the system diagram, @mention sequence, /task supervisor flow, cron flow, and storage model.

## Features

| Trigger | Engine | Capability |
| --- | --- | --- |
| Direct messages in the configured `#chat` channel | Claude or Codex from `.env` | Search, read files, and run safe commands |
| `@MiniClaw` in any channel | Claude or Codex from `.env` | Same as above |
| `/task <description>` | Claude Code or Codex from `.env` | Create an isolated thread with a status card, live progress, and final Markdown output |
| `/status` | - | View active and recent tasks |
| `/health` | - | Inspect process, task, and cron health |
| `/agent-config` | - | Show provider, model, Codex/Claude settings, MCP, and skills inheritance |
| `/cancel <id>` | - | Cancel a running task |
| `/resume <id> <followup>` | - | Continue a previous session. Sessions cannot be resumed across providers |
| `/remember <text>` or `remember: ...` | - | Write long-term memory to `~/.miniclaw/memories/MEMORY.md` |
| `/forget <id>` | - | Remove one memory item |
| `/memories` | - | List current memories |

Interaction details:

- Incoming message -> eyes reaction -> readable tool progress -> done or failed reaction.
- `/task` creates a Discord thread for context isolation.
- `/task` embeds are used only for metadata. The final answer is sent as regular Markdown chunks, which use more of Discord's message width.
- `/task` keeps one persistent progress message. It is edited while the task runs and becomes an `Execution Summary` after completion.
- Tool progress is rendered in readable lines such as `github: search_repositories`, `Bash ls -la`, or `WebSearch ...`.
- Proxy support covers both HTTP REST and WebSocket traffic.

## Architecture

```text
Discord message
  |
  v
Bot event listeners (discord.js v14)
  |-- @mention / #chat -> Provider chat -> streaming callbacks -> Discord replies
  `-- /task -> create thread -> Provider task -> status card + progress summary + Markdown result
  |
  v
SQLite persistence (task state + chat history)
```

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
| --- | --- |
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_CLIENT_ID` | Discord application ID |
| `DISCORD_GUILD_ID` | Target Discord server ID |
| `ANTHROPIC_API_KEY` | Anthropic API key. Required when `MINICLAW_AGENT_PROVIDER=claude` |
| `OPENAI_API_KEY` | OpenAI API key. Optional for Codex if local `codex login` is available |
| `MINICLAW_ALLOWED_USER_ID` | Your Discord user ID |

Optional variables:

| Variable | Default | Description |
| --- | --- | --- |
| `MINICLAW_PROXY` | - | HTTP proxy URL, for example `http://127.0.0.1:7890` |
| `MINICLAW_AGENT_PROVIDER` | `claude` | Global provider: `claude` or `codex` |
| `MINICLAW_AUTO_REPLY_CHANNELS` | - | Comma-separated channel IDs where MiniClaw replies without @mention |
| `MINICLAW_DEFAULT_CWD` | `~/Code` | Default Agent SDK working directory |
| `MINICLAW_MAX_CONCURRENT_TASKS` | `3` | Maximum concurrent `/task` runs |
| `MINICLAW_DEFAULT_BUDGET_USD` | `1.0` | Per-task cost budget |
| `MINICLAW_DEFAULT_MAX_TURNS` | `30` | Per-task turn limit |
| `MINICLAW_CHAT_TIMEOUT_MS` | `180000` | Timeout for lightweight chat replies |
| `MINICLAW_ATTACHMENT_TIMEOUT_MS` | `30000` | Discord attachment download timeout |
| `MINICLAW_REGISTER_COMMANDS_ON_START` | `false` | Register slash commands during startup. Prefer `pnpm register` after command changes |
| `MINICLAW_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |
| `MINICLAW_LOG_FORMAT` | `text` | `text` or JSON lines |
| `MINICLAW_CLAUDE_MODEL` | `claude-opus-4-7` | Claude model. Legacy `MINICLAW_MODEL` is still supported |
| `MINICLAW_CLAUDE_SETTING_SOURCES` | `user,project,local` | Claude task setting sources. Use `none` to disable |
| `MINICLAW_CLAUDE_DISABLE_HOOKS` | `true` | Disable Claude hooks by default in Discord task flow |
| `MINICLAW_MCP_CONFIG` | `~/.claude.json` | Config file used to load Claude provider MCP servers |
| `MINICLAW_MCP_ALLOWLIST` | `exa,context7` | Claude provider MCP allowlist. Use `*` to load all |
| `MINICLAW_CODEX_MODEL` | `gpt-5.5` | Codex model. Use `inherit` to let local Codex config decide |
| `MINICLAW_CODEX_TASK_SANDBOX` | `workspace-write` | Codex `/task` sandbox. Supports `inherit` |
| `MINICLAW_CODEX_CHAT_SANDBOX` | `read-only` | Codex chat/stage sandbox. Supports `inherit` |
| `MINICLAW_CODEX_REASONING_EFFORT` | `medium` | Codex reasoning effort. Supports `inherit` |
| `MINICLAW_CODEX_APPROVAL_POLICY` | `never` | Codex approval policy. Supports `inherit` |
| `MINICLAW_CODEX_WEB_SEARCH` | `live` | Codex web search mode: `disabled`, `cached`, or `live`. Supports `inherit` |
| `MINICLAW_CODEX_NETWORK_ACCESS` | `true` | Whether Codex sandbox has network access. Supports `inherit` |
| `MINICLAW_CODEX_TIMEOUT_MS` | `900000` | Codex single-turn timeout in milliseconds |
| `MINICLAW_DB_PATH` | `~/.miniclaw/data.db` | SQLite database path |
| `MINICLAW_MAX_ATTACHMENT_MB` | `32` | Maximum size for one attachment |
| `MINICLAW_MAX_ATTACHMENTS` | `10` | Maximum attachments per message |

Minimal Codex setup:

```bash
MINICLAW_AGENT_PROVIDER=codex
# Optional: OPENAI_API_KEY=...
# Optional: MINICLAW_CODEX_MODEL=gpt-5.5
```

To inherit local Codex CLI settings from `~/.codex/config.toml`, set Codex overrides to `inherit`:

```bash
MINICLAW_AGENT_PROVIDER=codex
MINICLAW_CODEX_MODEL=inherit
MINICLAW_CODEX_REASONING_EFFORT=inherit
MINICLAW_CODEX_TASK_SANDBOX=inherit
MINICLAW_CODEX_APPROVAL_POLICY=inherit
MINICLAW_CODEX_WEB_SEARCH=inherit
MINICLAW_CODEX_NETWORK_ACCESS=inherit
```

Use `/agent-config` in Discord to inspect the active provider/model, Codex MCP/skills, and Claude settings/MCP/skills summary.

### 3. Register slash commands

```bash
pnpm register
```

### 4. Start MiniClaw

Development mode:

```bash
pnpm dev
```

Run under pm2:

```bash
pnpm build
pm2 start ecosystem.config.cjs
```

### 5. Optional channel and cron setup

To create the default "hermes-style" Discord channel layout and enable the built-in cron jobs:

```bash
# Create default categories and channels in your Discord guild.
# Requires the bot to have Manage Channels permission.
# Writes the channel ID map to ~/.miniclaw/channel-map.json.
pnpm tsx scripts/setup-miniclaw-channels.ts

# Update ~/.miniclaw/cron/*.yaml with the created channel IDs and enable jobs.
python3 scripts/update-cron-channels.py
```

Default channel layout:

| Category | Channels |
| --- | --- |
| AI | daily-ai-news / daily-ai-frontier / daily-tech-radar / daily-github-trending / daily-app-trending |
| PERSONAL | daily-token-dashboard |
| STOCK | daily-stock-market |
| NEWS | news-domestic / news-international / trending / tldr / monitor-github-repo |

The WeChat Official Account digest job `daily-wechat-mp` needs an additional Official Platform session and a target `daily-wechat-article` channel. See [docs/wechat-mp-provider.md](docs/wechat-mp-provider.md).

If you use your own channel layout, skip the setup scripts and edit the `channel` field in `~/.miniclaw/cron/*.yaml` manually.

## Project Structure

```text
src/
|-- index.ts              # Entry point: DB init -> command registration -> bot startup
|-- bot.ts                # Discord event listeners and message routing
|-- config.ts             # Environment variable loading
|-- proxy.ts              # HTTP and WebSocket proxy setup
|-- agent/
|   |-- chat.ts           # @mention / auto-reply chat
|   |-- codex.ts          # Codex SDK wrapper
|   |-- runtime-config.ts # /agent-config runtime inheritance summary
|   |-- session.ts        # Provider-prefixed session IDs
|   `-- task.ts           # /task execution with Claude/Codex and streaming progress
|-- commands/
|   |-- register.ts       # Slash command registration
|   `-- handlers.ts       # /task /status /cancel /resume handlers
|-- cron/                 # node-cron scheduler, runners, and state persistence
|-- discord/
|   |-- chunks.ts         # 2000-char message chunking with code fence balancing
|   |-- formatter.ts      # Embed templates
|   `-- progress.ts       # Throttled progress message editing
|-- providers/
|   `-- wechat-mp/        # WeChat Official Account pre-provider
|-- memory/               # Markdown long-term memory
|-- stage/                # pnpm stage multi-agent TUI
`-- store/
    `-- db.ts             # SQLite storage
```

## Tech Stack

- TypeScript (ESM) + Node.js 22+
- discord.js v14
- @anthropic-ai/claude-agent-sdk
- @openai/codex-sdk
- better-sqlite3
- pm2

## Proxy Support

Set `MINICLAW_PROXY` when your environment needs an HTTP proxy:

```text
MINICLAW_PROXY=http://127.0.0.1:7890
```

MiniClaw applies the proxy to both REST API traffic and WebSocket traffic.

## License

MIT
