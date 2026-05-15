---
doc_id: install-runbook
lang: zh
translation_of: docs/runbooks/install.md
translation_status: current
source_sha256: acf53226f9a9e4144544f9ea492cb709e014d2823162c3f3e33a347c7840490b
---
# MiniClaw Install Runbook

> 结论：MiniClaw 1.0 的安装路径面向技术用户。先 clone repo，再用 `install.sh` 初始化依赖和本机目录，用 `pnpm run setup` 写入最小 Discord/provider 配置，最后用 `doctor:setup` 验证环境。

## Prerequisites

- macOS 或 Linux shell environment。
- Node.js 22+。
- Discord application 和 bot token。
- Discord guild id 和 allowed user id。
- 使用 Codex 时，需要本机 Codex login 或 OpenAI API key。
- 使用 Claude 时，需要 Anthropic API key。
- PM2 只用于 production local long-running mode。

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

使用 `pnpm run setup`，不要使用 `pnpm setup`；后者是 pnpm 自己的 shell configuration command。

Expected results:

- Repo root 下存在 `.env`。
- 存在 `~/.miniclaw/config.yaml`。
- `pnpm run doctor:setup` 没有 `FAIL` rows。
- Bot 启动后 Discord `/health` 可用。

## Production Local Run

```bash
pnpm run build
pm2 start ecosystem.config.cjs
pm2 status miniclaw
```

MiniClaw 默认把 PM2 logs 写到 `~/.miniclaw/logs/`。

## Safe Reconfiguration

当 Discord ids、provider choice、Smart Router 或 PM2 preference 变化时，重新运行 `pnpm run setup`。已有 `.env` 和 `~/.miniclaw/config.yaml` 会在 rewrite 前备份。

Command schema 变化或首次安装后，运行：

```bash
pnpm register
```

Runtime config 变化后，通过安全边界 restart：

```bash
pnpm safe-restart
```

## Troubleshooting

Run:

```bash
pnpm run doctor:setup
```

Common failures:

- `DISCORD_TOKEN missing or placeholder`: 运行 `pnpm run setup` 并提供 bot token。
- `discord.* missing or placeholder`: 在 setup 中填写 Discord client/guild/user ids。
- `Claude provider key missing`: 设置 `ANTHROPIC_API_KEY` 或选择 Codex。
- `Codex provider auth WARN`: 运行本机 `codex login` 或设置 `OPENAI_API_KEY`。
- `PM2 not installed`: 只有需要 production local run 时才安装 PM2。

## Non-Goals

- Installer 不创建 Discord application。
- Installer 不复制 private provider sessions。
- Installer 不在没有 backup 的情况下覆盖 existing user config。
- 除非用户在 setup 中选择，否则 installer 不启动 long-running PM2 service。
