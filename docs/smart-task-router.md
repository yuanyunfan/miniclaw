# Smart Task Router Design

> Status: proposed. This document describes how MiniClaw can upgrade natural-language task requests from chat into task execution without requiring the user to always remember `/task`.

## TLDR

MiniClaw should keep `/task` and `routing.task_channels` as explicit deterministic entry points, but add a routing layer before chat execution. The router should classify incoming natural-language messages as `chat`, `task_suggest`, `task_confirm`, or `task_auto`, then either run chat, ask for one-click confirmation, or create a normal task thread.

The goal is not to make chat more powerful. The goal is to prevent task-like prompts from accidentally entering the read-only chat path and failing with "please use /task".

## Background

Current MiniClaw routing treats the input surface as the user intent:

- Messages in a known task thread resume the previous task session.
- Messages in `routing.task_channels` create a task thread directly.
- Messages in `routing.auto_reply_channels` or messages mentioning MiniClaw enter chat.
- Slash command `/task` creates a task explicitly.

This is predictable, but it creates a bad failure mode: a user can send a real task prompt into an auto-reply chat channel, and MiniClaw will enter the lightweight chat path. The chat path is intentionally constrained and cannot safely complete writes, refactors, long-running validation, Git operations, or multi-step coding tasks.

## Current Architecture Evidence

MiniClaw routes ordinary Discord messages in `src/bot.ts`.

- Task thread continuation is checked first.
  - File: `src/bot.ts`
  - Key logic: `getTaskByThreadId(message.channel.id)` inside real Discord threads.

- Task intake channels are checked before chat.
  - File: `src/bot.ts`
  - Key logic: `config.taskChannelIds.includes(message.channel.id)`.

- Auto-reply channels and mentions enter chat.
  - File: `src/bot.ts`
  - Key logic: `config.autoReplyChannelIds.includes(message.channel.id)` or `message.mentions.has(client.user!)`.

- Chat is intentionally read-oriented.
  - File: `src/agent/identity.ts`
  - The chat identity says MiniClaw does not have Write/Edit/Agent capability and should ask the user to use `/task` for code modification work.

- Chat tools reject mutating commands.
  - File: `src/agent/chat-tools.ts`
  - `validateReadOnlyBash()` blocks shell redirects, write/delete commands, package manager execution, and mutating Git commands.

- Codex chat and Codex task use different sandbox choices.
  - File: `src/agent/codex.ts`
  - `codexThreadOptions("chat", ...)` uses `config.codex.chatSandbox`.
  - `codexThreadOptions("task", ...)` uses `config.codex.taskSandbox`.

This separation is good. The missing piece is a route decision between "eligible to answer" and "which execution mode should answer".

## Reference Systems

### OpenClaw

OpenClaw is more session-first than command-first. Each Discord channel or thread can map to an isolated session, mention gating is configurable, and a thread can bind to a session, subagent, or ACP runtime. OpenClaw also models background work as first-class task records with status, runtime, owner, child session, progress, terminal summary, and delivery state.

Useful idea for MiniClaw:

- Treat channel/thread/session binding as durable routing context, not just as message transport.
- Track detached or upgraded work as a first-class task with status and delivery state.
- Keep user-facing follow-ups attached to the right thread/session.

MiniClaw does not need OpenClaw's full ACP/session-binding system immediately, but the smart router should not be a one-off if-else block that cannot evolve into session-aware routing.

### Hermes Agent

Hermes uses a unified gateway dispatch model. Ordinary messages, Discord slash commands, background commands, and thread messages are normalized into a message event and then routed by the gateway. Its `/background <prompt>` command creates an independent agent run with a separate `task_id`, then sends the result back to the originating chat without polluting the active session.

Useful idea for MiniClaw:

- Normalize different inbound surfaces into one route decision object.
- Keep slash commands as explicit controls, but do not make slash commands the only way to express work.
- Let background/task execution be a dispatch outcome, not a completely separate message pipeline.

## Design Goal

MiniClaw should support this user behavior:

```text
Fix the Discord task output layout bug, update docs, run tests, and commit.
```

