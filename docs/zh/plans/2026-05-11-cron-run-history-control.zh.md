---
doc_id: cron-run-history-control-plan
lang: zh
translation_of: docs/plans/2026-05-11-cron-run-history-control.md
translation_status: current
source_sha256: c91fe6c7e5870832a2f5f277c7d285395cc86b483f9c5afaa39d46ea0f669e13
---
# Cron 运行历史与 Per-Job 控制

现况:已完成
日期: 2026-05-11

## 背景

MiniClaw cron已经支持任务/script/技能/message job,`pre_script`, `pre_provider`,重试按钮、故障提示和Provider 侧`skipTask`。下一个问题是长期操作:诊断成功率、失败类别、Runtime、Providerpreflight状态、Job 级 SLA、backoff、冷却和并发。

当前状态分布在调度器状态,日志,任务行和事件之间. 头等舱`cron_runs`历史会让用户检查最近的运行,并将cron失败链接到任务跟踪和事件细节.

## 目标

- 加上耐久的运行历史。
- 增加每个工作超时、最大并发、重试/backoff/cooldown以及circuit breaker字段。
- 在所支持的 LLM 任务执行之前,增加提供商健康/dry-run前飞行。
- 连接cron故障通知以运行细节,任务追踪和事件细节.
- 为最近的 cron 运行添加本地查询和 Discord 查询表面。

## 非目标

- 不删除已有的`~/.miniclaw/cron/state.json`在第一个片段。
- 在提供保健服务前飞行时不要拨打真正的LLMS。
- 不立即规定Provider必须进行preflight准备。
- 不要让 Discord 用户创建任意的 cron 工作 。
- 不要运行真正的cron E2E 针对生产配置。

## 现有架构证据

- `src/cron/types.ts`: 工作定义、任务/说明/技能/信息模式,`pre_provider`, `pre_provider_config`.
- `src/cron/loader.ts`: 加载用户 cron YAML 并验证Provider.
- `src/cron/runner-task.ts`: 运行预Provider和下游`executeTask`.
- `src/cron/scheduler.ts`: 排程, 重试, 运行任务, 失败提醒 。
- `src/cron/state.ts`:JSON状态坚持.
- `src/cron/failure-notifier.ts`:Discord失败/恢复警报行为.
- `src/cron/retry-interactions.ts`:重试按钮行为.
- `scripts/cron-list.ts`和`scripts/cron-test.ts`: 局部凸轮表面.
- `pnpm run e2e:cron`:定型圆柱形固定门.

## 数据模型建议

添加一个`cron_runs`表显示:

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

状态值 :

- `running`
- `success`
- `skipped`
- `failed`
- `retry_scheduled`
- `cancelled`
- `circuit_open`

## 配置建议

职业YAML候选人:

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

保持默认符合当前行为.

## 执行计划

1. 添加 cron 运行仓库。
- 候选人文件 :`src/store/cron-runs.ts`.
- helper:
     - `createCronRun`
     - `markCronRunCompleted`
     - `markCronRunFailed`
     - `listCronRuns`
     - `summarizeCronRuns`
- 加入计划测试。
2. 仪器调度器。
- 为每一次预定/人工/测试运行创建运行编号。
- 记录开始、尝试、工作类型和预定时间。
- 完成/失败/滑行的记录状况和期限。
- 当任务执行者创建任务时链接任务 ID。
3. 保持JSON状态兼容性.
- 继续写`state.json`用于当前调度器行为。
- 别做`cron_runs`唯一的真相来源 直到稳定。
4. 添加Providerpreflight钩。
- 如果Provider框架已着陆,请拨`healthCheck` or `dryRun`在 LLM 任务之前。
- 如果不降落,设计车钩但让它失效。
- 记录Provider状况/类别`cron_runs`.
- 对于认证/会话失败, 请跳过 LLM 任务并标记运行`skipped` or `failed`可采取行动的类别。
5. 增加每个Job 超时和并发。
- 执行`max_concurrency`由职称先.
- 在前方/前方/前方/任务路径上添加全员超时包装。
- 确保超时标记运行并创建/更新事件。
6. 增加冷却和circuit breaker。
- 计算从`cron_runs`不只是最后一个状态
- 电路开通运行应当可见,不能默默忽略.
7. 延长失效通知。
- 包括身份证明
- 包含命令提示:
     - `/cron-run id:<run-id>`如果添加;
     - `/task-log id:<task-id>`如果任务存在;
     - `/incident view id:<incident-id>`如果事件存在。
