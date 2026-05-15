# MiniClaw Install And Distribution Strategy

> Conclusion: MiniClaw 1.0 should use GitHub Releases plus a repo installer as the stable distribution path. It should not be positioned as a direct public npm runtime yet. The target user is technical: able to clone a repo, create a Discord application, configure credentials, run `pnpm`, and keep a local PM2 process alive.

## Product Boundary

MiniClaw is a local-first Discord-native integration hub. It runs on the user's own Mac, interacts through Discord, and stores configuration, secrets, cron state, SQLite state, provider sessions, and logs under `~/.miniclaw/`.

That makes it different from a normal npm library or cloud SaaS product:

- Installation requires local environment checks.
- Runtime requires Node 22, pnpm, and optionally PM2.
- Claude, Codex, MCP, proxy, and CLI configuration may already exist on the user's machine.
- WeChat, email, stock, and other account-backed providers are progressive capabilities, not first-run blockers.
- Deployment means a local long-running PM2 app, not a cloud service.

The install experience should therefore be layered: run the minimal bot first, then enable cron, providers, Auto Doctor, and private-data capabilities on demand.

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

A one-line install command can be introduced later:

```bash
curl -fsSL https://raw.githubusercontent.com/yuanyunfan/miniclaw/main/install.sh | bash
```

Until the installer has more production mileage, the clone-and-review path should remain the documented default because users can inspect scripts before running them.

## Installer Requirements

`install.sh` should automate environment preparation only.

It should:

- check `node >= 22`
- enable `corepack`
- prepare the pnpm version declared by the repo
- run `pnpm install --frozen-lockfile`
- create `~/.miniclaw/`
- copy `config.example.yaml` to `~/.miniclaw/config.yaml` only when missing
- create a minimal `.env` only when missing
- optionally install Git hooks
- suggest PM2 installation when missing
- run `pnpm run build` as basic validation

It should not:

- write real tokens automatically
- overwrite existing `~/.miniclaw/config.yaml`
- register Discord slash commands without explicit confirmation
- start PM2 without explicit confirmation
- move provider account setup into the first-run blocker path

## Setup Wizard

`pnpm run setup` should collect only the minimum required data:

- Discord bot token
- Discord client ID
- Discord guild ID
- allowed user ID
- default runtime: `codex` or `claude`
- whether to enable Smart Router
- whether to register slash commands now
- whether to configure PM2

Output targets:

- `.env` for secrets and early process environment
- `~/.miniclaw/config.yaml` for structured configuration

Security rules:

- show the target path before writing
- never write tokens into repo examples
- never overwrite `.env` by default
- back up or show a diff before changing existing files
- write Discord IDs as strings so YAML does not coerce large IDs into unsafe numbers

## Setup Doctor

`pnpm run doctor:setup` should turn installation failures into readable diagnostics.

Checks should include:

- Node, pnpm, and optional PM2 availability
- `pnpm install --frozen-lockfile`
- `pnpm run build`
- `.env` existence and required keys
- `~/.miniclaw/config.yaml` existence and Discord ID string handling
- Discord token, client ID, guild ID, and allowed user ID presence
- slash command registration status
- PM2 app existence, online status, and restart loop detection

Example output:

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

README installation docs should stay layered:

1. Five-minute local bot:
   - install dependencies
   - create config
   - fill minimum Discord fields
   - register slash commands
   - run `pnpm dev` or PM2
   - test `/health` and `@MiniClaw hello`
2. Durable local runtime:
   - `pnpm run build`
   - `pm2 start ecosystem.config.cjs`
   - `pnpm safe-restart`
   - inspect `~/.miniclaw/logs/`
   - use `/health` and `pnpm run doctor`
3. Advanced capabilities:
   - Smart Router
   - task intake channels
   - cron jobs
   - WeChat provider
   - email provider
   - stock providers
   - Auto Doctor
   - Stage and Ralph experiments

## Config Example Shape

`config.example.yaml` should separate the minimal runnable config from advanced examples.

Minimal profile:

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

Advanced provider and cron examples should live in lower commented sections or in `docs/providers/**/*.md`, not in the first-run path.

## Release Boundary

GitHub Releases should be the 1.0 release boundary because MiniClaw is still a repo-first local runtime.

Release artifacts should include:

- signed or clearly tagged `vX.Y.Z` source
- release notes from `CHANGELOG.md`
- source archive or tarball
- install and upgrade notes
- breaking changes and migration notes
- whether slash commands must be re-registered
- whether DB schema or config changed

The npm package should wait until MiniClaw has a stable CLI surface, `bin`/`exports` boundary, and clearer user expectations.

## Docker Position

Docker can be a later deployment option, but it is not the first-stage install path. MiniClaw currently depends on local Discord, Claude/Codex, MCP, provider sessions, PM2, and `~/.miniclaw/` state. Containerizing that boundary too early would make first-run setup harder rather than easier.
