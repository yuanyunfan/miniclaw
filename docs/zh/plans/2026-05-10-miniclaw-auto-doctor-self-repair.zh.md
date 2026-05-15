---
doc_id: miniclaw-auto-doctor-self-repair-plan
lang: zh
translation_of: docs/plans/2026-05-10-miniclaw-auto-doctor-self-repair.md
translation_status: current
source_sha256: 83e5213b93804a2ec7feda4bec458c3c3a3a520558abc395038fb97e2b01bf5b
---
# MiniClaw Auto Doctor 与自我修复循环

状态：`in_progress`
日期：2026-05-10

## 背景

MiniClaw 现在已经作为一个长期运行的 Discord task runner 使用。故障经常表现为 Discord task 错误、cron 失败、chat 回复错误、被 interrupted 的 task rows、PM2 restart，或 connectivity outage。当前运维模式仍然偏手动：用户先看到症状，再要求 MiniClaw 或 Codex 检查 logs/DB/state，然后再要求做代码修复。

目标方向是一个受控的 self-evolution loop：MiniClaw 应该能检测运行时问题、收集证据、产出诊断；对于安全、低风险的场景，可以运行隔离的 repair workflow 来创建经过验证的 patch。只有在 quality gates 通过且 restart safety checks 满足后，才允许 commit、push，并可选地更新正在运行的 PM2 app。

关键设计约束是：MiniClaw 主进程不能盲目修改或重启自己。安全形态应该是 runtime 中的 Auto Doctor，加上独立的 Self-Repair Worker。

## 目标

1. 自动从 task、cron、PM2、log 和 connectivity state 中检测 incidents。
2. 保留足够诊断上下文，避免用户需要手动把日志粘贴到 Discord。
3. 让 MiniClaw 为每个 incident 生成结构化 root-cause report。
4. 支持 guarded repair workflow，可以在隔离 workspace 中生成 patch。
5. 在任何 commit 或 push 之前运行 targeted tests 和现有 quality gates。
6. 使用 `pnpm safe-restart` 进行 runtime update，并在存在 active tasks 时拒绝 restart。
7. 保证每次 repair 都可审计：incident record、evidence bundle、diff、verification output、commit SHA、push target 和 restart result。

## 非目标

- 不允许 Discord bot 主进程直接编辑 main working tree。
- 不自动修复 secrets、account sessions、cookies、credentials 或 auth failures。
- 不自动 force-push、不 rewrite history、不运行 destructive Git operations。
- 不自动把大型架构改动 merge 到 `main`。
- 不绕过现有 quality gates。
- 不把每个 task failure 都当作 MiniClaw code bug；用户 prompt 问题、provider data 缺失、network outage 和 third-party failure 必须继续单独分类。

## 现有架构证据

- `src/store/db.ts` 持久化 task rows，状态值包括 `running`、`interrupted`、`completed`、`failed` 和 `cancelled`，并保存 Discord source metadata。
- `src/agent/task.ts` 负责进程内 active task tracking、cancellation、graceful drain wait 和 interrupted-task persistence。
- `src/agent/recovery.ts` 在启动时把 stale running tasks 标记为 interrupted，并把 recovery guidance 发到 Discord threads。
- `src/runtime/shutdown.ts` 是共享 draining-state holder；drain 激活后会拒绝新 work。
- `src/index.ts` 负责 graceful shutdown 路径：停止 monitor/scheduler、等待 task drain、只在 timeout 后 interrupt remaining tasks，然后退出。
- `src/cron/scheduler.ts` 记录 cron run status、retry failures，并可以发送或更新 Discord failure alerts。
- `src/monitoring/connectivity-monitor.ts` 和 `src/monitoring/connectivity-core.ts` probe Discord、general network 和 SMTP reachability，然后持久化 runtime connectivity state。
- `src/ops/safe-restart.ts` 会在 MiniClaw SQLite DB 中存在 `status='running'` tasks 时拒绝 PM2 restart，除非显式提供 `--force`。
- `package.json` 暴露 `quality:commit` 和 `quality:push`；Git hooks 会在 commit 和 push 之前调用这些 gates。
- `src/routing/intent.ts` 已经把 “任务失败”、“回复出错”、“排查” 和 “why fail” 这类 runtime diagnostics 词汇识别为 task-like work，而不是 lightweight chat。