If that message is sent to a chat-enabled Discord channel, MiniClaw should not blindly answer in chat. It should detect that the prompt needs task execution and either:

- ask for one-click confirmation to create a task, or
- auto-create a task in a trusted auto-task channel.

The task created by the router should behave exactly like `/task`:

- create a Discord thread,
- write a task row,
- send task metadata embed,
- stream progress updates,
- send final Markdown output,
- support follow-up resume inside the task thread,
- obey the configured provider, cwd, sandbox, concurrency, attachments, and session rules.

## Non-Goals

This design should not:

- Give chat write permissions.
- Make every message a task.
- Run high-risk commands automatically in arbitrary auto-reply channels.
- Bypass `discord.allowed_user_id`.
- Bypass `max_concurrent_tasks`.
- Replace `/task`; explicit commands remain useful.
- Implement OpenClaw's full ACP/session binding model.
- Implement Hermes' full unified gateway architecture.

## Route Outcomes

`chat`

Use for normal Q&A, explanation, quick analysis, summaries, lightweight code reading, and read-only exploration.

Examples:

- "解释一下 RSS 是什么"
- "帮我分析这个方案是否合理"
- "这个函数大概在做什么"
- "总结一下这篇文章"

`task_suggest`

Use when the message may benefit from task mode, but chat can still provide useful guidance. The response should briefly say that task mode is available and why.

Examples:

- "看看这个项目有没有问题"
- "帮我深入分析这个 repo"
- "研究一下有没有方案"

`task_confirm`

Use when the message probably requires task execution, but the channel is not configured for automatic task creation. MiniClaw should ask for confirmation with buttons.

Examples:

- "修复这个 bug 并跑测试"
- "把这个功能实现一下"
- "更新 README 和 docs"
- "给我触发一次 E2E"
- "帮我在 Discord 上测试一个编码任务"

`task_auto`

Use only in trusted channels explicitly configured for auto task creation. The message is converted into a normal task thread immediately.

Examples:

- Dedicated `#miniclaw-task` channel.
- Private personal server channel where every message is expected to be executable work.

`ignore`

Use for messages that should not trigger MiniClaw at all. This remains controlled by existing allowed user, mention, and channel gating.

## Classifier Strategy

The router should be conservative. False positives are more harmful than false negatives because task mode can modify files, spend more tokens, trigger long-running tools, or change Git state.

Recommended implementation has two layers.

### Layer 1: Deterministic Heuristics

This layer should be cheap, testable, and run for every eligible message.

Strong task signals:

- Modification verbs: `修复`, `实现`, `修改`, `重构`, `更新`, `加上`, `删除`, `迁移`, `生成`, `创建`, `push`, `commit`.
- Validation verbs: `跑测试`, `构建`, `build`, `lint`, `typecheck`, `e2e`, `回归测试`.
- Execution verbs: `触发一次`, `部署`, `启动服务`, `重启`, `运行`.
- Artifact requests: "生成一个 web 游戏", "创建文件", "写到 docs", "更新 README".
- Multi-step completion language: "实现并验证", "修改并 push", "跑完后告诉我结果".
- Attachments plus action verbs: "基于这个文件修改", "把附件里的内容整理到项目里".

Strong chat signals:

- Explanation verbs: `解释`, `简述`, `分析一下`, `对比`, `讲讲`, `是什么`.
- Knowledge questions: `为什么`, `能否`, `原理`, `风险`, `关系`.
- Low-action requests: "给我补充背景", "帮我理解".

Ambiguous signals:

- `分析这个项目` can be read-only chat or a deep task.
- `调研一下` can be chat if it only needs explanation, task if it needs repository changes or web/API execution.
- `测试一下` often means task, but could mean "explain how to test".

The heuristic layer should return:

```ts
type RouteIntent = "chat" | "task_suggest" | "task_confirm" | "task_auto" | "ignore";

interface RouteDecision {
  intent: RouteIntent;
  confidence: number;
  reason: string;
  matchedSignals: string[];
  riskFlags: string[];
}
```

