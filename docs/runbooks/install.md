# MiniClaw Install Runbook

> 结论：MiniClaw 1.0 的安装路径面向技术用户。先 clone repo，再用 `install.sh` 初始化依赖和本机目录，用 `pnpm run setup` 写入最小 Discord/provider 配置，最后用 `doctor:setup` 验证环境。

## Prerequisites

- macOS or Linux shell environment.
- Node.js 22+.
- Discord application and bot token.
- Discord guild id and allowed user id.
- Codex local login or OpenAI API key when using Codex.
- Anthropic API key when using Claude.
- PM2 only for production local long-running mode.

## Fresh Install

```bash
git clone https://github.com/yuanyunfan/miniclaw.git
cd miniclaw
./install.sh
pnpm run setup
pnpm run doctor:setup
pnpm register
pnpm dev
```

Use `pnpm run setup`, not `pnpm setup`; the latter is pnpm's own shell configuration command.

Expected results:

- `.env` exists in the repo root.
- `~/.miniclaw/config.yaml` exists.
- `pnpm run doctor:setup` has no `FAIL` rows.
- `/health` works in Discord after the bot starts.

## Production Local Run

```bash
pnpm run build
pm2 start ecosystem.config.cjs
pm2 status miniclaw
```

MiniClaw writes PM2 logs under `~/.miniclaw/logs/` by default.

## Safe Reconfiguration

Use `pnpm run setup` again when Discord ids, provider choice, Smart Router, or PM2 preference changes. Existing `.env` and `~/.miniclaw/config.yaml` are backed up before rewrite.

After command schema changes or first install, run:

```bash
pnpm register
```

After runtime config changes, restart through the safe boundary:

```bash
pnpm safe-restart
```

## Troubleshooting

Run:

```bash
pnpm run doctor:setup
```

Common failures:

- `DISCORD_TOKEN missing or placeholder`: run `pnpm run setup` and provide the bot token.
- `discord.* missing or placeholder`: fill Discord client/guild/user ids in setup.
- `Claude provider key missing`: set `ANTHROPIC_API_KEY` or choose Codex.
- `Codex provider auth WARN`: run local `codex login` or set `OPENAI_API_KEY`.
- `PM2 not installed`: install PM2 only if production local run is needed.

## Non-Goals

- The installer does not create a Discord application.
- The installer does not copy private provider sessions.
- The installer does not overwrite existing user config without backup.
- The installer does not start long-running PM2 service unless the user opts in during setup.
