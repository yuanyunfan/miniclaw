---
status: public-summary
source_docs:
  en:
    - docs/runbooks/install.md
    - docs/install-distribution-strategy.md
  zh:
    - docs/zh/runbooks/install.zh.md
---

# Getting Started

MiniClaw is meant to run as a local personal service. The website keeps the path short; the linked runbooks hold the full setup, troubleshooting, and distribution details.

```bash
git clone https://github.com/yuanyunfan/miniclaw.git
cd miniclaw
./install.sh
pnpm run setup
pnpm run doctor:setup
pnpm register
pnpm dev
```

## First Run Checklist

- **Install dependencies**: `./install.sh` prepares the local project without writing real tokens.
- **Create local config**: `pnpm run setup` writes `.env` and `~/.miniclaw/config.yaml`, backing up existing files.
- **Register Discord commands**: `pnpm register` syncs slash commands for the configured guild.
- **Start the runtime**: `pnpm dev` runs the bot through the TypeScript watcher.
- **Verify in Discord**: `/health` checks runtime health; `@MiniClaw hello` checks chat intake.

## Configuration Model

```mermaid
flowchart LR
  Env[.env secrets + bootstrap] --> Loader[Config Loader]
  Yaml[~/.miniclaw/config.yaml] --> Loader
  Loader --> Runtime[Runtime Config]
  Runtime --> Discord[Discord]
  Runtime --> Agent[Claude / Codex]
  Runtime --> Providers[Providers]
```

Use `~/.miniclaw/` for personal config and state. Keep repo files reusable, reviewable, and free of credentials.
