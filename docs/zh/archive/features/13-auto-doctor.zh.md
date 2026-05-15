---
doc_id: auto-doctor
lang: zh
translation_of: docs/archive/features/13-auto-doctor.md
translation_status: not_required
---

# Auto Doctor

状态：`phase-4b-guarded-ship`

## 概要

Auto Doctor 是 MiniClaw 的只读运行时诊断路径。它会从 task DB 记录、cron 状态、PM2、日志、connectivity 状态和 Git 状态中收集本地证据，然后生成简洁诊断；不会修改文件、DB 状态、Git 历史或 PM2 运行态。

这是更大范围 self-repair 计划的第一段能力。Phase 2 增加 incident 持久化和可选的每小时只读诊断循环。Phase 3A 增加可在隔离 worktree 中运行的 guarded repair worker。Phase 3B 会把验证通过的修复提交到隔离 repair branch。Phase 4A 可以选择推送该 repair branch。Phase 4B 增加显式 operator approval 的 ship 路径，可以从已推送的 repair branch fast-forward `main`，并可选择调用 safe restart。

## 命令

本地 CLI：

```bash
pnpm run doctor
pnpm run doctor -- --task <task-id-prefix>
pnpm run doctor -- --cron <job-name>
pnpm run doctor -- --json
pnpm run doctor:repair -- --incident <incident-id>
pnpm run doctor:repair -- --incident <incident-id> --dry-run
pnpm run doctor:repair -- --incident <incident-id> --execute
pnpm run doctor:repair -- --incident <incident-id> --json
pnpm run doctor:ship -- --incident <incident-id>
pnpm run doctor:ship -- --incident <incident-id> --execute --approve-main
pnpm run doctor:ship -- --incident <incident-id> --execute --approve-main --restart
pnpm run doctor:ship -- --incident <incident-id> --json
```

Discord：

```text
/doctor
/doctor task_id:<task-id-prefix>
/doctor cron:<job-name>
/incidents
/incident view id:<incident-id-or-prefix>
/incident resolve id:<incident-id-or-prefix> reason:<optional-reason>
/incident ignore id:<incident-id-or-prefix> reason:<optional-reason>
/incident retry-repair id:<incident-id-or-prefix>
/incident ship-preview id:<incident-id-or-prefix>
```

自动扫描：

- 默认禁用，直到显式配置。
- 通过 `doctor.auto_diagnose_enabled: true` 或 `MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED=true` 启用。
- 默认间隔为 1 小时：`doctor.scan_interval_ms: 3600000`。
- 摘要通知发送到 `doctor.summary_channel_id`；在用户的 MiniClaw Discord server 中应配置为 `#monitor-github`。
- 如果 `doctor.auto_repair_enabled: true`，扫描之后会把 repair-eligible incident 交给 guarded repair worker。

## 证据来源

- SQLite task DB：最近 failed、interrupted、长时间 running 的 task。
- Cron state JSON：最近状态为 `error` 的 job。
- PM2：app 状态、PID、restart count、unstable restart count 和 uptime。
- 日志：`~/.miniclaw/logs/miniclaw-error.log` 和 `miniclaw-out.log` 中最近匹配的行。
- Connectivity state：Discord/network/SMTP probe 状态。
- Git state：branch、commit SHA、remote 和 dirty files。

## 诊断输出

每份报告包含：

- incident type
- severity
- likely category
- repair-allowed flag
- evidence summary
- recommended next action

Incident types 包括：

- `task_failed`
- `task_interrupted`
- `task_running_too_long`
- `cron_failed`
- `discord_outage`
- `pm2_restart_loop`
- `unknown`

Categories 包括：

- `network`
- `discord`
- `provider_data`
- `provider_auth`
- `miniclaw_bug`
- `third_party`
- `unknown`

## Incident 持久化

启用自动诊断后，MiniClaw 会把可行动症状保存为 incidents：

- task failures、interrupted tasks、long-running tasks
- cron failures
- connectivity degradation
- PM2 unstable restarts

Incidents 使用确定性的 dedupe keys，因此重复的每小时扫描会更新同一个 incident，而不是重复发送 alert。`/health` 会包含 open incident count，`/incidents` 会列出 open incidents。

## Incident 详情与生命周期

`/incident view` 会把一个已持久化的 incident 渲染为 operator detail view。该命令接受完整 incident id 或唯一前缀，然后展示：

- status、severity、type、title、subject 和 timestamps
- diagnosis category、repair-allowed flag 和 recommended action
- source metadata，例如 task id、cron name、channel id，以及存在时的 Discord message URL
- latest repair run 的 branch、commit SHA、workspace 和 completion state
- recent incident events
- 建议的后续 operator commands

Lifecycle commands 会保留 incident record 的审计性：

- `/incident resolve` 把已修复或不再相关的 incident 标记为 `resolved`。
- `/incident ignore` 把 non-actionable incident 标记为 `ignored`。
- `/incident retry-repair` 把符合条件的 incident 重新开放为 `diagnosed`，让 hourly Auto Doctor scheduler 按现有 repair policy 和 rate limit 再尝试 repair。
- `/incident ship-preview` 运行 guarded `doctor:ship` dry-run path，并记录 `ship_preview_requested` event。

