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

MiniClaw 的核心边界是：Discord 是 control 和 delivery surface；本地 runtime 负责 routing、provider context、task execution、storage、recovery 和 quality traceability。用户状态留在 `~/.miniclaw/`，实现事实留在 `docs/`。

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
    Manager[Agent Run Manager]
    Cron[Cron Scheduler]
    ActiveWindow[config.yaml active_window]
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
  Task --> Manager
  Cron --> ActiveWindow
  ActiveWindow --> Providers
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

## 边界图

- **Interface boundary**：Discord 承载用户意图、执行进度、最终输出和 operator actions。
- **Runtime boundary**：routing、task lifecycle、可选 Agent Run Manager orchestration、cron active-window guard 和 recovery logic 留在 MiniClaw。
- **Provider boundary**：外部账户只作为 read-only context source；secrets 和 sessions 不进入 Git。
- **Execution boundary**：Claude/Codex 执行任务，但 session、usage、trace events 和 delivery 由 MiniClaw 统一。
- **Docs boundary**：英文 repo docs 是 canonical source；中文 mirror 和 website pages 都通过 gate 跟随它。

## 数据流动

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

历史 feature stubs 已完成合并并删除。当前实现事实应写入 runtime、provider、experiment 和 reference docs，再通过 `source_docs` 流入 website。
