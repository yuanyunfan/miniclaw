# Auto Doctor

Status: phase-1-read-only

## Summary

Auto Doctor is MiniClaw's read-only runtime diagnosis path. It collects local evidence from task DB rows, cron state, PM2, logs, connectivity state, and Git state, then produces a concise diagnosis without modifying files, DB state, Git history, or PM2 runtime.

This is the first slice of the broader self-repair plan. It does not implement incident persistence, automatic code repair, automatic commit/push, or live self-update.

## Commands

Local CLI:

```bash
pnpm run doctor
pnpm run doctor -- --task <task-id-prefix>
pnpm run doctor -- --cron <job-name>
pnpm run doctor -- --json
```

Discord:

```text
/doctor
/doctor task_id:<task-id-prefix>
/doctor cron:<job-name>
```

## Evidence Sources

- SQLite task DB: recent failed, interrupted, and long-running running tasks.
- Cron state JSON: jobs whose last status is `error`.
- PM2: app status, PID, restart count, unstable restart count, and uptime.
- Logs: recent matching lines from `~/.miniclaw/logs/miniclaw-error.log` and `miniclaw-out.log`.
- Connectivity state: Discord/network/SMTP probe state.
- Git state: branch, commit SHA, remote, and dirty files.

## Diagnosis Output

Each report includes:

- incident type
- severity
- likely category
- repair-allowed flag
- evidence summary
- recommended next action

Incident types include:

- `task_failed`
- `task_interrupted`
- `task_running_too_long`
- `cron_failed`
- `discord_outage`
- `pm2_restart_loop`
- `unknown`

Categories include:

- `network`
- `discord`
- `provider_data`
- `provider_auth`
- `miniclaw_bug`
- `third_party`
- `unknown`

## Safety Boundary

Phase 1 Auto Doctor is read-only by design:

- It does not create incident rows.
- It does not edit source files.
- It does not commit or push.
- It does not restart MiniClaw.
- It does not refresh credentials or provider sessions.
- It redacts common token, cookie, password, secret, authorization, and high-entropy values from logs and errors.

If a diagnosis says `repairAllowed: yes`, that means the evidence looks compatible with a future controlled repair workflow. It does not mean MiniClaw has already repaired anything.

## Related Plan

- [`../plans/2026-05-10-miniclaw-auto-doctor-self-repair.md`](../plans/2026-05-10-miniclaw-auto-doctor-self-repair.md)