## 提议架构

### 1. Incident Detector

增加一个 detector layer，定期扫描 runtime sources，并把症状标准化为 incidents。

输入来源：

- SQLite task DB：最近的 `failed`、`interrupted` 和 long-running `running` rows。
- Cron state：`last_status='error'` 的 jobs、retry metadata 和 last error text。
- PM2 state：restart count、status、uptime、unstable restart loops。
- MiniClaw logs：`~/.miniclaw/logs/miniclaw-error.log` 中最近的 error lines，以及选定的 out log windows。
- Connectivity state：`~/.miniclaw/runtime/connectivity.json`。
- Git state：current commit SHA、branch、dirty status、remote 和 local hook availability。

建议的 incident types：

- `task_failed`
- `task_interrupted`
- `task_running_too_long`
- `cron_failed`
- `chat_error`
- `discord_outage`
- `pm2_restart_loop`
- `quality_gate_failed`

### 2. Auto Doctor

Auto Doctor 是只读的。它应该收集证据、分类故障，并把诊断发送到 Discord。

期望的 diagnosis fields：

- incident id
- severity
- likely category：`user_prompt`、`network`、`discord`、`provider_data`、`provider_auth`、`miniclaw_bug`、`third_party`、`unknown`
- affected task id / cron job / thread / message URL
- evidence summary
- suspected root cause
- whether repair is allowed by policy
- recommended next action

这一层应该先启用，因为它不会修改代码或 runtime state，安全性最高。

### 3. Self-Repair Worker

Self-Repair Worker 是一个独立 CLI/script，不应该嵌入长期运行的 Discord bot 逻辑中。

建议命令：

```bash
pnpm doctor:repair -- --incident <incident-id>
```

Worker responsibilities：

1. 加载 incident 和 evidence bundle。
2. 如果 main workspace dirty，则拒绝运行，除非显式配置使用 separate worktree。
3. 在如下路径下创建或复用 isolated repair worktree：

```text
~/ProjectRepo/miniclaw-repairs/<incident-id>
```

4. 用 incident report 作为输入，让 coding agent 实现一个窄范围修复。
5. 当 bug 可测试时，要求 failing test 或 targeted test。
6. 运行 verification gates。
7. 产出 repair report，包含 changed files、diff summary、tests 和 remaining risks。

### 4. Ship Controller

Ship Controller 决定一个 repair 是否可以 commit、push 和 deploy。

默认策略：

- 只有低风险、allowlisted changes 且 verification 通过时，才允许 auto commit。
- Auto push 初期应该指向 repair branch，而不是 `main`。
- 更新 live PM2 app 必须通过 `pnpm safe-restart`。
- 存在 active MiniClaw tasks 时拒绝 restart。
- 在系统证明自身可靠之前，main-branch push 或 live restart 应要求显式 approval。

低风险 allowlist 候选：

- Smart router false positive/negative fixes。
- Task metadata/context propagation bugs。
- Cron runner bugs。
- Cron failure alert formatting bugs。
- 带 fixture-based tests 的 provider parsing bugs。
- Typed error handling improvements。

始终要求 approval：

- Secrets、credentials、cookies、sessions、auth config。
- Git history operations。
- Schema migrations。
- Destructive file operations。
- Large refactors 或 cross-cutting architecture changes。
- active tasks 存在时的任何 forced restart。

## 数据模型

在 read-only doctor prototype 证明有价值后增加 tables。

```sql
CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  subject_id TEXT,
  subject_type TEXT,
  source_json TEXT,
  evidence_json TEXT,
  diagnosis_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE incident_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);

CREATE TABLE repair_runs (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  status TEXT NOT NULL,
  workspace_path TEXT,
  branch TEXT,
  base_sha TEXT,
  commit_sha TEXT,
  verification_json TEXT,
  report_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);
```

Incident statuses：

