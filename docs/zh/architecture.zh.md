---
doc_id: architecture
lang: zh
translation_of: docs/architecture.md
translation_status: current
source_sha256: 6e5bfa2c3a1bd42a5d4b7f9465bdbf0695e170c10f39f7625e0c7b654b8bdf10
---
# MiniClaw 架构

> MiniClaw 是 local-first、Discord-native 的 agent runtime。Discord 是主要完整用户交互面，同时可选启用 Weixin direct 作为独立的个人微信文字、语音和图片 chat/task 入口；Node 22 是进程 runtime；`~/.miniclaw/` 是用户数据边界；SQLite 记录 durable task、routing、incident、provider 和 Agent Run Manager 状态。

## 系统视图

```mermaid
flowchart LR
  User([User])

  subgraph Discord["Discord"]
    Msg["Messages<br/>mentions, auto-reply channels, task channels"]
    Slash["Slash commands<br/>/task /status /sessions /health /doctor /task-log /cron-runs"]
    Btn["Buttons<br/>smart-router confirmation, cron retry, CLI session details/continue/hide, doctor actions"]
  end

  subgraph MiniClaw["MiniClaw Node process"]
    Bot["bot.ts + bot/*<br/>event routing"]
    Chat["agent/chat.ts<br/>read-only chat"]
    Task["agent/task.ts<br/>task lifecycle"]
    Runtime["runtime registry<br/>Claude / Codex / fake"]
    RunMgr["Agent Run Manager<br/>optional managed multi-agent path"]
    Hookd["hookd<br/>CLI session observation"]
    Cron["cron/scheduler.ts<br/>cron runner and retry"]
    Providers["providers + capabilities<br/>stock, content, email"]
    Ops["ops/doctor* + safe-restart<br/>diagnosis, incidents, guarded repair"]
    IM["im/*<br/>Discord transport, Feishu outbound, Weixin direct gateway"]
  end

  subgraph UserHome["~/.miniclaw/"]
    Config["config.yaml + .env secrets"]
    Jobs["cron/*.yaml + cron/state.json"]
    Memory["memories/MEMORY.md"]
    Scripts["scripts/*"]
    Hooks["runtime/hookd.sock<br/>provider hook client"]
    ProviderState["providers/* + secrets/*"]
    Logs["logs/miniclaw-*.log"]
    DB[("data.db<br/>SQLite WAL")]
  end

  subgraph External["External services"]
    Claude["Claude-compatible API<br/>often through raven"]
    Codex["Codex SDK / CLI config"]
    SMTP["SMTP fallback"]
    MCP["MCP servers"]
    Weixin["Weixin iLink API<br/>optional direct channel"]
    ExternalCLI["Claude Code / Codex CLI<br/>ordinary terminal sessions"]
  end

  User --> Msg
  User --> Slash
  User --> Btn
  Msg --> Bot
  Slash --> Bot
  Btn --> Bot
  Bot --> Chat
  Bot --> Task
  Bot --> Cron
  Bot --> Ops
  Chat --> Runtime
  Task --> Runtime
  Hookd --> DB
  Hookd --> Bot
  Task --> RunMgr
  Cron --> Task
  Cron --> Providers
  Providers --> Task
  Ops --> DB
  Task --> DB
  Chat --> DB
  RunMgr --> DB
  Bot --> IM
  IM --> Chat
  IM --> Task
  IM --> Discord
  IM <--> Weixin
  User --> Weixin
  Config --> Bot
  Jobs --> Cron
  Memory --> Chat
  Memory --> Task
  Scripts --> Cron
  Hooks --> Hookd
  ProviderState --> Providers
  Logs --> Ops
  Runtime --> Claude
  Runtime --> Codex
  ExternalCLI --> Hooks
  Task -.-> MCP
  Ops --> SMTP
```

## Runtime 边界

MiniClaw 把 code、user state 和 public docs 做硬边界隔离：

- repo code 和 repo-owned prompts 放在 `src/`、`prompts/`、`agents/`、`personas/`。
- 用户配置、cron jobs、memory、scripts、provider sessions、logs 和 SQLite state 放在 `~/.miniclaw/`。
- secrets 只能放在 `.env` 或 `~/.miniclaw/secrets/**`，不能进入 public docs 或 examples。
- `docs/` 是 implementation source of truth；`website/` 是 presentation layer。

runtime registry 把 agent execution 和 routing 分离。`src/runtime/agent-runtime.ts` 定义统一 runtime interface，`src/agent/runtimes/registry.ts` 把配置映射到 Claude、Codex 或 fake task runner。`runtime.default_agent` 是推荐配置键；legacy `agent.provider` 仍作为兼容 fallback。

