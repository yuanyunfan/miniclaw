# MiniClaw

English | [Simplified Chinese](README.md)

Personal Discord-native AI automation hub for chat, tasks, scheduled jobs, provider data collection, and private daily reports. It can run through Claude Code or Codex.

MiniClaw is designed for a single-user local Mac setup. Discord is the interaction and delivery layer; MiniClaw handles routing, task threads, cron scheduling, long-term memory, read-only data providers, private report generation, and a Stage multi-agent console.

Core positioning:

- **Discord-native**: chat, tasks, task intake channels, and cron outputs all live in Discord.
- **Switchable agent runtime**: Claude Code and Codex are execution engines; MiniClaw normalizes sessions, progress, output, and local settings inheritance.
- **Local-first automation**: user config, cron jobs, provider state, and secrets live under `~/.miniclaw/`; the repo stores reusable code only.
- **Provider-driven reports**: WeChat, email, credit-card, and brokerage data are collected by read-only providers before LLM summarization.
- **Private-data aware**: sensitive providers are read-only by default and avoid committing cookies, tokens, account IDs, or app passwords to Git.

> For architecture details, see [docs/architecture.md](docs/architecture.md). It includes the system diagram, @mention sequence, /task supervisor flow, cron flow, and storage model. See [docs/README.md](docs/README.md) for the full docs index.

## Features

| Trigger | Engine | Capability |
| --- | --- | --- |
| Direct messages in the configured `#chat` channel | Claude or Codex from `config.yaml` | Search, read files, and run safe commands |
| `@MiniClaw` in any channel | Claude or Codex from `config.yaml` | Same as above |
| Smart Router confirmation buttons | Claude Code or Codex from `config.yaml` | Detect natural-language task prompts at chat entry points and upgrade them to `/task` threads after confirmation |
| Plain messages in task intake channels | Claude Code or Codex from `config.yaml` | Create task threads without `@MiniClaw` and use the same output path as `/task` |
| `/task <description>` | Claude Code or Codex from `config.yaml` | Create an isolated thread with a status card, live progress, and final Markdown output |
| Cron jobs | Claude Code or Codex + pre-provider | Collect structured data, run analysis, and push reports to Discord on schedule |
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

Built-in data capabilities:

- `wechat-mp`: WeChat Official Account article collection and digest reports.
- `email-query`: generic read-only mailbox query capability.
- `cmb-credit-card-email`: CMB credit-card email parsing.
- `futu-stock`: read-only Futu OpenD account snapshots and position P&L.
- `eastmoney-jywg-readonly`: read-only Eastmoney `jywg.18.cn` account snapshots and position P&L.
- `stock-portfolio`: multi-broker portfolio aggregation with CNY P&L rollups and top gainers/losers.

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

### 2. Configure MiniClaw

```bash
cp .env.example .env
mkdir -p ~/.miniclaw
cp config.example.yaml ~/.miniclaw/config.yaml
```

Edit `.env` for secrets and bootstrap values only:

- `DISCORD_TOKEN`: Discord bot token.
- `ANTHROPIC_API_KEY`: required when the Claude provider is active.
- `OPENAI_API_KEY`: optional for Codex when local `codex login` is not used.
- `MINICLAW_CONFIG`: recommended path is `~/.miniclaw/config.yaml`.
- `MINICLAW_PROXY`: optional HTTP proxy. It remains env-based because it must be applied before the YAML config loader initializes.

Edit `~/.miniclaw/config.yaml` for structured settings:

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
    default_mode: confirm

agent:
  provider: codex
  default_cwd: "~/Code"
  max_concurrent_tasks: 3
  budget_usd: 1.0
  max_turns: 30
```

See [config.example.yaml](config.example.yaml) for the full template. Quote Discord IDs because they are larger than JavaScript's safe integer range.

When `routing.smart_router.enabled` is `true`, MiniClaw classifies chat-entry messages before answering. Normal explanation questions still use chat; prompts that likely need file edits, tests, Git, or long-running work show `convert to task / continue chat / cancel` buttons. `routing.smart_router.auto_task_channels` should only be used for dedicated trusted task channels.

Configuration precedence:

```text
built-in defaults < ~/.miniclaw/config.yaml < environment overrides
```

Legacy `MINICLAW_*` environment variables still work and override YAML. Prefer YAML for readability and use env only for deployment overrides. Use `none` to explicitly override an array to empty. Blank env values are usually treated as unset, except legacy blank budget/max-turn values still mean `unlimited`.

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

The same Codex inheritance setup can be expressed in YAML:

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

Use `/agent-config` in Discord to inspect the active config file path, provider/model, Codex MCP/skills, and Claude settings/MCP/skills summary.

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

To create a baseline "hermes-style" Discord channel layout and enable the built-in cron jobs:

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
| STOCK | daily-stock-market for the base template; stock reports can be split into daily-us-stock / daily-cn-stock |
| NEWS | news-domestic / news-international / trending / tldr / monitor-github-repo |

The WeChat Official Account digest job `daily-wechat-mp` needs an additional Official Platform session and a target `daily-wechat-article` channel. See [docs/features/02-wechat-mp-provider.md](docs/features/02-wechat-mp-provider.md).

For brokerage-backed stock reports, use the `stock-portfolio` aggregate provider and split delivery into `daily-us-stock` and `daily-cn-stock` channels. See [docs/features/10-stock-portfolio-provider.md](docs/features/10-stock-portfolio-provider.md).

If you use your own channel layout, skip the setup scripts and edit the `channel` field in `~/.miniclaw/cron/*.yaml` manually.

For a dedicated task intake channel, prefer `routing.task_channels` in `config.yaml`; legacy `MINICLAW_TASK_CHANNELS` can still be used as an env override. Plain messages in those channels create task threads and use the same execution/output path as `/task`, without needing `@MiniClaw`.

## Project Structure

```text
src/
|-- index.ts              # Entry point: DB init -> command registration -> bot startup
|-- bot.ts                # Discord event listeners and message routing
|-- config.ts             # Layered YAML + env configuration loading
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
|-- capabilities/
|   `-- email/            # Read-only mailbox capability: IMAP, MIME parsing, redaction, dedupe state
|-- discord/
|   |-- chunks.ts         # 2000-char message chunking with code fence balancing
|   |-- formatter.ts      # Embed templates
|   `-- progress.ts       # Throttled progress message editing
|-- providers/
|   |-- wechat-mp/        # WeChat Official Account pre-provider
|   |-- email-query/      # Generic email query pre-provider
|   |-- cmb-credit-card-email/ # CMB credit-card email parsing pre-provider
|   |-- eastmoney-jywg-readonly/ # Eastmoney jywg.18.cn read-only stock-report pre-provider
|   |-- futu-stock/       # Futu read-only stock-report pre-provider
|   `-- stock-portfolio/  # Multi-broker aggregation with CNY P&L rollups
|-- mcp/
|   |-- eastmoney-jywg/   # Eastmoney jywg.18.cn read-only MCP server
|   `-- futu-stock/       # Futu OpenD read-only MCP server
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