- `open`
- `diagnosing`
- `diagnosed`
- `repair_blocked`
- `repairing`
- `repair_ready`
- `shipped`
- `resolved`
- `ignored`

## 实施计划

### Phase 1: Read-Only Doctor

1. 增加 `src/ops/doctor/` modules 来收集 evidence：
   - task DB collector
   - cron state collector
   - PM2 collector
   - log window collector
   - connectivity collector
   - git state collector
2. 增加 `scripts/doctor.ts`，支持模式：
   - `pnpm run doctor -- --recent`
   - `pnpm run doctor -- --task <task-id>`
   - `pnpm run doctor -- --cron <job-name>`
   - `pnpm run doctor -- --json`
3. 增加 Discord slash command 或 button 路径：
   - `/doctor`
   - `/doctor task_id:<id>`
   - cron failure alert button：`诊断`
4. 在 Discord 中渲染简洁诊断，不产生修改。

### Phase 2: Incident Persistence

1. 增加 `incidents` 和 `incident_events` tables。
2. 按 source 和 time window deduplicate incidents。
3. 让 task failures、cron failures、chat errors、connectivity outages 和 restart recovery 创建 incident records。
4. 在 `/health` 中展示 open incident counts。
5. 如有用，增加 `/incidents` 和 `/incident id:<id>` read-only commands。

### Phase 3: Controlled Repair Worker

1. 增加 `scripts/doctor-repair.ts`。
2. 创建 isolated repair worktrees。
3. 从 incident 生成严格 repair prompt：
   - evidence bundle
   - current architecture notes
   - allowed paths
   - required verification
   - forbidden operations
4. 先运行 targeted tests，再按需运行更广泛 gates。
5. 把 repair report 发送到 Discord。
6. 本阶段不 auto-push 到 `main`。

### Phase 4: Guarded Auto Ship

1. 增加 config：
   - `doctor.enabled`
   - `doctor.auto_diagnose_enabled`
   - `doctor.auto_repair_enabled`
   - `doctor.auto_push_enabled`
   - `doctor.auto_restart_enabled`
   - `doctor.allowed_paths`
   - `doctor.max_patch_files`
   - `doctor.require_approval_for_main`
2. 只有满足以下条件才 auto commit 和 push：
   - incident category 在 allowlist 中
   - changed paths 在 allowlist 中
   - patch size 低于阈值
   - tests pass
   - secret 和 G0 checks pass
   - target workspace 中不存在 unrelated dirty changes
3. 使用 `pnpm safe-restart --json` 做 live update。
4. 在积累足够 successful repair history 之前，main branch update 或 restart 必须要求显式 approval。

## 验证计划

Phase 1：

- 为 evidence collectors 写 fixture DB/log/state files 的 unit tests。
- 为 diagnosis rendering 和 redaction 写 unit tests。
- `pnpm run typecheck`
- `pnpm vitest run src/ops/doctor`

Phase 2：

- DB migration tests。
- Incident deduplication tests。
- `/health` formatter tests，验证 open incident counts。
- Cron failure to incident integration test。

Phase 3：

- 使用 temporary Git repos 测试 worktree creation。
- Repair policy tests，覆盖 dirty main workspace、forbidden paths 和 blocked incident categories。
- Verification runner tests，覆盖 pass/fail propagation。
- 使用 synthetic incident 做 manual dry run。

Phase 4：

- End-to-end dry run：创建 synthetic bug incident、repair branch、test、commit，并禁用 push。
- Safe restart smoke：
  - 有 running tasks：restart refused
  - 没有 running tasks：restart allowed
- Audit report snapshot tests。

## Runtime 与安全规则

- 从所有 evidence 中 redact tokens、cookies、authorization headers、session strings 和 long high-entropy values。
- 永远不把 runtime logs、DB files、private docs 或 attachment caches 放进 commits。
- 如果 main worktree 有 unrelated dirty changes，永远不在其上运行 repair。
- Diagnostic CLIs 永远不要调用完整 `createBot()`；使用 minimal clients，或者完全不用 Discord client。
- 永远不要绕过 `pnpm safe-restart`。
- 永远不要 force-push。
- Auto Doctor 默认保持 read-only。
- Self-Repair Worker 默认禁用，除非显式配置。