`hookd` 是普通 Claude Code 和 Codex CLI sessions 的独立观测面，这些 session 可以是在 MiniClaw 外部启动的。启用 `hookd.enabled=true` 后，MiniClaw 会监听本地 Unix socket，接收 provider hook events，保存 normalized CLI session state，扫描 dead PID，并在配置的 CLI sessions channel 里维护一条 pinned Discord dashboard message。`/sessions` 保留为手动 ephemeral 查询路径，用于 filtered views 和 history。这不会把每个外部 CLI 都变成 MiniClaw task row。same-provider continuation 只会在 Discord 中显式触发，并且 Claude session 仍通过 Claude resume，Codex session 仍通过 Codex resume。

## 消息与任务流程

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant D as Discord
  participant B as bot.ts
  participant R as routing/*
  participant C as agent/chat.ts
  participant T as agent/task.ts
  participant RR as runtime registry
  participant DB as SQLite

  U->>D: Message, slash command, or button
  D->>B: Discord event
  B->>R: Resolve outer route
  alt thread continuation
    R->>T: resume task with previous session
    T->>RR: start runtime with resumeSessionId
  else task channel or /task
    R->>T: create task and run
    T->>RR: start task runtime
  else chat eligible
    R->>C: run chat path
    C->>RR: start read-only chat runtime
  else ignored
    R-->>B: ignore
  end
  T->>DB: tasks + task_events
  C->>DB: chat_history
  B-->>D: status, progress, final output
```

## Smart Router 路由器

Smart Router 是 chat-eligible path 内的第二层决策。第一层仍然负责 Discord hard routing：ignore、thread continuation、task channel 或 chat candidate。第二层决定 chat candidate 应继续 chat、显示 task confirmation，还是在配置过的 channel 中自动转 task。

```mermaid
flowchart TD
  A[Chat-eligible Discord message] --> B{Blank without attachments?}
  B -->|yes| G[Greeting reply]
  B -->|no| M{Explicit memory command?}
  M -->|yes| MEM[Write memory and reply]
  M -->|no| S{Smart Router enabled?}
  S -->|no| C[Chat]
  S -->|yes| F[Extract objective facts<br/>attachments, URL, URL-only, empty]
  F --> L{LLM classifier available?}
  L -->|yes| CAP[Capability JSON]
  L -->|no| FB[Objective-fact fallback]
  CAP --> P[Policy mapping]
  FB --> P
  P -->|write/shell/git/runtime/persistence| HARD[task_confirm or task_auto]
  P -->|browser/current-info/research/URL-only| SOFT[task_suggest]
  P -->|light answer| C
  HARD --> ACT[Channel policy]
  SOFT --> ACT
  ACT -->|auto task channel| TASK[Create task thread]
  ACT -->|confirmation allowed| BTN[Show task/chat/cancel buttons]
  ACT -->|confirmation not allowed| C
```

## Agent Run Manager 管理器

Agent Run Manager 是 `executeTask()` 和 `AgentRuntime` 之间的可选 controlled insertion layer。`agent_run_manager.enabled=false` 且 `agent_run_manager.auto_enabled=false` 时，系统保持 single-agent runtime path。启用后，MiniClaw 会创建 root supervisor run 和 managed child runs，并提供 typed messages、artifacts、blackboard facts、policy checks、sweeper recovery 和可选 ACP-style access。

```mermaid
flowchart TD
  Task[executeTask] --> Gate{Agent Run Manager?}
  Gate -->|disabled| Single[Direct AgentRuntime]
  Gate -->|enabled or auto-selected| Manager[AgentRunManager]
  Manager --> Scheduler[Scheduler<br/>FSM or opt-in DAG]
  Manager --> Bus[Agent Bus]
  Manager --> Policy[Role policy + guardrails]
  Manager --> Sweeper[Sweeper + restart recovery]
  Scheduler --> Planner[planner child run]
  Scheduler --> Generator[generator child run]
  Scheduler --> Evaluator[evaluator child run]
  Planner --> Bus
  Generator --> Bus
  Evaluator --> Bus
  Bus --> Store[(agent_runs<br/>agent_messages<br/>agent_artifacts<br/>blackboard_facts<br/>agent_scheduler_state)]
  Bus --> Synth[Final synthesizer]
```

当前实现状态：

- managed fake runtime E2E 覆盖 planner、generator、evaluator、typed messages、artifacts、blackboard facts 和 final synthesis。
- Claude/Codex child runtime injection 支持 `miniclaw-agent-bus` MCP config 和 turn-end `miniclaw_agent_envelope` fallback。
- role policy 默认让 planner/evaluator read-only，并只在显式 policy 下允许 generator workspace writes。
- sweeper 处理 stale active runs、waiting scheduler timeout、orphan children、terminal cleanup 和 restart recovery。
- ACP server 是 localhost、task-scoped、bearer-token protected，默认关闭。

## Provider 与 Cron

```mermaid
flowchart LR
  Job["cron/*.yaml"] --> Scheduler["cron/scheduler.ts"]
  Config["config.yaml<br/>cron.active_window"] --> Scheduler
  Scheduler --> Runner["runner-task / runner-script / runner-message"]
  Runner --> ContextProvider["pre_context_providers"]
  Runner --> PreProvider["pre_provider"]
  ContextProvider --> Framework["providers/framework.ts"]
  PreProvider --> Framework["providers/framework.ts"]
  Framework --> Stock["stock providers"]
  Framework --> Content["content providers"]
  Framework --> Email["email capability"]
  PreProvider --> Task["agent/task.ts"]
  Runner --> State["cron/state.json"]
  Runner --> Runs[("cron_runs")]
  Runner --> DeliveryGroups[("cron_delivery_messages")]
  Runner --> Retry["failure notifier + retry button"]
```

`config.yaml` 中的 `cron.active_window` 是 scheduler-level guard。启用后，scheduled cron dispatch 和 missed-run catch-up 会在配置的本地时间窗口外记录为 skipped，不进入 runner 或 provider。手动 `pnpm cron:test` 仍保留为显式 operator troubleshooting 路径。

`pre_context_providers` 是 optional、non-blocking 的 background providers，会在 `pre_script` 和 primary `pre_provider` 前运行；它们用于注入 rolling market memory 这类 durable context，但不替代 task 的 source-of-truth provider。provider collection 默认 read-only，除非 provider 明确记录 commit phase。`commit()` 延迟到 downstream task success 后执行。provider docs 放在 `docs/providers/`；private account/session details 放在 `docs/private/` 或 `~/.miniclaw/`，不得进入 public docs。

Stock provider names 仍然是 `src/providers/index.ts` 中的 cron-facing compatibility contracts，但 stock implementation ownership 已经归入 `src/stock/*`。`src/providers/*` 下的 stock provider folders 顶层只保留 `index.ts` wrapper 和 provider-named `config.ts` loader；可复用 stock types、report formatting、chart rendering、calibration、source adapters、data domains 和 signal logic 都直接从 `src/stock/data`、`src/stock/signals`、`src/stock/sources`、`src/stock/reports` 引入。cron 和 store code 在持久化 market forecast 或 market context payload 时，应依赖 stock data-domain types，而不是 provider facade types。

## 存储模型

MiniClaw 使用 `~/.miniclaw/data.db`，SQLite WAL mode。schema migration 通过 `PRAGMA user_version` 管理；当前 schema 由 `src/store/schema.ts` 定义为 `SCHEMA_VERSION = 19`。

```mermaid
erDiagram
  tasks ||--o{ task_events : records
  tasks ||--o{ agent_runs : owns
  agent_runs ||--o{ agent_messages : exchanges
  agent_runs ||--o{ agent_artifacts : publishes
  tasks ||--o{ blackboard_facts : scopes
  tasks ||--o{ agent_scheduler_state : schedules
  tasks ||--o{ recovery_outbox : delivers
  tasks ||--o{ market_context_daily : writes
  tasks ||--o{ task_control_events : controls
  cron_runs ||--o{ recovery_outbox : alerts
  tasks ||--o{ cron_delivery_messages : updates
  cli_sessions ||--o{ cli_session_events : records
  cli_sessions ||--o{ cli_session_approvals : blocks
  incidents ||--o{ repair_runs : repairs
  chat_history ||--o{ smart_router_decisions : informs
  market_context_daily ||--o{ market_context_items : updates

  smart_router_decisions {
    TEXT id
    TEXT message_id
    TEXT channel_id
    TEXT user_id
    TEXT reason
    TEXT matched_signals
    TEXT risk_flags
    TEXT capabilities_json
    INTEGER classifier_elapsed_ms
    TEXT classifier_error_type
    TEXT classifier_error_message
    TEXT user_choice
    TEXT final_route
    TEXT task_final_status
    TEXT correction_type
    TEXT correction_note
    TEXT resolved_at
  }

  market_context_daily {
    TEXT id
    TEXT market_scope
    TEXT trade_date
    TEXT generated_at
    TEXT digest_text
    TEXT active_items_json
    TEXT new_items_json
    TEXT resolved_items_json
    TEXT previous_context_id
  }

  market_context_items {
    TEXT id
    TEXT market_scope
    TEXT stable_key
    TEXT topic
    TEXT fact
    TEXT market_impact
    TEXT horizon
    TEXT status
    TEXT last_updated_at
  }

  cron_delivery_messages {
    TEXT id
    TEXT job_name
    TEXT channel_id
    TEXT delivery_key
    TEXT delivery_mode
    TEXT task_id
    TEXT message_ids_json
  }

  cli_sessions {
    TEXT id
    TEXT provider
    TEXT provider_session_id
    TEXT cwd
    INTEGER pid
    TEXT tty
    TEXT phase
    TEXT attention_kind
    TEXT last_event_name
    TEXT last_activity_at
    TEXT ended_at
    TEXT hidden_at
  }

  cli_session_events {
    TEXT id
    TEXT cli_session_id
    TEXT provider
    TEXT event_name
    TEXT phase
    TEXT payload_json
    TEXT created_at
  }

  cli_session_approvals {
    TEXT id
    TEXT cli_session_id
    TEXT provider
    TEXT provider_session_id
    TEXT tool_name
    TEXT tool_use_id
    TEXT request_json
    TEXT status
    TEXT decision_json
    TEXT actor_id
    TEXT requested_at
    TEXT resolved_at
    TEXT expires_at
  }

  task_control_events {
    TEXT id
    TEXT task_id
    TEXT event_type
    TEXT status
    TEXT payload_json
    TEXT discord_message_id
    TEXT actor_id
    TEXT created_at
    TEXT consumed_at
  }
```

state retention 通过 `state.retention.*` 配置。cleanup 先 dry-run：`pnpm run state:cleanup -- --dry-run`；破坏性清理必须显式传入 `--execute`。

`market_context_daily` 按 market scope 和 trade date 存储一份 rolling digest。`market_context_items` 用 `(market_scope, stable_key)` 存储去重后的长期市场事实，让每日 update cron 可以解决过期事项，也让普通股票 cron 只注入 active context。

## 投递与恢复

`recovery_outbox` 把本地执行结果和 IM delivery 分离。`cron_failure_alert` 保存 Discord delivery 不可用时可重试的 cron failure alert；`task_result_delivery` 保存 task result fragments 以便后续 delivery recovery。Discord 仍是主要的完整能力 gateway；Feishu 是 outbound-only；Weixin direct 是 opt-in 文字/语音/图片交互入口，依赖本地 `~/.miniclaw/weixin` account state。登录后，Weixin long-poll gateway 可以不等待 Discord `clientReady` 就启动，把 chat 路由到普通 chat runtime，并通过 Weixin task view reporter 执行已确认 task，把进度和最终结果发回微信。

Cron task 结果默认每次运行发送一组新的 chunked Markdown result。配置 `result_delivery.mode: daily_message_group` 的 job 会按本地日期保留一组可编辑的 Discord messages，key 由 job、channel、delivery mode 和 timezone-derived date 组成，并存入 `cron_delivery_messages`。同一天后续成功运行会编辑已有 chunks，报告变长时补发新增 chunk，报告变短时 best-effort 删除多余旧 chunk。这样 browser-tabs snapshot 这类长报告仍保留完整 Discord Markdown 输出，但不会每小时在频道里刷出一批新消息。

## 可观测性与运维

- `task_events` 记录 lifecycle、protocol/tool events 和 Discord status transitions。
- `cli_sessions` 和 `cli_session_events` 独立记录 hookd 观测到的外部 Claude/Codex CLI session state，不与 MiniClaw-owned task rows 混在一起。
- `cli_session_approvals` 记录 redacted external Claude permission requests，以及从 Discord 返回 blocking hook 的 allow 或 deny decision。
- `cli_session_dashboard_updater` 只是 runtime-only 控制面：它从当前 `cli_sessions` / `cli_session_approvals` state 编辑一条配置的 Discord message，不会额外持久化 dashboard rows。
- `task_control_events` 记录 running MiniClaw-owned task threads 的 queued operator instructions；当前 single-shot runners 还不会消费这个 queue。
- `src/store/task-trace-export.ts` 与 `src/store/agent-run-trace-export.ts` 生成 redacted Markdown traces，供 `/task-log`、incident view 和本地 CLI review 使用。
- `/doctor` 和 scheduled scans 汇总 DB、cron state、config、PM2、logs 和 Git evidence。
- guarded repair/ship flow 必须经过 operator approval，并先通过 repair branch，不能直接碰 `main`。
- `safe-restart` 会在 active task/chat work 存在时阻止 unsafe restart。

## 设计不变量

- Discord routing 决定入口；agent runtimes 不决定 Discord event 是否允许处理。
- chat 是 read-oriented。file writes、shell execution、Git changes、durable output 和 multi-step coding 属于 task runtime。
- cron 和 providers source-isolated。provider 可以采集结构化输入，但 task execution 仍属于 agent runtime boundary。
- user state 属于 `~/.miniclaw/`；repo docs 和 examples 必须使用 placeholders。
- website pages 必须引用 `docs/` source，不能成为 implementation authority。
