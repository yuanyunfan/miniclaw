# Connectivity Monitor With Email Fallback

Status: completed
Date: 2026-05-08

## Background

MiniClaw cron/task output depends on Discord. The user often needs VPN/proxy connectivity for Discord; when that link drops, cron jobs may still run locally but Discord delivery can fail. Existing cron failure alerts also use Discord, so they cannot report a Discord outage.

## Goals

1. Add an in-process connectivity monitor that runs every 30-60 seconds.
2. Check Discord gateway readiness, Discord REST reachability, general HTTPS reachability, and SMTP reachability.
3. Persist sanitized state to `~/.miniclaw/runtime/connectivity.json`.
4. After 3 consecutive failures, send an out-of-band email alert when general network and SMTP are reachable but Discord is not.
5. Send a recovery email once Discord connectivity recovers.
6. Keep this separate from cron jobs and from the read-only email query capability.

## Non-Goals

- Do not implement launchd/pm2 external watchdog in this slice.
- Do not auto-reconnect VPN.
- Do not send periodic Discord heartbeat messages.
- Do not store SMTP credentials in runtime state or logs.
- Do not change cron YAML format.

## Existing Architecture Evidence

- `src/index.ts` starts the Discord bot and scheduler after `ClientReady`.
- `src/cron/scheduler.ts` handles cron retries and Discord failure buttons.
- `src/capabilities/email` is intentionally read-only and should remain read-only.
- The project already supports layered `~/.miniclaw/config.yaml` config through `src/config.ts`.

## Implementation Plan

1. Extend config with `connectivity` and `notifications.email` settings, including backward-compatible `email.smtp_*` keys.
2. Add a generic SMTP notifier module under `src/notifications/`.
3. Add pure connectivity core functions for classification, state persistence, and email subject/body generation.
4. Add a runtime monitor that binds the core to Discord client checks and SMTP/HTTPS probes.
5. Start/stop the monitor from `src/index.ts`; skip by default in E2E mode.
6. Add unit tests for config parsing, classification, alert/recovery emails, and SMTP message behavior.
7. Update architecture/email docs.

## Verification Plan

- `pnpm vitest run src/monitoring src/notifications src/__tests__/config.test.ts`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run e2e:cron`

## Risks And Rollback

- Risk: SMTP auth or provider rate limits if checked too aggressively.
  - Mitigation: default interval is 60s; SMTP check is reachability-only, while actual auth is used only when sending alerts.
- Risk: False positives during brief VPN reconnects.
  - Mitigation: alert only after configurable consecutive failures, default 3.
- Risk: Missing email config makes fallback impossible.
  - Mitigation: monitor still writes state and logs sanitized warning; no startup failure.
- Rollback: disable with `connectivity.enabled: false` or `MINICLAW_CONNECTIVITY_MONITOR_ENABLED=false`.

## Documentation Sync

- `docs/architecture.md`: monitor and runtime state.
- `docs/archive/features/07-email-capability.md`: clarify SMTP notifier is separate from read-only email capability.
- Add feature doc for connectivity monitor if needed.

## Execution Notes

- Implemented `connectivity` and `notifications.email` config, including backward-compatible top-level `email.smtp_*` settings.
- Added `src/notifications/smtp-email.ts` as a generic SMTP notifier for system alerts. It is separate from the read-only email capability.
- Added `src/monitoring/connectivity-core.ts` for pure classification/state/alert logic.
- Added `src/monitoring/connectivity-monitor.ts` and start/stop integration in `src/index.ts`.
- Added unit tests for config parsing, connectivity classification/alerting, and SMTP message helpers.
- Verified with:
  - `pnpm run typecheck`
  - `pnpm vitest run src/monitoring src/notifications src/__tests__/config.test.ts`
  - `pnpm run lint`
  - `pnpm run e2e:cron`
  - `pnpm run quality:g0`
  - `pnpm run quality:secrets`