## Discord UX

推荐 commands/buttons：

- `/doctor`：展示最近 incidents 和 system diagnosis summary。
- `/doctor task_id:<id>`：诊断指定 task。
- `/doctor cron:<job-name>`：诊断指定 cron job。
- `/incidents`：列出 open incidents。
- `诊断`：cron/task failure alerts 上的 button。
- `尝试修复`：diagnosis 判断 repair safe 后的 approval button。
- `部署修复`：verification passes 后的 approval button。

建议 diagnosis message 形态：

```text
MiniClaw Doctor: task_failed

Likely category: miniclaw_bug
Affected task: abc12345
Evidence:
- task status changed to failed at ...
- matching error lines ...
- current PM2 app is online, no restart loop detected

Recommended action:
- This looks repairable.
- Proposed repair scope: src/routing, src/discord tests.
- Approval required before code changes.
```

## 风险与回滚

- 风险：false diagnosis 导致不必要的 repair work。
  - 缓解：先保持 diagnosis read-only，并清晰暴露 evidence。
- 风险：automatic repair 触碰用户工作。
  - 缓解：使用 isolated worktrees，并拒绝 dirty target workspaces。
- 风险：repair push 破坏代码。
  - 缓解：要求 quality gates、path allowlist、patch-size limits 和 branch-first shipping。
- 风险：repair 在 tasks 正在运行时 restart MiniClaw。
  - 缓解：只使用 `pnpm safe-restart`；默认 refusal 保护 active tasks。
- 风险：sensitive data 泄露到 reports 或 commits。
  - 缓解：central redaction utilities，加上 commit/push 前的 G0/secrets gates。
- 回滚：通过 `doctor.enabled: false` 禁用；移除 repair worktrees；按正常流程 revert repair commits。

## 文档同步

- `docs/architecture.md`：implementation 开始后增加 Auto Doctor 和 Self-Repair Worker。
- `docs/quality-gates.md`：Phase 3 存在后记录 repair-specific verification gates。
- `docs/archive/features/`：第一个 user-facing `/doctor` command 落地后增加 feature doc。
- `README.md`：feature 可用后只增加简短 operator summary。

## 执行记录

- Phase 1 read-only Auto Doctor 已实现。
  - 增加 `pnpm run doctor` 用于本地 CLI diagnosis。`pnpm doctor` 是 pnpm builtin，本项目不应该用它调用 project script。
  - 增加 Discord read-only diagnosis 的 `/doctor` slash command。
  - 增加 task DB、cron state、PM2 state、logs、connectivity state 和 Git state collectors。
  - 增加 task failures、interrupted/long-running tasks、cron failures、Discord/connectivity issues、PM2 restart loops、provider auth/data issues 和 likely MiniClaw bugs 的 diagnosis classification。
  - 增加 `src/ops/__tests__/doctor.test.ts` 下的 tests。
- Phase 1 之后的历史记录：当时 incident DB、persistent incident deduplication、self-repair worker、auto commit/push 和 live self-update 还未实现。
- 当前 safe restart 和 graceful drain behavior 必须继续作为 runtime update boundary。
- Phase 1 后的历史 next slice 是 Phase 2：incident persistence 和 `/health` open-incident visibility。
- Phase 2 automatic diagnosis implementation 已开始。
  - 增加 hourly scanning、`#monitor-github` summary channel 和 future repair gates 的 doctor config。
  - 增加 incident、incident event 和 repair run persistence，并使用 deterministic dedupe keys。
  - 增加每小时只读 Auto Doctor scheduler，可以 create/update incidents，并且只对 new 或 severity-escalated incidents 发通知。
  - 增加 `/incidents` 和 `/health` 中的 open incident count。
  - Self-repair worker、auto commit/push 和 live self-update 当时仍 pending。
- Phase 3A code 已 shipped。
  - 增加 `pnpm run doctor:repair`，支持 guarded incident repair dry-runs 和 execute mode。
  - 增加 `doctor.repair_worktree_root` 下的 isolated repair worktree 和 branch creation。
  - 增加 repair policy gates、allowed/blocked path validation 和 verification commands。
  - Repair results 持久化到 `repair_runs`；成功 verification 会把 incidents 标记为 `repair_ready`。
  - Auto commit/push、automatic scheduler enqueueing 和 live self-update 当时仍 pending。