8. 添加本地查询脚本。
- 候选人:`scripts/cron-runs.ts`.
- package script:`"cron:runs": "tsx scripts/cron-runs.ts"`.
- 易于输出的终端组汇总。
9. 可选的Discord命令。
   - `/cron-runs job:<optional> limit:<n>`
   - `/cron-run id:<run-id>`
- 保持斜面小;CLI可以先着陆。
10. 增加试验和固定装置。
- 排程成功/失败/滑行。
- 重试/backoff/cooldown行为。
- circuit breaker行为
- Providerpreflight类别。

## 验证计划

- 重点:
  - `pnpm vitest run src/cron/__tests__/scheduler.test.ts src/cron/__tests__/failure-notifier.test.ts src/cron/__tests__/state.test.ts`
- 添加内容`src/store/__tests__/cron-runs.test.ts`.
- 加入cron控制测试 作为新的行为。
- E2E固定装置:
  - `pnpm run e2e:cron`
- 静态:
  - `pnpm run typecheck`
  - `pnpm run lint`
- 满:
  - `pnpm test`
  - `pnpm run build`

## 风险与回滚

- 风险:调度员创建重复或孤行运行。
- 缓解:每次尝试一次运行id;idempotenthelper。
- 风险:超时错误地取消任务。
- 缓解:区分提供前超时和下游任务超时;依靠现有的取消/中断路径。
- 风险: Provider在preflight会改变生产行为
- 缓解:配置门preflight;如有需要,首先采用只记录模式。
- 风险:circuit breaker隐藏重大故障。
- 缓解:录制并通知电路开通运行情况,下次重试/开通时间。

## 文档同步

- 最新情况`docs/architecture.md`中央部分和ER图。
- 更新相关的目录/Provider功能文件。
- 最新情况`docs/bot-routing.md`如果添加斜线命令或按钮。
- 运行`pnpm run quality:docs`.

## 执行记录

记录 schema 版本, 配置默认值, 查询命令, 执行时在此进行校验输出 。

### 2026-05-12 Ralph 迭代:持久运行历史基础.

- 执行计划v11`cron_runs`加号`idx_cron_runs_job_started`和`idx_cron_runs_status_started`.
- 已经添加了`src/store/cron-runs.ts`helper :`createCronRun`, `markCronRunCompleted`, `markCronRunFailed`, `getCronRun`, `listCronRuns`,以及`summarizeCronRuns`.
- 仪器调度器发送以创建一个`cron_runs`每一次尝试,包括draining/shutdown期间的省略发送,`retry_scheduled`重试 backoff前行, 最终`failed`和成功/skipped的结果。
- 运行器结果现在包含任务/Provider元数据,因此任务和技能运行可以链接`task_id`预提供方`skipTask`结果作为`skipped`.
- 让杰森`state.json`作为当前兼容源写入`cron:list`并重试按钮行为。
- 更新`docs/architecture.md`SQLite schema 注释和 ER 图表用于 schema v11 /`cron_runs`.
- 验证:
  - `pnpm exec vitest run src/store/__tests__/cron-runs.test.ts src/store/__tests__/migrations.test.ts src/store/__tests__/db.test.ts src/cron/__tests__/scheduler.test.ts src/cron/__tests__/runner-task.test.ts src/cron/__tests__/runner-script.test.ts src/cron/__tests__/runner-message.test.ts`通过了:7个文件,60个测试。
  - `pnpm run typecheck`通过。
  - `pnpm run e2e:cron`通过 :`Cron E2E fixture passed: cron-e2e-1778599767213`.
  - `pnpm run quality:docs`与计划v11。
  - `pnpm run lint`通过。

