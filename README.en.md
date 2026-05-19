# MiniClaw

English | [Simplified Chinese](README.md)

Docs website: https://yuanyunfan.github.io/miniclaw/

Personal local-first AI automation hub for chat, tasks, scheduled jobs, provider data collection, and private daily reports. It can run through Claude Code or Codex; Discord remains the default full-fidelity control plane, and optional Weixin direct can be a personal text, voice, and image entry point.

MiniClaw is designed for a single-user local Mac setup. Discord is the interaction and delivery layer; MiniClaw handles routing, task threads, cron scheduling, long-term memory, read-only data providers, private report generation, and a Stage multi-agent console.

Core positioning:

- **Discord-native control plane**: chat, task intake, slash commands, cron outputs, and recovery workflows live in Discord by default; Weixin direct is an opt-in independent IM entry point.
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
| Weixin direct messages (optional) | Claude or Codex from `config.yaml` | Personal WeChat text, voice, and image direct chat; Smart Router asks for y/n text confirmation when task mode fits, then returns task progress and results in Weixin |
| `/task <description>` | Claude Code or Codex from `config.yaml` | Create an isolated thread with a status card, live progress, and final Markdown output |
| Cron jobs | Claude Code or Codex + pre-provider | Collect structured data, run analysis, and push reports to Discord on schedule |
| `/status` | - | View active and recent tasks |
| `/task-log <id>` | - | Export a safe Markdown trace for a task |
| `/cron-runs` / `/cron-run <id>` | - | Inspect cron run history and one run detail |
| `/health` | - | Inspect process, task, and cron health |
| `/doctor` | - | Run read-only diagnosis for task, cron, runtime, and Auto Doctor evidence |
| `/incidents` / `/incident ...` | - | Review, resolve, ignore, retry, and guarded-ship Auto Doctor incidents |
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
- Weixin direct is disabled by default; run `pnpm weixin:login` to save an account under `~/.miniclaw/weixin`, then enable `im.transports.weixin.enabled` and `poll_enabled` in `config.yaml`. After startup, the Weixin gateway no longer waits for Discord `clientReady`; text, transcribed voice, and images with downloadable media URLs can enter chat or task mode.

Built-in data capabilities:

- `wechat-mp`: WeChat Official Account article collection and digest reports.
- `email-query`: generic read-only mailbox query capability.
- `cmb-credit-card-email`: CMB credit-card email parsing.
- `futu-stock`: read-only Futu OpenD account snapshots and position P&L.
- `eastmoney-jywg-readonly`: read-only Eastmoney `jywg.18.cn` account snapshots and position P&L.
- `eastmoney-etf-premium`: public Eastmoney ETF premium/discount enrichment for held ETF rows only.
- `stock-portfolio`: multi-broker portfolio aggregation with CNY P&L rollups and top gainers/losers.
- `stock-pulse`: intraday anomaly scans across portfolio symbols, watchlists, and quote bars.
- `market-intel` / `market-forecast-evaluation`: market evidence collection, forecast persistence, and post-market calibration.
- `stock-watchlist-research`: watchlist-only buy-timing research that excludes held symbols.

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

### 1. Five-minute minimal run

```bash
git clone https://github.com/yuanyunfan/miniclaw.git
cd miniclaw
./install.sh
pnpm run setup
pnpm run doctor:setup
pnpm register
pnpm dev
```

The installer initializes dependencies and missing templates only. It does not write real tokens or overwrite an existing `~/.miniclaw/config.yaml`. `pnpm run setup` writes `.env` and `~/.miniclaw/config.yaml`, backing up old files before replacement.

Verify in Discord after startup:

```text
/health
@MiniClaw hello
```

### 2. Minimal config model

`.env` stores secrets and bootstrap values only:

- `DISCORD_TOKEN`: Discord bot token.
- `MINICLAW_CONFIG`: recommended path is `~/.miniclaw/config.yaml`.
- `ANTHROPIC_API_KEY`: required when the Claude provider is active.
- `OPENAI_API_KEY`: optional for Codex when local `codex login` is not used.
- `MINICLAW_PROXY`: optional HTTP proxy. It remains env-based because it must be applied before the YAML config loader initializes.

`~/.miniclaw/config.yaml` stores structured settings. The default install profile is conservative: Codex, local home cwd, explicit @mention, and Smart Router disabled.

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
cron:
  active_window:
    enabled: false
    timezone: Asia/Shanghai
    start: "08:00"
    end: "00:00"
