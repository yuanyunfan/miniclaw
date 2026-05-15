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

```mermaid
flowchart LR
  Discord[Discord / IM] --> Bot[Bot Intake]
  Bot --> Router[Routing / Smart Router]
  Router --> Chat[Chat Runtime]
  Router --> Task[Task Runtime]
  Cron[Cron Scheduler] --> Provider[Pre Providers]
  Provider --> Task
  Task --> Agent[Claude / Codex Runtime]
  Agent --> Store[(SQLite Store)]
  Task --> Delivery[Discord / IM Delivery]
  Monitoring[Connectivity / Auto Doctor] --> Store
  Monitoring --> Delivery
```

MiniClaw's repo docs remain the implementation source of truth. This website page is a human-facing architecture summary with links back to the canonical docs and the current Chinese mirror.