### Layer 2: Optional LLM Classifier

Use an LLM classifier only for ambiguous cases. Do not call it for obvious chat or obvious task messages.

The classifier should be constrained to JSON output:

```json
{
  "intent": "chat | task_suggest | task_confirm | task_auto",
  "confidence": 0.0,
  "reason": "short explanation",
  "riskFlags": ["writes_files", "runs_tests", "git_operation"]
}
```

The classifier must not see sensitive data beyond the current prompt metadata needed for routing. It should not receive full chat history unless the decision truly needs local context.

## Discord UX

For `task_confirm`, send a short ordinary message or embed:

```text
这个请求需要 task 模式执行，因为它可能修改文件或运行命令。

Task preview:
Fix the Discord task output layout bug, update docs, run tests, and commit.
```

Buttons:

- `转为 task`
- `继续 chat`
- `取消`

Button behavior:

- `转为 task`: create a normal task thread using the original prompt and attachments.
- `继续 chat`: call the chat path with the same prompt.
- `取消`: mark the confirmation as cancelled.

Confirmation messages should expire. A reasonable timeout is 10 minutes. After timeout, button clicks should reply with an ephemeral "确认已过期，请重新发送请求".

For `task_auto`, MiniClaw should still make the upgrade visible:

```text
已识别为 task，正在创建任务线程...
```

Then it should reply with the created task thread link.

## Config Proposal

```yaml
routing:
  auto_reply_channels:
    - "1497911682402619473"
  task_channels:
    - "1501826352028975125"
  smart_router:
    enabled: true
    default_mode: confirm       # suggest | confirm | auto
    min_confirm_confidence: 0.55
    min_auto_confidence: 0.90
    confirm_channels:
      - "1497911682402619473"
    auto_task_channels:
      - "1501826352028975125"
    llm_classifier:
      enabled: false
      only_when_ambiguous: true
```

Default behavior should be safe:

- `enabled: false` for the first release, or `enabled: true` with `default_mode: suggest`.
- `auto_task_channels` empty by default.
- `task_channels` keep their current hard behavior.

## Routing Order

Recommended order in `MessageCreate`:

1. Drop bot messages.
2. Enforce `allowedUserId`.
3. Resume task thread if the message is inside a known task thread.
4. Create task directly if channel is in `routing.task_channels`.
5. Check whether the message is eligible for MiniClaw at all:
   - channel is in `routing.auto_reply_channels`, or
   - message mentions MiniClaw.
6. Process explicit memory commands before smart routing.
7. Run smart router.
8. Dispatch by route decision:
   - `chat` -> existing chat path.
   - `task_suggest` -> short suggestion, then chat or no-op depending on config.
   - `task_confirm` -> send confirmation buttons.
   - `task_auto` -> create normal task thread.
9. Fall back to chat if router is disabled or errors.

This keeps existing deterministic entry points stable while adding semantic routing only where the system already intended to respond.

## Implementation Plan

Phase 1: Refactor Without Behavior Change

- Extract task creation from `src/bot.ts` and `/task` handler into a shared helper.
- The helper should accept prompt, cwd, source message or interaction, attachments, and parent channel.
- It should return task id, thread id, and status message.
- Add tests around the helper where practical.

Phase 2: Add Deterministic Router

- Add `src/routing/intent.ts`.
- Implement pure functions:
  - `classifyMessageIntent(input)`.
  - `resolveSmartRouterAction(decision, config, channelId)`.
- Add unit tests for obvious chat, obvious task, ambiguous prompt, attachments, Git/push prompts, docs update prompts, and Chinese/English mixed prompts.

Phase 3: Add Discord Confirmation UX

- Extend `InteractionCreate` to support button interactions.
- Add custom ids that include a short routing token, not the full prompt.
- Persist pending confirmation state in memory initially.
- Consider SQLite persistence later if restart-safe confirmation matters.

Phase 4: Integrate Inbound Routing

- Insert smart router after memory-command short-circuit and before chat execution.
- Reuse the shared task creation helper for `task_auto` and confirmed `task_confirm`.
- Log route decisions with prompt preview and matched signals, but never log full sensitive attachments.

