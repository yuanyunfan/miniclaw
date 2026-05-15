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

# 架构

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

repo 内 `docs/` 仍是 implementation source of truth。这个网站页面只提供面向人的高层架构摘要，并回链到 canonical docs 与 current 中文 mirror。

历史 feature 文档现在统一归档到 `docs/archive/features/`；当前实现事实由 runtime、provider、experiment 和 reference 文档维护。
