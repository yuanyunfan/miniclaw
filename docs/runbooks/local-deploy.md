# MiniClaw Local Deploy Runbook

> 结论：MiniClaw deploy 的目标是让本机 PM2 runtime 安全切到一个已验证版本。不要把 GitHub push 直接绑定到自动 restart；deploy 必须经过 build、safe restart 和 health verification。

## Standard Deploy

```bash
git fetch origin
git checkout main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run build
pnpm safe-restart
pnpm run doctor
```

Then verify in Discord:

```text
/health
/agent-config
```

## Release Deploy

To deploy a specific release:

```bash
git fetch origin --tags
git checkout v1.0.0
pnpm install --frozen-lockfile
pnpm run build
pnpm safe-restart
pnpm run doctor
```

Use a detached release checkout only when you intentionally want the runtime pinned to a release tag. For normal development and Auto Doctor repair flow, deploy from `main`.

## Safe Restart Boundary

`pnpm safe-restart` refuses to restart when active MiniClaw tasks or active chats exist. Do not use `pm2 restart miniclaw` as the default deploy command.

If safe restart is deferred:

1. Let active tasks/chats finish.
2. Re-run `pnpm safe-restart`.
3. Check `/health`.

Use `--force` only for an explicit operator decision where interrupting work is acceptable.

## Rollback

Rollback to the previous release tag:

```bash
git fetch origin --tags
git checkout v<previous-version>
pnpm install --frozen-lockfile
pnpm run build
pnpm safe-restart
pnpm run doctor
```

If the bad release already changed persisted state, inspect `CHANGELOG.md` and the release notes for schema/config migration notes before rollback.

## Verification

Deploy is complete only after:

- PM2 app is online.
- `pnpm run doctor` has no critical MiniClaw runtime issue.
- Discord `/health` returns successfully.
- Cron failures, provider auth failures, and task failures are understood or tracked as incidents.
