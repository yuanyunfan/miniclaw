# Cron Run History 与 Per-Job Control

状态：`draft`
日期：2026-05-11

## 背景

MiniClaw cron 已经支持 task/script/skill/message jobs、`pre_script`、`pre_provider`、retry button、failure alerts，以及 provider-side `skipTask`。下一个问题是长期运行：诊断 success rate、failure categories、run duration、provider preflight state、job-level SLA、backoff、cooldown 和 concurrency。

当前状态分散在 scheduler state、logs、task rows 和 incidents 中。一等 `cron_runs` history 可以让用户查看近期 runs，并把 cron failures 关联到 task traces 和 incident details。

## 目标

- 增加持久化 cron run history。
- 增加 per-job timeout、max concurrency、retry/backoff/cooldown 和 circuit breaker fields。
- 在支持的 provider 上，在 LLM task execution 前增加 provider health/dry-run preflight。
- 将 cron failure notification 关联到 run detail、task trace 和 incident detail。
- 为近期 cron runs 增加本地和 Discord 查询表面。

## 非目标

- 第一阶段不移除现有 `~/.miniclaw/cron/state.json`。
- provider health preflight 不调用真实 LLM。
- 不立即让 provider preflight 成为 legacy providers 的必填项。
- 不允许 Discord users 创建任意 cron jobs。
- 不针对 production config 运行真实 cron E2E。

## 现有架构证据

- `src/cron/types.ts`：cron job definitions、task/script/skill/message modes、`pre_provider`、`pre_provider_config`。
- `src/cron/loader.ts`：加载用户 cron YAML 并验证 providers。
- `src/cron/runner-task.ts`：运行 pre-provider 和下游 `executeTask`。
- `src/cron/scheduler.ts`：scheduling、retry、running jobs、failure alerts。
- `src/cron/state.ts`：JSON state persistence。
- `src/cron/failure-notifier.ts`：Discord failure/recovered alert behavior。
- `src/cron/retry-interactions.ts`：retry button behavior。
- `scripts/cron-list.ts` 和 `scripts/cron-test.ts`：local cron surfaces。
- `pnpm run e2e:cron`：deterministic cron fixture gate。

## 数据模型提案

增加 `cron_runs` 表：

```sql
CREATE TABLE cron_runs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  scheduled_at TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  task_id TEXT,
  incident_id TEXT,
  provider_name TEXT,
  provider_status TEXT,
  provider_category TEXT,
  error_category TEXT,
  error_message TEXT,
  alert_message_id TEXT,
  alert_channel_id TEXT,
  metadata_json TEXT
);

CREATE INDEX idx_cron_runs_job_started ON cron_runs(job_name, started_at);
CREATE INDEX idx_cron_runs_status_started ON cron_runs(status, started_at);
```

Status values：

- `running`
- `success`
- `skipped`
- `failed`
- `retry_scheduled`
- `cancelled`
- `circuit_open`

## Config 提案

Per-job YAML candidates：

```yaml
timeout_ms: 1800000
max_concurrency: 1
retry:
  max_attempts: 5
  backoff_ms: [600000, 1200000, 2400000, 4800000]
cooldown:
  after_failure_ms: 1800000
circuit_breaker:
  enabled: true
  failure_threshold: 3
  window_ms: 86400000
  open_ms: 3600000
provider_preflight:
  enabled: true
  mode: health
```

保持 defaults 与当前行为兼容。

## 实施计划

1. 增加 cron run repository。
   - 候选文件：`src/store/cron-runs.ts`。
   - Helpers：
     - `createCronRun`
     - `markCronRunCompleted`
     - `markCronRunFailed`
     - `listCronRuns`
     - `summarizeCronRuns`
   - 增加 schema tests。
2. Instrument scheduler。
   - 为每个 scheduled/manual/test run 创建 run id。
   - 记录 start、attempt、job type 和 scheduled time。
   - completion/failure/skip 时记录 status 和 duration。
   - task runner 创建 task 时关联 task id。
3. 保持 JSON state 兼容。
   - 为当前 scheduler 行为继续写入 `state.json`。
   - 在稳定前，不让 `cron_runs` 成为唯一 source of truth。
4. 增加 provider preflight hook。
   - 如果 provider framework 已落地，在 LLM task 前调用 `healthCheck` 或 `dryRun`。
   - 如果尚未落地，先设计 hook 但保持 disabled。
   - 在 `cron_runs` 中记录 provider status/category。
   - 对 auth/session failure，跳过 LLM task，并用可行动 category 将 run 标为 `skipped` 或 `failed`。
5. 增加 per-job timeout 和 concurrency。
   - 先按 job name 执行 `max_concurrency`。
   - 围绕 pre-script/pre-provider/task path 增加 full-job timeout wrapper。
   - 确保 timeout 会标记 run 并创建/更新 incident。
6. 增加 cooldown 和 circuit breaker。
   - 从 `cron_runs` 计算，而不只看 last state。
   - circuit-open runs 应可见，不能静默忽略。
7. 扩展 failure notifier。
   - 包含 run id。
   - 包含 command hints：
     - 如果新增，`/cron-run id:<run-id>`；
     - 如果 task 存在，`/task-log id:<task-id>`；
     - 如果 incident 存在，`/incident view id:<incident-id>`。
8. 增加 local query script。
   - 候选：`scripts/cron-runs.ts`。
   - Package script：`"cron:runs": "tsx scripts/cron-runs.ts"`。
   - 输出 terminal-friendly grouped summaries。
9. 可选 Discord command。
   - `/cron-runs job:<optional> limit:<n>`
   - `/cron-run id:<run-id>`
   - 保持 slash surface 小；CLI 可以先落地。
10. 增加 tests 和 fixtures。
    - Scheduler success/failure/skip run rows。
    - Retry/backoff/cooldown behavior。
    - Circuit breaker behavior。
    - Provider preflight categories。

## 验证计划

- Focused：
  - `pnpm vitest run src/cron/__tests__/scheduler.test.ts src/cron/__tests__/failure-notifier.test.ts src/cron/__tests__/state.test.ts`
  - 增加 `src/store/__tests__/cron-runs.test.ts`。
  - 新行为落地时增加 cron control tests。
- E2E fixture：
  - `pnpm run e2e:cron`
- Static：
  - `pnpm run typecheck`
  - `pnpm run lint`
- Full：
  - `pnpm test`
  - `pnpm run build`

## 风险与回滚

- 风险：scheduler 创建重复或 orphaned run rows。
  - 缓解：每个 attempt 一个 run id；idempotent finalization helper。
- 风险：timeout 错误取消 task。
  - 缓解：区分 pre-provider timeout 和 downstream task timeout；依赖现有 cancel/interrupt path。
- 风险：provider preflight 过度改变 production cron behavior。
  - 缓解：preflight 用 config gate；必要时先做 record-only mode。
- 风险：circuit breaker 隐藏重要 failures。
  - 缓解：circuit-open runs 被记录，并通知 next retry/open-until time。

## 文档同步

- 更新 `docs/architecture.md` cron section 和 ER diagram。
- 更新相关 cron/provider feature docs。
- 如果增加 slash commands 或 buttons，更新 `docs/bot-routing.md`。
- 运行 `pnpm run quality:docs`。

## 执行记录

实现时在这里记录 schema version、config defaults、query commands 和 verification output。