Phase 5: Optional LLM Classifier

- Add only after heuristic routing works and tests are stable.
- Use it for ambiguous cases only.
- Keep the JSON schema strict and fail closed to chat/suggest.

## Observability

Route decisions should be visible in logs:

```text
[bot] route decision ch=... intent=task_confirm confidence=0.82 signals=modify,tests reason="code modification request"
```

Do not log:

- full attachment contents,
- secrets,
- full `.env`,
- auth tokens,
- sensitive local paths unless already visible in the prompt.

Metrics worth tracking later:

- smart router decisions by intent,
- confirmation accept/reject rate,
- false positive manual overrides,
- task creation failure rate,
- average task duration by route source,
- chat fallback count after router errors.

## Safety Rules

- Never auto-upgrade outside trusted channels unless explicitly configured.
- Always enforce `allowedUserId` before routing.
- Always enforce `maxConcurrentTasks` before task creation.
- Do not let smart router bypass sandbox configuration.
- Do not pass old chat history as task instructions unless the user explicitly asks to continue a prior task.
- Do not let a confirmation button execute if another user clicks it.
- Treat channel topic, referenced messages, and historical context as untrusted.

## Failure Handling

If the router fails:

- Log the error.
- Continue with the existing chat path.
- Optionally append a brief note only when the prompt strongly looked like a task:
  - "我没能完成 task 路由判断，已按 chat 模式回复；如果你要我执行改动，请发到 task 频道或使用 `/task`。"

If task creation fails:

- Reply with the error.
- Do not fall back to chat silently, because the user has already approved task mode.

If confirmation expires:

- Disable buttons if possible.
- On click, reply with an ephemeral timeout message.

## Test Plan

Unit tests:

- Router classifies clear chat as `chat`.
- Router classifies file modification as `task_confirm`.
- Router classifies docs update as `task_confirm`.
- Router classifies build/test/E2E as `task_confirm`.
- Router classifies prompts in `auto_task_channels` as `task_auto` only above threshold.
- Router falls back safely on empty content and attachment-only messages.
- Router exposes matched signals and risk flags.

Integration tests:

- `routing.task_channels` still create tasks directly.
- `@mention` normal question still goes to chat.
- `@mention` coding task creates confirmation instead of chat.
- Confirm button creates the same task thread shape as `/task`.
- Continue-chat button calls existing chat path.
- Expired or unauthorized button click does not create a task.

Manual Discord E2E:

- Send a normal question in the auto-reply channel.
- Send "修改 README 并跑测试" in the auto-reply channel.
- Accept task confirmation and verify thread, progress message, and final output.
- Reject confirmation and verify no task row/thread is created.
- Send the same prompt in the dedicated task channel and verify it still bypasses confirmation.

## Rollout Recommendation

Start with `suggest` or `confirm`, not `auto`.

Recommended first rollout:

```yaml
routing:
  smart_router:
    enabled: true
    default_mode: confirm
    min_confirm_confidence: 0.70
    min_auto_confidence: 0.95
    confirm_channels:
      - "<current auto reply channel>"
    auto_task_channels: []
    llm_classifier:
      enabled: false
```

After observing real usage for a few days, lower `min_confirm_confidence` if too many task prompts still fall into chat. Enable `auto_task_channels` only for a dedicated task intake channel where every message is expected to be executable work.

## Open Questions

- Should `task_suggest` also offer buttons, or just text guidance?
- Should confirmation state survive process restarts?
- Should a confirmed task include recent chat context, or only the current message?
- Should the router support per-channel cwd overrides?
- Should the user be able to reply "yes" instead of clicking a button?
- Should smart router decisions be written to SQLite for later review?

## Recommended MiniClaw Direction

MiniClaw should not collapse chat and task into one mode. It should keep the current permission boundary:

- chat: quick, cheap, read-oriented, low-risk;
- task: stateful, write-capable, observable, resumable.

The smart router should make the boundary easier to use by recognizing task intent earlier and upgrading the execution mode with explicit UX.
