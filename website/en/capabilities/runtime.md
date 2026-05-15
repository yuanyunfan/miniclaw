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

The runtime turns an intake event into a bounded chat response, a managed task thread, or a scheduled provider-driven report. The same event model feeds trace storage and recovery.

```mermaid
flowchart TD
  Intake[Discord / IM Intake] --> Normalize[Normalize Message]
  Normalize --> Decide[Smart Router]
  Decide --> Chat[Chat Runtime]
  Decide --> Confirm[Task Confirmation]
  Confirm --> Task[Task Runtime]
  Cron[Cron Trigger] --> Task
  Task --> Agent[Agent Runtime Registry]
  Agent --> Events[Task Events]
  Events --> Store[(SQLite)]
  Events --> Delivery[Discord Progress + Result]
  Store --> Recovery[Connectivity / Auto Doctor]
  Recovery --> Delivery
```

## Runtime Responsibilities

- **Intake normalization**: Discord events become a consistent route input.
- **Routing semantics**: Smart Router separates chat, suggested task, confirmed task, and trusted auto-task channels.
- **Task lifecycle**: task threads, progress cards, tool traces, final Markdown output, cancellation, and resume behavior are runtime concerns.
- **Cron execution**: cron jobs can collect provider output before creating the agent prompt.
- **Recovery loop**: connectivity and doctor repair paths reuse stored incidents and trace evidence.

## Context Assembly

```mermaid
flowchart LR
  Message[Incoming Message] --> Route[Route Context]
  Memory[Memory Store] --> Prompt[Prompt Context]
  History[Chat History] --> Prompt
  Attachments[Attachments] --> Prompt
  Providers[Provider Output] --> Prompt
  Route --> Prompt
  Prompt --> Agent[Claude / Codex]
```

Runtime docs carry the implementation details and path ownership. This website page keeps the mental model stable for readers who need to understand how work moves through the system.