- Phase 3A automatic dispatch 已 shipped。
  - Hourly doctor scheduler 现在会在 `doctor.auto_repair_enabled=true` 时尝试 repair-eligible incidents。
  - Auto repair 遵守 `doctor.max_parallel_repairs` 和 `doctor.max_repairs_per_day`。
  - Repair summaries 会发送到 `doctor.summary_channel_id`。
  - 后续 hourly scans 会保留 repair lifecycle states，而不是把它们降级回 `diagnosed`。
- Phase 3B repair commit policy 已 shipped。
  - Repair verification 现在会在 commit 前运行 G0、secrets、适用时 targeted Vitest、typecheck、lint、test 和 build。
  - Verified repairs 只会 commit 到 isolated `doctor-repair/<incident-id>` branch。
  - Repair commits 使用配置的 personal project author，并包含 Codex co-author trailer。
- Phase 4A repair branch push 已 shipped。
  - 当 `doctor.auto_push_enabled=true` 时，verified repair commits 只会 push 到 isolated `doctor-repair/<incident-id>` branch。
  - Push success/failure 会记录到 incident events，并包含在 Discord repair summary 中。
  - Automatic main update 和 live self-update 仍按设计 pending；guarded operator approval 由 Phase 4B 处理。
- Phase 4B guarded ship 已 shipped。
  - 增加 `pnpm run doctor:ship`，作为 repair branch pushed 后的显式 approval boundary。
  - 默认模式是 dry-run；当 `doctor.require_approval_for_main=true` 时，main update 需要 `--execute --approve-main`。
  - Ship path 要求干净的 live `main` worktree，只 fetch 记录的 repair branch，验证 commit SHA，fast-forward `main`，然后 push `HEAD:main`。
  - 可选 `--restart` 调用不带 force 的 safe-restart；active tasks 会 defer live restart，而不是被 interrupt。
- Phase 5A incident detail and lifecycle 第一段已 shipped。
  - 增加 `/incident view`，展示 status、diagnosis、source metadata、latest repair run、recent events 和 suggested operator commands。
  - 增加 `/incident resolve` 和 `/incident ignore`；两者都会写 incident events，并把 incident 从默认 open list 中移除。
  - 增加 `/incident retry-repair`，在不绕过 repair policy 或 approval gates 的前提下，把 eligible incidents 重新开放给 hourly scheduler。
  - 增加 `/incident ship-preview`，运行 guarded `doctor:ship` dry-run path，并记录 preview event。

## 下一阶段开发计划：Hourly Doctor And Self-Repair

### 目标行为

MiniClaw 应该每小时自动运行一次 Auto Doctor，检测 actionable incidents，在 isolated workspace 中尝试 policy-allowed self-repair，并向 Discord `#monitor-github` channel 发送简洁结果摘要。

初始 self-repair 目标是 guarded automation，而不是 blind self-modification。Diagnosis 可以自动运行。Repair 只应在 allowlisted、low-risk MiniClaw code bugs 场景下自动运行。Shipping to `main` 和 live restart 应该保持保守，直到 repair loop 积累足够 successful history。

### Channel 与 Trigger 配置

增加显式 doctor config，不硬编码 channel name：

- `doctor.enabled`：默认 `true`
- `doctor.auto_diagnose_enabled`：首轮 rollout 默认 `false`，smoke tests 后再在 local config 中启用
- `doctor.scan_interval_ms`：默认 `3600000`
- `doctor.summary_channel_id`：repair summaries 的 Discord channel id；local config 应指向 `#monitor-github`
- `doctor.auto_repair_enabled`：默认 `false`
- `doctor.auto_commit_enabled`：默认 `true`；只在 `doctor.auto_repair_enabled` 允许 execute repair 后生效
- `doctor.auto_push_enabled`：默认 `false`
- `doctor.auto_restart_enabled`：默认 `false`
- `doctor.max_repairs_per_day`：默认 `2`
- `doctor.max_parallel_repairs`：默认 `1`
- `doctor.max_patch_files`：默认 `8`
- `doctor.repair_commit_author_name`：默认 `yuanyunfan`
- `doctor.repair_commit_author_email`：默认 `59247355+yuanyunfan@users.noreply.github.com`
- `doctor.require_approval_for_main`：默认 `true`
- `doctor.allowed_paths`：低风险 MiniClaw source/test/docs paths 的默认 allowlist
- `doctor.blocked_paths`：secrets、runtime state、local DB、logs、`.env`、user config、package manager auth files