### 2026-05-12 Ralph 迭代:Provider 预检运行元数据

- 完成Providerpreflight历史空白:健康和模拟preflight故障现在将Provider名称、Provider 状态、Provider类别和可操作错误类别传播到调度器中。
- legacy`pre_provider`收藏失败, 现在在提升前使用Provider错误分类器`CronTaskRunError`, so `cron_runs.provider_*`和`cron_runs.error_category`不再留作Provider故障的通用任务运行错误。
- 排期失败的定稿工作目前仍在继续`errorCategory`在返回到通用 JavaScript 错误名称之前,由 runder 错误 所携带。
- 增加了健康preflight元数据、dry-runpreflight元数据以及耐久性测试`cron_runs`不支持的Providerpreflight的行 。
- 更新`docs/archive/features/16-provider-framework.md`与持续的preflight/Provider故障元数据合同。
- 验证:
  - `pnpm exec vitest run src/cron/__tests__/runner-task.test.ts src/cron/__tests__/scheduler.test.ts`通过了:2个文件,22个测试。
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run e2e:cron`通过 :`Cron E2E fixture passed: cron-e2e-1778600152507`.
  - `pnpm run quality:docs`与计划v11。

### 2026-05-12 Ralph 迭代：每个 Job 超时与并发

- 添加 cron YAML 支持`timeout_ms`和`max_concurrency`; `max_concurrency`默认为 1 以保留先前的同一 Job单跑后卫,同时`timeout_ms`选择进入。
- 已替换的同名调度器`Set`跟踪每个Job 运行的计数,这样配置的工作就可以运行到自己的并发上限,并且跳过超过并发上限的发送被坚持到`cron_runs.status=skipped`与`error_category=max_concurrency`.
- 添加排程器级全程超时包装。 超时中止信号被传播到任务,技能,脚本,前缀,以及消息执行器中;任务执行现在接受外部中止信号,并在任务输出中保留中止原因.
- 持续出现超时故障`cron_runs`与`error_category=cron_timeout`,在可用时链接任务编号,以及 a`cron_failed`重试链键定的事件行加事件`failure_run_id`.
- 更新`docs/architecture.md`运行到文档`max_concurrency`, `timeout_ms`超时历史 超时事件
- 验证:
  - `pnpm exec vitest run src/cron/__tests__/loader.test.ts src/cron/__tests__/scheduler.test.ts src/cron/__tests__/runner-script.test.ts src/cron/__tests__/runner-task.test.ts`通过:4个文件,53个测试。
  - `pnpm exec vitest run src/agent/__tests__/task-helpers.test.ts src/agent/__tests__/e2e-fake-runtime.test.ts src/agent/__tests__/task-runtime-registry.test.ts`通过了:3个文件,23个测试。
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run e2e:cron`通过 :`Cron E2E fixture passed: cron-e2e-1778601087271`.
  - `pnpm run quality:docs`与计划v11。

### 2026-05-12 Ralph 迭代:冷却和熔断 Gate