```

See [config.example.yaml](config.example.yaml) for the full template. Quote Discord IDs because they are larger than JavaScript's safe integer range.

When `cron.active_window.enabled: true`, scheduled cron jobs are globally gated by the configured local-time window. Jobs outside the window are recorded as skipped before script, provider, or task execution. Manual `pnpm cron:test <job>` still runs for troubleshooting.

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

### 3. Production local run

```bash
pnpm build
pm2 start ecosystem.config.cjs
pm2 status miniclaw
```

Use the safe restart boundary for runtime updates:

```bash
pnpm safe-restart
pnpm run doctor
```

See [docs/runbooks/install.md](docs/runbooks/install.md) and [docs/runbooks/local-deploy.md](docs/runbooks/local-deploy.md) for install and deploy details. Release versions are the stable install and rollback boundary; the recommended distribution path is GitHub Release plus installer, not npm publishing the main runtime.

### 4. Optional advanced capabilities

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
| AI | daily-ai-news / daily-ai-frontier / daily-tech-radar / daily-github-trending / weekly-app-trending |
| PERSONAL | daily-token-dashboard |
| STOCK | daily-stock-market for the base template; stock reports can be split into daily-us-stock / daily-cn-stock |
| NEWS | news-domestic / news-international / trending / tldr / monitor-github-repo |

The WeChat Official Account digest job `daily-wechat-mp` needs an additional Official Platform session and a target `daily-wechat-article` channel. See [docs/providers/content.md](docs/providers/content.md).

For brokerage-backed stock reports, use the `stock-portfolio` aggregate provider and split delivery into `daily-us-stock` and `daily-cn-stock` channels. See [docs/providers/stock/README.md](docs/providers/stock/README.md) and [docs/providers/stock/research.md](docs/providers/stock/research.md).

If you use your own channel layout, skip the setup scripts and edit the `channel` field in `~/.miniclaw/cron/*.yaml` manually.

For a dedicated task intake channel, prefer `routing.task_channels` in `config.yaml`; legacy `MINICLAW_TASK_CHANNELS` can still be used as an env override. Plain messages in those channels create task threads and use the same execution/output path as `/task`, without needing `@MiniClaw`.

## Project Structure

```text
.
|-- src/                    # MiniClaw runtime source
|   |-- index.ts            # Entry point: DB, commands, bot, cron, doctor scheduler
|   |-- bot.ts              # Discord client lifecycle; business routing delegates to bot/*
|   |-- config.ts           # Compatibility facade; config/ owns YAML/env/default assembly
|   |-- proxy.ts            # HTTP and WebSocket proxy setup
|   |-- agent/              # chat/task execution, runners, runtime registry, Agent Run Manager
|   |   |-- run-manager/    # managed multi-agent runs, bus, scheduler, ACP/MCP bridge
|   |   |-- runners/        # Claude/Codex/fake task runners
|   |   `-- runtimes/       # runtime interface adapter registry
|   |-- bot/                # message, slash, button, and thread-continuation dispatch
|   |-- commands/           # slash command registration and handlers
|   |-- config/             # schema, env/YAML load, domain defaults, runtime freeze
|   |-- cron/               # scheduler, active window, runners, retry alerts, run history
|   |-- capabilities/email/ # generic read-only mailbox capability
|   |-- discord/            # formatter, chunks, task intake, trace attachments
|   |-- im/                 # IM transport abstraction: Discord + Feishu outbound
|   |-- runtime/            # agent runtime / IM transport / model client contracts
|   |-- providers/          # pre-provider framework and content/email/stock/market providers
|   |-- mcp/                # Eastmoney/Futu/Agent Bus MCP servers
|   |-- memory/             # Markdown memory parsing, injection, maintenance
|   |-- monitoring/         # connectivity monitor, watchdog, recovery outbox
|   |-- notifications/      # macOS / SMTP fallback notifications
|   |-- ops/                # doctor, doctor-repair, doctor-scheduler, safe-restart
|   |-- privacy/            # diagnostic redaction helpers
|   |-- quality/            # docs/changelog/website quality gate helpers
|   |-- routing/            # hard route, Smart Router, context/cwd resolution
|   |-- stage/              # pnpm stage multi-agent TUI and ui/*
|   `-- store/              # SQLite schema, migrations, repositories, trace export
|-- scripts/                # setup, doctor, cron/provider CLI, quality gates
|-- docs/                   # implementation source of truth
|-- docs/zh/                # tracked Chinese docs mirror
|-- website/                # GitHub Pages presentation layer
|-- prompts/                # repo-owned prompt assets and templates
|-- agents/                 # repo-owned agent role cards
|-- personas/               # Stage persona cards
`-- config.example.yaml     # user config template
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