Hourly trigger 应实现为 built-in runtime scheduler，而不是 user YAML cron job。Doctor loop 是 MiniClaw operations infrastructure，需要访问 incident persistence、repair policy 和 alert state；不应混进普通 user cron jobs。

### Phase 2A: Incident Persistence And Deduplication

在任何 repair logic 之前增加 DB-backed incident storage：

1. 增加 DB schema version，并添加 `incidents`、`incident_events` 和 `repair_runs`。
2. 增加 typed store functions：
   - `createOrUpdateIncident`
   - `listOpenIncidents`
   - `getIncident`
   - `appendIncidentEvent`
   - `markIncidentStatus`
   - `createRepairRun`
   - `updateRepairRun`
3. 使用 deterministic dedupe keys，避免 hourly scan 发送重复 incidents：
   - task incidents：`task:<task_id>:<status>`
   - cron incidents：`cron:<job_name>:<failure_run_id or last_run_at>`
   - PM2 restart loop：`pm2:<app>:<restart_window>`
   - connectivity outage：`connectivity:<status>:<hour_bucket>`
4. 在 `/health` 中增加 open incident counts。
5. 增加 `/incidents` 和 `/incident id:<id>` 作为 read-only operator views。

Exit criteria：

- 重复 hourly scans 会更新同一个 open incident，而不是创建 duplicates。
- `/health` 报告 open incident count。
- 此时仍没有 code repair path。

### Phase 2B: Hourly Auto Doctor Loop

增加 `src/ops/doctor-scheduler.ts`，并在 Discord `clientReady` 后从 `src/index.ts` 启动。

Loop behavior：

1. MiniClaw draining 时跳过。
2. 如果已有 doctor scan active，则跳过。
3. 对 recent task、cron、PM2、logs 和 connectivity state 运行 read-only doctor evidence collection。
4. 通过 persistence layer create 或 update incidents。
5. 对 newly opened 或 severity-escalated incidents，向 `doctor.summary_channel_id` 发送短诊断。
6. 对 repair-eligible incidents，只有当 `doctor.auto_repair_enabled=true` 时才 enqueue repair attempt。

Hourly diagnosis message 只有在存在 actionable 内容时才应发送到 `#monitor-github`。干净的 hourly scan 应只写 log，或以后发送 compact daily digest；否则 monitor channel 会很吵。

Exit criteria：

- Synthetic cron/task failures 会在下一次 scan 创建 incidents。
- Clean scans 不会 spam Discord。
- Drain state 会阻止 doctor loop 开始新的 repair work。

### Phase 3A: Self-Repair Worker

增加独立 worker CLI：

```bash
pnpm run doctor:repair -- --incident <incident-id>
pnpm run doctor:repair -- --incident <incident-id> --dry-run
pnpm run doctor:repair -- --incident <incident-id> --json
```

Worker responsibilities：

1. 加载 incident、evidence、diagnosis、policy 和 current Git state。
2. 拒绝 blocked categories：
   - provider auth/session/cookie/secret issues
   - missing third-party data
   - network/Discord outage without a MiniClaw code signal
   - dirty main worktree when no isolated worktree can be created
3. 在如下路径下创建 isolated worktree：

```text
~/ProjectRepo/miniclaw-repairs/<incident-id>
```

4. 创建 repair branch，例如：

```text
doctor-repair/<incident-id>
```

5. 生成严格 repair prompt，包含：
   - incident summary
   - evidence bundle
   - allowed and blocked paths
   - expected tests
   - safety rules
   - requirement to keep the patch small
