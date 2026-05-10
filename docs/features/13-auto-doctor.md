# Auto Doctor

Status: phase-3b-repair-branch-commit

## Summary

Auto Doctor is MiniClaw's read-only runtime diagnosis path. It collects local evidence from task DB rows, cron state, PM2, logs, connectivity state, and Git state, then produces a concise diagnosis without modifying files, DB state, Git history, or PM2 runtime.

This is the first slice of the broader self-repair plan. Phase 2 adds incident persistence and an optional hourly read-only diagnosis loop. Phase 3A adds a guarded repair worker that can run in an isolated worktree. Phase 3B commits verified repairs to the isolated repair branch. It still does not implement automatic push to `main` or live self-update.

## Commands

Local CLI:

```bash
pnpm run doctor
pnpm run doctor -- --task <task-id-prefix>
pnpm run doctor -- --cron <job-name>
pnpm run doctor -- --json
pnpm run doctor:repair -- --incident <incident-id>
pnpm run doctor:repair -- --incident <incident-id> --dry-run
pnpm run doctor:repair -- --incident <incident-id> --execute
pnpm run doctor:repair -- --incident <incident-id> --json
```

Discord:

```text
/doctor
/doctor task_id:<task-id-prefix>
/doctor cron:<job-name>
/incidents
```

Automatic scan:

- Disabled by default until configured.
- Enable with `doctor.auto_diagnose_enabled: true` or `MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED=true`.
- Default interval is one hour: `doctor.scan_interval_ms: 3600000`.
- Summary notifications go to `doctor.summary_channel_id`, which should be configured to `#monitor-github` on the user's MiniClaw server.
- If `doctor.auto_repair_enabled: true`, repair-eligible incidents are passed to the guarded repair worker after the scan.

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

## Incident Persistence

When automatic diagnosis is enabled, MiniClaw stores actionable symptoms as incidents:

- task failures, interrupted tasks, and long-running tasks
- cron failures
- connectivity degradation
- PM2 unstable restarts

Incidents use deterministic dedupe keys, so repeated hourly scans update the same incident instead of posting duplicate alerts. `/health` includes the open incident count, and `/incidents` lists open incidents.

## Guarded Repair Worker

`doctor:repair` loads one persisted incident and evaluates the repair policy before doing any work. The default mode is dry-run, which prints the target isolated worktree, repair branch, policy result, and generated repair prompt without creating a worktree or running Codex.

Execute mode is intentionally gated:

- `doctor.auto_repair_enabled` must be `true`, unless `--force` is used for an explicit operator override.
- provider auth, provider data, network, Discord, and third-party incidents are refused as non-repairable.
- the worker creates or reuses an isolated worktree under `doctor.repair_worktree_root`.
- the worker refuses a dirty repair worktree before asking Codex to edit files.
- changed files must match `doctor.allowed_paths` and must not match `doctor.blocked_paths`.
- verification runs `pnpm run quality:g0`, `pnpm run quality:secrets`, targeted Vitest when changed files map cleanly to a test area, `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm run build`.
- when verification passes and `doctor.auto_commit_enabled` is true, the worker stages only the changed repair files and creates a commit on `doctor-repair/<incident-id>`.

Successful verification leaves the incident in `repair_ready` and stores the repair report in `repair_runs`. If auto commit is enabled, `repair_runs.commit_sha` records the repair branch commit. Failed agent execution, forbidden paths, failed verification, or commit failure leave the incident in `repair_blocked` with the evidence stored for review.

When automatic repair is enabled, the hourly scheduler applies the same worker policy and rate limits before attempting repair:

- `doctor.max_parallel_repairs` limits active `repairing` runs.
- `doctor.max_repairs_per_day` limits new repair runs per UTC day.
- incidents already in `repair_blocked`, `repairing`, or `repair_ready` are not downgraded by later hourly scans.
- every repair attempt posts a concise result summary to `doctor.summary_channel_id`.

## Safety Boundary

Auto diagnosis remains read-only by design:

- It does not edit source files.
- It does not commit or push.
- It does not restart MiniClaw.
- It does not refresh credentials or provider sessions.
- It redacts common token, cookie, password, secret, authorization, and high-entropy values from logs and errors.

The repair worker can edit only the isolated repair worktree in execute mode. It can commit verified patches to the isolated repair branch, but it does not push, merge to `main`, restart MiniClaw, or modify the live main worktree.

If a diagnosis says `repairAllowed: yes`, that means the evidence looks compatible with the controlled repair workflow. It does not mean MiniClaw has already repaired anything.

## Related Plan

- [`../plans/2026-05-10-miniclaw-auto-doctor-self-repair.md`](../plans/2026-05-10-miniclaw-auto-doctor-self-repair.md)