- 添加 cron YAML 支持`cooldown.after_failure_ms`和`circuit_breaker`带有阈值/窗口/开放时间的设定默认值。
- 已经添加了`getCronRunFailureWindow()`所以冷却和circuit breaker的决定 是从耐久性计算出来的`cron_runs`,忽略了电路开/滑行,并在后来成功运行后重置.
- 调度器在获得同一 Job的并发槽位后, 在开始重试之前, 现在应用cooldown/circuit breaker; cooldown写入`cron_runs.status=skipped` / `error_category=cooldown`,当circuit breaker写入时`cron_runs.status=circuit_open` / `error_category=circuit_open`加上open-until 元数据。
- 贾森`state.json`兼容性保持不变: 已封存的调度仍然调用`recordRun()`并揭露`next_retry_at`用于本地状态表面。
- 更新`docs/architecture.md`用于记录新历史支撑的大门。
- 验证:
  - `pnpm exec vitest run src/cron/__tests__/loader.test.ts src/cron/__tests__/scheduler.test.ts src/store/__tests__/cron-runs.test.ts`通过:3个文件,44个测试。
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run e2e:cron`通过 :`Cron E2E fixture passed: cron-e2e-1778601660368`.
  - `pnpm run quality:docs`与计划v11。

### 2026-05-13 Ralph 迭代:故障警报链接和当地运行查询

- 扩展 cron 失败通知, 所以重试按钮仍然使用重试链`failure_run_id`,而信息正文现在包括持久`cron_runs.id`加运算符提示`pnpm run cron:runs -- --id <prefix>`, `/task-log id:<task-prefix>`,以及`/incident view id:<incident-prefix>`当这些链接的记录存在时。
- 重新排序调度器故障处理,以便在发送Discord故障提醒之前创建超时事件,允许超时提醒包含事件细节提示,并且仍然持续提醒频道/消息ID返回`cron_runs`排队
- 添加 cron 运行 id/ prefix 查询助手(`listCronRunsByIdPrefix`, `resolveCronRunByIdPrefix`)用于局部和未来的Discord细节表面.
- 已经添加了`scripts/cron-runs.ts`和package script`cron:runs`对于最近运行的列表,每个工作摘要,JSON输出,以及由id/prefix提供的单运行细节;脚本只初始化存储数据库路径,不需要 Discord运行时的秘密来帮助或只读查询使用.
- 更新`docs/architecture.md`和`docs/bot-routing.md`来记录重试链 ids 和 持久运行 ids 之间的区别,加上新的本地查询命令。
- 验证:
  - `pnpm exec vitest run src/cron/__tests__/failure-notifier.test.ts src/cron/__tests__/scheduler.test.ts src/store/__tests__/cron-runs.test.ts`通过:3个文件,25个测试。
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`与计划v11。
  - `pnpm run e2e:cron`通过 :`Cron E2E fixture passed: cron-e2e-1778602168982`.
  - `pnpm run cron:runs -- --help`无需通过`DISCORD_TOKEN`.
  - `MINICLAW_DB_PATH=/private/tmp/miniclaw-cron-runs-smoke.db pnpm run cron:runs -- --limit 1`从临时数据库中通过并打印出一个空运行列表; 临时 SQLite 文件随后被清理。

### 2026-05-13 Ralph 迭代：Discord cron 运行查询命令

- 添加的Discord斜线命令`/cron-runs job:<optional> limit:<n>`和`/cron-run id:<run-prefix>`.
- 已经添加了`src/commands/cron-runs.ts`因此 Discord 查询输出重用持久值`cron_runs`formatter 和 id- prefix 解析器已被本地端使用`cron:runs`CLI(英语:CLI).
- 连接新命令通过`commands/register.ts`, `commands/handlers.ts`,以及`bot/slash-dispatch.ts`;两个命令都是允许用户入门,易读,只读.
- 更新`docs/architecture.md`和`docs/bot-routing.md`来记录 Discord 运行历史查询表层和与 retry-chain 按钮 ids 的区别。
- 这完成了剩下的Discord查询表层 从执行计划, 所以计划状态现在`done`.
- 验证:
  - `pnpm vitest run src/commands/__tests__/cron-runs.test.ts src/bot/__tests__/slash-dispatch.test.ts src/store/__tests__/cron-runs.test.ts`通过:3个文件,15个测试。
  - `pnpm vitest run src/cron/__tests__/scheduler.test.ts src/cron/__tests__/failure-notifier.test.ts src/cron/__tests__/state.test.ts`通过了:3个文件,28个测试。
  - `pnpm run e2e:cron`通过 :`Cron E2E fixture passed: cron-e2e-1778602591151`.
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`与计划v11。
  - `pnpm ralph:verify -- --task cron-run-history-control --profile cron`通过,包括Cron测试,E2E固定`cron-e2e-1778602706778`输入、输入和数据漂移检查