6. 在 isolated worktree 中运行 coding agent。
7. 收集 changed files、patch stats、test output 和 final report。
8. 持久化 repair run status，并向 `#monitor-github` 发送 summary。

Worker 不应直接修改 live main worktree。主 bot 只能 enqueue 或 spawn 这个 worker，并观察其结果。

Exit criteria：

- Synthetic incident 可以生成 dry-run repair plan。
- 安全的 fixture bug 可以在 isolated worktree 中生成 patch。
- Verification 失败时保留 repair branch 和 report 供检查。

### Phase 3B: Verification And Commit Policy

增加 repair verifier，按成本递增顺序运行 staged gates：

1. `pnpm run quality:g0`
2. `pnpm run quality:secrets`
3. 根据 changed files 选择 targeted Vitest command
4. `pnpm run typecheck`
5. `pnpm run lint`
6. `pnpm test`
7. `pnpm run build`

Commit policy：

- 只有所有 required gates 通过时，才允许在 repair branch 上 auto commit。
- Commit author 必须是 personal project author。
- Commit body 必须包含 `Co-authored-by: Codex <codex@openai.com>`。
- 本阶段不 auto push 到 `main`。
- 以后可以通过 `doctor.auto_push_enabled` 启用 auto push to repair branch。

Exit criteria：

- Passing repair 会在 `doctor-repair/<incident-id>` 上创建 commit。
- Failing repair 会记录准确 failed gate，且不会 commit。
- Forbidden path changes 会在 commit 前被拒绝。

### Phase 4: Guarded Ship And Live Update

该阶段应该在 Phase 3 有真实 successful runs 之后 opt-in。

Allowed ship flow：

1. Push repair branch。
2. 向 `#monitor-github` 发送 summary，包含：
   - incident id and title
   - likely root cause
   - changed files
   - verification gates
   - commit SHA
   - branch name
   - whether live restart was attempted
3. Main-branch update 需要 explicit approval，除非 `doctor.require_approval_for_main=false`。
4. Live restart 必须使用 `pnpm safe-restart --json`。
5. 如果存在 active tasks，则 restart refused，Discord summary 应说明 patch 已 shipped，但 live update pending。

Exit criteria：

- 没有任何 repair path 可以在 tasks running 时 hard-restart MiniClaw。
- `#monitor-github` 会为每次 repair attempt 收到完整 audit summary。
- Operator 可以从 repair report approve 或手动 merge/restart。

### Phase 5: Reliability, Observability, And Operator UX

Phase 5 还不应该放松 `main` update 或 live restart approval boundary。Phase 4B 之后，系统已经能 produce、push 和 ship guarded repair branches。下一目标是让 repair loop 更容易理解、审计、retry 和改进，然后再考虑更自动化的 production updates。

#### Phase 5A: Incident Detail And Lifecycle Operations

把 incidents 变成 Discord 中的一等 operator surface：

1. 增加完整 `/incident id:<incident-id>` detail view。
2. 展示 incident status、severity、category、subject、source metadata、diagnosis、evidence summary 和 latest events。
3. 在可用时链接 related task id、cron job、Discord thread、repair run、branch、commit SHA、ship status 和 restart result。
4. 增加 guarded lifecycle operations：
   - `resolve`：把已修复或不再相关的 incident 标记为 resolved。
   - `ignore`：抑制 non-actionable incident，但不删除 evidence。
   - `retry repair`：只有 policy 仍允许时才 enqueue new repair attempt。
   - `ship preview`：当 repair 已 ready 或 pushed 时，展示准确的 `doctor:ship` command 和 dry-run output。
5. 每个 operation 都写入一条 `incident_events` row。

Exit criteria：

- `/incident id:<id>` 提供足够 evidence，让 operator 判断 diagnosis 和 repair proposal 是否可信。
- Resolved 和 ignored incidents 不再出现在默认 open incident list。
- Retry actions 不绕过 repair policy、dirty-worktree checks 或 approval gates。

#### Phase 5B: TaskReporter And Normalized Trace

通过记录 structured task events 来提升 Auto Doctor diagnosis quality，而不是主要依赖 log text：

