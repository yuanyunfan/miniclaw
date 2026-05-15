---
status: public-summary
source_docs:
  en:
    - docs/architecture.md
    - docs/plans/2026-05-15-documentation-strategy.md
  zh:
    - docs/zh/architecture.zh.md
    - docs/zh/plans/2026-05-15-documentation-strategy.zh.md
---

# Architecture

MiniClaw is shaped around one boundary: Discord is the control and delivery surface, while the local runtime owns routing, provider context, task execution, storage, recovery, and quality traceability.

```mermaid
flowchart LR
  subgraph Interface
    Discord[Discord Channels]
    Slash[Slash Commands]
  end
  subgraph Runtime
    Intake[Bot Intake]
    Router[Smart Router]
    Chat[Chat Runtime]
    Task[Task Runtime]
    Cron[Cron Scheduler]
  end
  subgraph Context
    Providers[Readonly Providers]
    Memory[Memory / Chat Context]
  end
  subgraph Execution
    Claude[Claude Code]
    Codex[Codex]
  end
  subgraph State
    SQLite[(SQLite)]
    Logs[Trace Events]
  end

  Discord --> Intake
  Slash --> Intake
  Intake --> Router
  Router --> Chat
  Router --> Task
  Cron --> Providers
  Providers --> Task
  Memory --> Chat
  Memory --> Task
  Task --> Claude
  Task --> Codex
  Chat --> SQLite
  Task --> SQLite
  Claude --> Logs
  Codex --> Logs
```

## Boundary Map

- **Interface boundary**: Discord carries user intent, progress, final output, and operator actions.
- **Runtime boundary**: routing, task lifecycle, cron orchestration, and recovery logic stay in MiniClaw.
- **Provider boundary**: external accounts are read-only context sources; secrets and sessions stay outside Git.
- **Execution boundary**: Claude and Codex run work, but MiniClaw normalizes sessions, usage, trace events, and delivery.
- **Docs boundary**: repo docs remain the source of truth; this website exposes the stable mental model.

## Data Movement

```mermaid
flowchart TD
  Intent[User Intent / Cron Trigger] --> Route[Route Decision]
  Route --> Context[Context Assembly]
  Context --> Execute[Agent Execution]
  Execute --> Persist[Persist Trace + State]
  Persist --> Deliver[Discord Delivery]
  Deliver --> Recover[Auto Doctor / Recovery]
  Recover --> Persist
```

Legacy feature docs now live under `docs/archive/features/`. Current implementation facts belong in runtime, provider, experiment, and reference docs, then flow into this website through `source_docs`.
