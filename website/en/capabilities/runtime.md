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

The runtime turns an intake event into a bounded chat response, a managed task thread, or a scheduled provider-driven report. A hard Discord route runs first; Smart Router only acts inside the chat-eligible path.

```mermaid
flowchart TD
  Intake[Discord / IM Intake] --> Normalize[Normalize Message]
  Normalize --> HardRoute[Hard Route]
  HardRoute --> Decide[Smart Router]
  Decide --> Chat[Chat Runtime]
  Decide --> Confirm[Task Confirmation]
  Confirm --> Task[Task Runtime]
  Cron[Cron Trigger] --> ActiveWindow[config.yaml active_window]
  ActiveWindow --> Task
  Task --> Agent[Agent Runtime Registry]
  Agent --> Events[Task Events]
  Events --> Store[(SQLite)]
  Events --> Delivery[Discord Progress + Result]
  Store --> Recovery[Connectivity / Auto Doctor]
  Recovery --> Delivery
```

## Runtime Responsibilities

- **Intake normalization**: Discord events become a consistent route input before any agent runtime is called.
- **Routing semantics**: the hard route decides ignore/thread continuation/task channel/chat; Smart Router separates chat, suggested task, confirmed task, and trusted auto-task channels.
- **Task lifecycle**: task threads, progress cards, tool traces, final Markdown output, cancellation, and resume behavior are runtime concerns.
- **Discord delivery**: long Markdown results are chunked into Discord-sized messages so link-heavy cron reports stay readable.
- **Cron execution**: scheduled cron dispatches pass through the global `config.yaml` active-window guard before scripts, providers, or task runtime run.
- **Recovery loop**: connectivity and doctor repair paths reuse stored incidents and trace evidence.
- **Merged runtime docs**: feature-level runtime notes have been folded into the runtime source docs.

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

Runtime docs carry the implementation details and path ownership, including button dispatch, slash command dispatch, and thread continuation. This website page keeps the mental model stable for readers who need to understand how work moves through the system.
