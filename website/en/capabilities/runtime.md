---
status: public-summary
source_docs:
  en:
    - docs/runtime/README.md
    - docs/bot-routing.md
    - docs/chat-router-current-logic.md
  zh:
    - docs/zh/runtime/README.zh.md
---

# Runtime

MiniClaw runtime connects Discord intake, Smart Router decisions, cron tasks, managed agent execution, memory/context, and recovery operations.

```mermaid
flowchart LR
  Intake[Discord / IM Intake] --> Router[Smart Router]
  Router --> Chat[Chat Runtime]
  Router --> Task[Task Runtime]
  Cron[Cron Scheduler] --> Task
  Task --> Agent[Agent Runtime]
  Agent --> Events[Task Events]
  Events --> Delivery[Discord Delivery]
  Memory[Memory / Context] --> Chat
  Memory --> Task
  Recovery[Connectivity / Auto Doctor] --> Delivery
```

The website keeps this as a readable map. Implementation rules, owner paths, and drift-sensitive contracts live in the repo runtime docs and their current Chinese mirror.