Resolved 和 ignored incidents 会从默认 `/incidents` open list 中排除。Retry repair 不会在 Discord interaction 中执行长时间 repair，也不会绕过 `doctor.auto_repair_enabled`、category/type policy、path allowlists、dirty-worktree checks 或 approval gates。

## Guarded Repair Worker

`doctor:repair` 会加载一个已持久化的 incident，并在做任何工作之前评估 repair policy。默认模式是 dry-run，会打印目标 isolated worktree、repair branch、policy result 和生成的 repair prompt，但不会创建 worktree，也不会运行 Codex。

Execute mode 是有意加 gate 的：

- 必须设置 `doctor.auto_repair_enabled=true`；除非 operator 显式使用 `--force` 覆盖。
- provider auth、provider data、network、Discord 和 third-party incidents 会被拒绝为 non-repairable。
- worker 会在 `doctor.repair_worktree_root` 下创建或复用 isolated worktree。
- 在让 Codex 编辑文件之前，worker 会拒绝 dirty repair worktree。
- changed files 必须匹配 `doctor.allowed_paths`，且不能匹配 `doctor.blocked_paths`。
- verification 会运行 `pnpm run quality:g0`、`pnpm run quality:secrets`、当 changed files 能明确映射到测试区域时运行 targeted Vitest、`pnpm run typecheck`、`pnpm run lint`、`pnpm test` 和 `pnpm run build`。
- verification 通过且 `doctor.auto_commit_enabled=true` 时，worker 只 stage changed repair files，并在 `doctor-repair/<incident-id>` 上创建 commit。
- 当 `doctor.auto_push_enabled=true` 时，worker 只把 isolated repair branch 推送到 `origin`；永远不会推送到 `main`。

成功 verification 会让 incident 进入 `repair_ready`，并把 repair report 存入 `repair_runs`。如果启用了 auto commit，`repair_runs.commit_sha` 会记录 repair branch commit。Agent 执行失败、触碰 forbidden paths、verification 失败或 commit 失败时，incident 会进入 `repair_blocked`，并保留证据供 review。

启用 automatic repair 后，每小时 scheduler 会在尝试 repair 前应用同样的 worker policy 和 rate limit：

- `doctor.max_parallel_repairs` 限制 active `repairing` runs。
- `doctor.max_repairs_per_day` 限制每个 UTC 日的新 repair runs。
- 已处于 `repair_blocked`、`repairing` 或 `repair_ready` 的 incidents 不会被后续每小时扫描降级。
- 每次 repair attempt 都会向 `doctor.summary_channel_id` 发送简洁结果摘要。

## Guarded Ship

`doctor:ship` 是 pushed repair branch 与 live MiniClaw runtime 之间的显式 approval boundary。默认是 dry-run：

```bash
pnpm run doctor:ship -- --incident <incident-id>
```

该命令加载 incident 最新的 `repair_runs` 记录，并要求 `status=repair_pushed`、存在 branch 和 commit SHA。它不会运行 Codex，也不会修改 source files。

当 `doctor.require_approval_for_main=true` 时，main update 需要显式 approval：

```bash
pnpm run doctor:ship -- --incident <incident-id> --execute --approve-main
```

已批准路径被故意限制得很窄：

- 必须从干净的 live `main` worktree 运行。
- 只 fetch pushed `doctor-repair/<incident-id>` branch。
- 验证 fetched branch head 等于记录的 repair commit SHA。
- 只通过 `git merge --ff-only` 更新 `main`。
- fast-forward 成功后推送 `HEAD:main`。
- 标记 incident 为 `shipped` 并记录 `repair_main_updated` event。

Live restart 是 opt-in：

```bash
pnpm run doctor:ship -- --incident <incident-id> --execute --approve-main --restart
```

Restart 路径会通过独立命令使用的同一套 safe-restart 实现来调用 `pnpm safe-restart`。它永远不会传入 `--force`。如果存在 active tasks，restart 会被 deferred，记录 `live_restart_deferred`，patch 仍是 shipped，但 live runtime 尚未 restart。

当 repair branch 已推送时，发送到 `doctor.summary_channel_id` 的 repair summaries 会包含 preview、ship、ship-plus-restart 命令。

## 安全边界

Auto diagnosis 按设计保持只读：

- 不编辑 source files。
- 不 commit 或 push。
- 不 restart MiniClaw。
- 不 refresh credentials 或 provider sessions。
- 会从 logs 和 errors 中 redact 常见 token、cookie、password、secret、authorization 和 high-entropy values。

Repair worker 只有在 execute mode 下才能编辑 isolated repair worktree。它可以把验证通过的 patches commit 到 isolated repair branch，并在配置允许时把该 branch push 到 `origin`。它不会 push 或 merge 到 `main`，不会 restart MiniClaw，也不会修改 live main worktree。

只有 `doctor:ship --execute --approve-main` 可以更新 `main`，且只能从 pushed repair branch fast-forward。只有 `doctor:ship --restart` 可以请求 live restart，而且必须通过不带 force 的 safe-restart。

如果诊断显示 `repairAllowed: yes`，意思是证据看起来适合 controlled repair workflow，并不表示 MiniClaw 已经完成任何修复。

## 相关计划

- `../plans/2026-05-10-miniclaw-auto-doctor-self-repair.md`
