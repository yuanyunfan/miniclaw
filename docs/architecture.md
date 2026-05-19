# MiniClaw Architecture

> MiniClaw is a local-first Discord-native agent runtime. Discord is the primary user surface, with optional Weixin direct as a lightweight personal entry point; Node 22 is the process runtime; `~/.miniclaw/` is the user data boundary; SQLite records durable task, routing, incident, provider, and Agent Run Manager state.

## System View

```mermaid
flowchart LR
  User([User])

  subgraph Discord["Discord"]
    Msg["Messages<br/>mentions, auto-reply channels, task channels"]
    Slash["Slash commands<br/>/task /status /health /doctor /task-log /cron-runs"]
    Btn["Buttons<br/>smart-router confirmation, cron retry, doctor actions"]
  end

  subgraph MiniClaw["MiniClaw Node process"]
    Bot["bot.ts + bot/*<br/>event routing"]
    Chat["agent/chat.ts<br/>read-only chat"]
    Task["agent/task.ts<br/>task lifecycle"]
    Runtime["runtime registry<br/>Claude / Codex / fake"]
    RunMgr["Agent Run Manager<br/>optional managed multi-agent path"]
    Cron["cron/scheduler.ts<br/>cron runner and retry"]
    Providers["providers + capabilities<br/>stock, content, email"]
    Ops["ops/doctor* + safe-restart<br/>diagnosis, incidents, guarded repair"]
    IM["im/*<br/>Discord transport, Feishu outbound, Weixin direct"]
  end

  subgraph UserHome["~/.miniclaw/"]
    Config["config.yaml + .env secrets"]
    Jobs["cron/*.yaml + cron/state.json"]
    Memory["memories/MEMORY.md"]
    Scripts["scripts/*"]
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
  ProviderState --> Providers
  Logs --> Ops
  Runtime --> Claude
  Runtime --> Codex
  Task -.-> MCP
  Ops --> SMTP
```

## Runtime Boundaries

MiniClaw keeps hard boundaries between code, user state, and public docs:

- Repo code and repo-owned prompts live in `src/`, `prompts/`, `agents/`, and `personas/`.
- User configuration, cron jobs, memory, scripts, provider sessions, logs, and SQLite state live under `~/.miniclaw/`.
- Secrets belong in `.env` or `~/.miniclaw/secrets/**`, never in public docs or examples.
- `docs/` is the implementation source of truth; `website/` is a presentation layer.

The runtime registry separates agent execution from routing. `src/runtime/agent-runtime.ts` defines the common runtime interface. `src/agent/runtimes/registry.ts` maps the configured runtime to Claude, Codex, or fake task runners. `runtime.default_agent` is the preferred config key; legacy `agent.provider` remains a compatibility fallback.

## Message And Task Flow

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

## Smart Router

The Smart Router is a second-stage decision inside the chat-eligible path. The first stage still decides hard Discord routing: ignore, thread continuation, task channel, or chat candidate. The second stage decides whether the chat candidate should remain chat, show task confirmation, or become an automatic task in configured channels.

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

## Agent Run Manager

Agent Run Manager is an optional controlled insertion layer between `executeTask()` and `AgentRuntime`. When `agent_run_manager.enabled=false` and `agent_run_manager.auto_enabled=false`, the system keeps the single-agent runtime path. When enabled, MiniClaw creates a root supervisor run and managed child runs with typed messages, artifacts, blackboard facts, policy checks, sweeper recovery, and optional ACP-style access.

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

Implemented state:

- Managed fake runtime E2E covers planner, generator, evaluator, typed messages, artifacts, blackboard facts, and final synthesis.
- Claude and Codex child runtime injection supports `miniclaw-agent-bus` MCP configuration plus a turn-end `miniclaw_agent_envelope` fallback.
- Role policy keeps planner/evaluator read-only by default and allows generator workspace writes under explicit policy.
- Sweeper handles stale active runs, waiting scheduler timeouts, orphan children, terminal cleanup, and restart recovery.
- ACP server is localhost, task-scoped, bearer-token protected, and disabled by default.

## Providers And Cron

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
  Runner --> Retry["failure notifier + retry button"]
```

`cron.active_window` in `config.yaml` is a scheduler-level guard. When enabled, scheduled cron dispatches and missed-run catch-ups are recorded as skipped outside the configured local-time window before runners or providers execute. Manual `pnpm cron:test` remains an explicit operator path for troubleshooting.

`pre_context_providers` are optional, non-blocking background providers that run before `pre_script` and the primary `pre_provider`; they prepend durable context such as rolling market memory without replacing the task's source-of-truth provider. Provider collection is read-only unless a provider explicitly documents a commit phase. `commit()` is delayed until downstream task success. Provider docs live under `docs/providers/`; private account/session details live under `docs/private/` or `~/.miniclaw/` and must not enter public docs.

Stock provider names remain cron-facing compatibility contracts in `src/providers/index.ts`, but stock implementation ownership now lives under `src/stock/*`. Top-level stock provider folders under `src/providers/*` keep only `index.ts` wrappers and provider-named `config.ts` loaders; reusable stock types, report formatting, chart rendering, calibration, source adapters, data domains, and signal logic are imported directly from `src/stock/data`, `src/stock/signals`, `src/stock/sources`, and `src/stock/reports`. Cron and store code that persists market forecast or market context payloads should depend on stock data-domain types rather than provider facade types.

## Storage Model

MiniClaw uses `~/.miniclaw/data.db` in SQLite WAL mode. Schema migrations are managed through `PRAGMA user_version`; the current schema is defined by `src/store/schema.ts` as `SCHEMA_VERSION = 15`.

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
  cron_runs ||--o{ recovery_outbox : alerts
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
```

State retention is configured through `state.retention.*`. Cleanup is dry-run first through `pnpm run state:cleanup -- --dry-run`; destructive cleanup requires `--execute`.

`market_context_daily` stores one rolling digest per market scope and trade date. `market_context_items` stores deduplicated long-lived market facts keyed by `(market_scope, stable_key)` so daily update cron jobs can resolve stale items and ordinary stock cron jobs can inject only active context.

## Delivery And Recovery

`recovery_outbox` separates local execution results from IM delivery. `cron_failure_alert` stores retryable cron failure alerts when Discord delivery is unavailable. `task_result_delivery` stores task result fragments for later delivery recovery. Discord remains the primary full-fidelity gateway; Feishu is outbound-only; Weixin direct is opt-in text interaction backed by local `~/.miniclaw/weixin` account state and a Discord task bridge channel for confirmed `/task` execution.

## Observability And Operations

- `task_events` records lifecycle, protocol/tool events, and Discord status transitions.
- `src/store/task-trace-export.ts` and `src/store/agent-run-trace-export.ts` produce redacted Markdown traces for `/task-log`, incident views, and local CLI review.
- `/doctor` and scheduled scans aggregate DB, cron state, config, PM2, logs, and Git evidence.
- Guarded repair and ship flows require explicit operator approval and work through a repair branch before touching `main`.
- `safe-restart` blocks unsafe restarts when active task/chat work is in progress.

## Design Invariants

- Discord routing decides entry; agent runtimes do not decide whether a Discord event is allowed.
- Chat is read-oriented. File writes, shell execution, Git changes, durable output, and multi-step coding belong in task runtime.
- Cron and providers are source-isolated. A provider may collect structured input, but task execution remains under the agent runtime boundary.
- User state belongs in `~/.miniclaw/`; repo docs and examples must use placeholders.
- Website pages must cite `docs/` sources and cannot become implementation authority.
