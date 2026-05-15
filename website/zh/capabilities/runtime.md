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

MiniClaw runtime 连接 Discord intake、Smart Router decisions、cron tasks、managed agent execution、memory/context 和 recovery operations。

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

网站只保留面向人的运行时地图；实现规则、owner paths 和高 drift contracts 维护在 repo runtime docs 中。