1. 引入 `TaskViewEvent` 或等价 normalized event shape。
2. 在 task execution 与 Discord rendering 之间增加 `TaskReporter` boundary。
3. 记录关键 task lifecycle events：
   - accepted/rejected because draining
   - smart router decision
   - context and metadata capture
   - tool/provider invocation start and finish
   - provider/auth/data/network errors
   - Discord send/edit failures
   - cancellation、interruption、completion 和 recovery notices
4. 在 task rows 上保存 compact trace reference，或放入 dedicated trace table。
5. 让 incident detection 优先消费 structured trace events，再 fallback 到 raw logs。

Exit criteria：

- failed Discord task 可以先通过 structured trace data 诊断，而不是先手动阅读完整 process log。
- Auto Doctor reports 能更可靠地区分 MiniClaw bugs 与 provider data/auth/network/user-prompt failures。
- Discord progress/final-message rendering 成为 task events 的 consumer，而不是 runtime logic 的来源。

#### Phase 5C: Repair Quality Metrics And Promotion Policy

在放松 approval settings 之前增加 reliability metrics：

1. 按 incident type、category、changed file count、gate duration 和 final outcome 跟踪 repair attempts。
2. 跟踪 shipped repairs 后续是否产生 regression incidents。
3. 在 `/doctor` 或 `/incidents` 中增加 repair history summary。
4. 为未来降低 `doctor.require_approval_for_main` 定义 promotion policy：
   - minimum successful repair count
   - no recent regression incidents
   - only specific allowlisted paths
   - small patch size
   - full quality gates passed
   - no active tasks when restart is requested

Exit criteria：

- Operator 可以看到 Auto Doctor repairs 长期是否真的可靠。
- 在削弱任何 approval gate 之前，有文档化、可度量的原因。
- Blind automatic `main` update 或 forced restart 继续被禁止。

#### Phase 5D: Discord Operator Actions

让现有 guarded flow 更容易从 `#monitor-github` 执行：

1. 为以下动作增加 Discord components 或清晰 slash-command shortcuts：
   - view incident
   - retry repair
   - preview ship
   - approve guarded ship
   - request safe restart
2. 影响 `main` 或 live PM2 app 的操作必须要求 explicit approval。
3. 重新运行 CLI scripts 使用的同一套 server-side policy checks；Discord UI 不能成为 bypass。
4. 向 `#monitor-github` 回发简洁 operation summary。

Exit criteria：

- 对 routine cases，operator 可以在不离开 Discord 的情况下，从 alert 走到 diagnosis、repair preview 和 guarded ship。
- Main update 和 restart 仍要求 explicit action，并且在 tasks running 时仍尊重 safe restart refusal。

#### 后续：Incident Board 或 Dashboard

Web dashboard 不是下一优先级。只有在 Discord incident operations 和 structured trace data 已存在，并且跨 incident search、provider health boards 或更长 repair history views 在 Discord 中变得痛苦时，才增加 dashboard。

### 推荐首批实施切片

按以下顺序实现：

1. Config keys 和 `#monitor-github` summary channel resolution。
2. Incident persistence and dedupe。
3. Hourly read-only doctor scheduler。
4. Discord notification for new or escalated incidents。
5. Self-repair dry-run worker。
6. Isolated worktree repair worker with verification。
7. Auto commit to repair branch。已 shipped。
8. Optional branch push。已 shipped。
9. Safe restart approval flow。已作为 guarded `doctor:ship` shipped。
10. `/incident id:<id>` detail view with repair/ship history。
11. Incident lifecycle operations：resolve、ignore、retry repair 和 ship preview。
12. `TaskReporter` and normalized task trace events。
13. Repair reliability metrics and promotion policy。
14. Discord operator actions for the guarded repair/ship flow。

下一次代码改动应该从 Phase 5A 开始，因为它低风险，并且能让已经 shipped 的 Auto Doctor 数据变成真正可运维的入口。不要在 Phase 5B 和 Phase 5C 提供足够 trace quality 与 repair reliability evidence 之前，推进更自动的 `main` update 或 live restart。
