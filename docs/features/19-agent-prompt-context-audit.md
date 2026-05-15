# Agent Prompt And Context Audit

Status: current-state audit
Date: 2026-05-13

## Conclusion

MiniClaw is not just forwarding the user's raw Discord text to Codex or Claude Code. It builds a layered prompt envelope from identity, memory, optional supervisor guidance, Discord source metadata, reply context, recent chat history, attachments, cron pre-context, and the current user task. The exact shape differs by route and by provider:

- Codex chat/task receives one flattened `UserInput` text block, plus optional Codex attachment inputs.
- Claude chat receives Anthropic Messages `system` plus `messages[]` content blocks.
- Claude task receives Claude Agent SDK `query()` with `systemPrompt.preset = "claude_code"` and `append` containing MiniClaw identity/supervisor/memory.
- Cron `type=task` first renders a cron wrapper and optional pre-provider/pre-script block, then enters the same task runner as Discord task.

The current design works, but the context layer is already too ad hoc. The biggest issues are prompt bloat in cron/provider runs, inconsistent trusted/untrusted rendering, privacy risk from persisting full cron prompts, stale/duplicated memory injection, and route/provider-specific prompt logic spread across too many files.

## Scope And Evidence

This audit is based on current repo code plus redacted local runtime evidence from `~/.miniclaw/config.yaml` and `~/.miniclaw/data.db`.

Key code evidence:

- `src/agent/chat.ts`: chat history, memory, Codex chat prompt, Claude chat messages.
- `src/agent/runners/codex-task-runner.ts`: Codex task prompt assembly.
- `src/agent/runners/claude-task-runner.ts`: Claude Agent SDK task options.
- `src/routing/task-context.ts`: Discord task source/reply context envelope.
- `src/routing/chat-context.ts`: Discord chat runtime context.
- `src/routing/context.ts`: Smart Router recent chat injection.
- `src/cron/runner-task.ts`: cron pre-script/pre-provider rendering and task execution.
- `prompts/templates/*.md`: cron prompt templates.
- `prompts/supervisor.md`: task supervisor block.

Runtime evidence observed locally:

- Default agent provider/runtime is Codex.
- Codex chat sandbox is read-only; Codex task sandbox is inherited from local Codex config.
- Smart Router is enabled, default mode is confirm, confirm channels are wildcard, auto-task channels are empty.
- `buildMemoryPrompt()` currently renders about 4.1k characters; the raw MiniClaw memory file is about 8.6 KB.
- `buildSupervisorBlock()` currently renders about 1.6k characters.
- A real `us-stock-hourly-pulse` cron run rendered a 31.6k-character task prompt; its pre-provider context alone was about 29.9k characters. The Codex turn recorded 61.7k input tokens, 3.9k output tokens, 2.9k reasoning tokens, 10 tool events, and about 91 seconds duration.

Sensitive runtime details such as channel ids, user ids, email credentials, cookie/session data, and full private portfolio payloads are intentionally omitted here.

## Prompt Entry Points

### Chat Route

The Discord chat handler does four things before calling the agent:

1. Strips the bot mention and converts empty attachment-only messages into a default prompt.
2. Runs Smart Router when enabled.
3. Processes attachments into Anthropic content blocks and Codex input entries.
4. Builds Discord runtime context from source message metadata and optional reply parent.

Relevant flow:

- `src/bot/message-chat.ts:75-160`: Smart Router decision before chat.
- `src/bot/message-chat.ts:172-180`: builds `chatRuntimeContext`.
- `src/agent/chat.ts:77-82`: builds `system = identity + memory`.
- `src/agent/chat.ts:108-115`: Claude chat user content order.
- `src/agent/chat.ts:284-290`: Codex chat flattened prompt order.

### Task Route

Discord task creation first builds an execution prompt with source metadata and optional reply parent:

```text
<task_source_metadata trust="untrusted">
...
</task_source_metadata>

<reply_parent_context trust="untrusted">
...
</reply_parent_context>

<user_task priority="current">
...
</user_task>
```

Relevant flow:

- `src/discord/task-intake.ts:80-87`: creates thread and builds `executionPrompt`.
- `src/discord/task-intake.ts:88-100`: persists display prompt and context metadata, not full execution prompt.
- `src/discord/task-intake.ts:138-145`: passes `executionPrompt` to `executeTask`.
- `src/bot/message-thread-continuation.ts:81-84`: follow-up tasks build the same context envelope and resume the provider session.

### Cron Task Route

Cron `type=task` does not start with Discord message metadata. It renders:

```text
[cron:<job_name>]

<optional pre_script or pre_provider block>

<job.prompt rendered with {{date}}, {{time}}, {{cron.name}}, ...>
```

Relevant flow:

- `src/cron/runner-task.ts:102-119`: pre-script/pre-provider/task prompt builders.
- `src/cron/runner-task.ts:336-384`: runs pre-script or pre-provider and prepends output.
- `src/cron/runner-task.ts:422-424`: renders final cron task prompt.
- `src/cron/runner-task.ts:427-436`: persists the full cron prompt into `tasks.prompt`.
- `src/cron/runner-task.ts:457-460`: passes the cron prompt to `executeTask`.

## What Codex Receives

### Codex Chat

Current code starts a Codex thread in chat mode:

```ts
codex.startThread(codexThreadOptions("chat", config.defaultCwd))
```

Then it sends a flattened prompt:

```text
<chat identity and tool/capability instructions>

<memory_context trust="user-maintained-background">
...
</memory_context>

你正在处理 Discord 轻量聊天。默认直接回答；只有在需要确认本地文件、运行只读命令或搜索资料时才使用工具。用中文回复。

<discord_message_context trust="untrusted">
...
</discord_message_context>

<reply_parent_context trust="untrusted">
...
</reply_parent_context>

<conversation_history trust="historical-context">
...
</conversation_history>

<user_message>
current Discord message
</user_message>
```

Important details:

- This is passed through `codexInput(fullPrompt, attachmentCodexInputs)`.
- If there are attachments, Codex receives an array with `{ type: "text", text: fullPrompt }` plus local image/text attachment entries.
- `codexThreadOptions("chat", ...)` applies chat sandbox, approval policy, reasoning effort, model, web search mode, network access, and working directory.
- In current local config, chat sandbox is read-only.

### Codex Task

Codex task is a different wrapper:

```text
你是 MiniClaw，一个简洁高效的 AI 助手，通过 Discord 与用户沟通。回复时始终以 MiniClaw 的身份自居，不要说自己是 Claude 或 Claude Code。

<supervisor block from prompts/supervisor.md, if subagents exist>

<memory_context trust="user-maintained-background">
...
</memory_context>

你正在通过 Codex SDK 执行 MiniClaw 的 coding-agent 任务。请直接完成用户请求；需要修改文件时使用工作区内的工具，最后用中文给出结果和验证证据。

<task_source_metadata trust="untrusted">
...
</task_source_metadata>

<reply_parent_context trust="untrusted">
...
</reply_parent_context>

<user_task priority="current">
...
</user_task>
```

For cron, the `<user_task>` content is the rendered `[cron:<job>]` block plus provider/script data and the cron prompt.

Important details:

- The Codex task wrapper always injects identity, supervisor, and memory before the task.
- `formatTaskPromptForSystem()` avoids double-wrapping if the input already contains task context tags.
- Attachments are appended as Codex SDK input entries.
- `codexThreadOptions("task", input.cwd)` sets the task working directory and task sandbox.

## What Claude Code Receives

### Claude Chat

Claude chat uses Anthropic Messages API, not Claude Agent SDK. MiniClaw sends:

```ts
ant.messages.stream({
  model: config.claudeModel,
  max_tokens: 4096,
  system: identity + memory,
  tools: CHAT_TOOLS,
  messages: [
    {
      role: "user",
      content: [
        runtimeContext?,
        historyContext?,
        attachmentBlocks...,
        currentPrompt,
      ],
    },
    ...
  ],
})
```

The local chat tools are deliberately read-oriented:

- `read_file(path)`: absolute path only, 1 MB cap.
- `bash(command)`: read-only command policy, output cap.
- `web_fetch(url)`: public HTTP(S) fetch only, private hosts blocked.

### Claude Task

Claude task uses `@anthropic-ai/claude-agent-sdk`:

```ts
query({
  prompt: input.prompt or async generator with attachments + input.prompt,
  options: {
    model: config.claudeModel,
    cwd: input.cwd,
    permissionMode: "acceptEdits",
    settingSources: config.claude.settingSources,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: identity + supervisor + memory,
    },
    allowedTools: [
      "Read", "Write", "Edit", "Bash", "Glob",
      "WebSearch", "WebFetch", "Agent",
      "mcp__exa__web_search_exa",
      "mcp__exa__get_code_context_exa",
      "mcp__context7__resolve-library-id",
      "mcp__context7__query-docs",
      ...enabled MCP tools,
    ],
    agents: subagents,
    mcpServers,
    canUseTool,
    maxTurns?,
    maxBudgetUsd?,
    resume?,
  },
})
```

Important details:

- Claude Code gets MiniClaw identity/supervisor/memory as `systemPrompt.append`, which is higher-level than ordinary user text.
- User/source/reply/cron context remains in `prompt`.
- Attachments are placed before the text prompt in a user content message.
- `canUseTool` blocks `Skill triad`, caps repeated subagent calls per role, and rejects obvious destructive Bash commands.

## Context Sources Added By MiniClaw

### Always Or Usually Added

- Identity:
  - Chat identity includes read-only tool/capability constraints.
  - Task identity is shorter and provider-neutral.
- Long-term memory:
  - Pulled from MiniClaw memory store.
  - Rendered inside `<memory_context trust="user-maintained-background">`.
  - Current default cap is 4,000 characters of memory lines, plus wrapper text.
- Supervisor block:
  - Only for task routes when subagents exist.
  - Describes researcher, code-investigator, planner, generator, evaluator.
- Current prompt:
  - Chat uses `<user_message>`.
  - Task uses `<user_task>` or structured task prompt.

### Route-Specific Context

- Discord source metadata:
  - route type, guild/channel/message ids, channel/thread names, author metadata, message URL, timestamp, cwd, attachment summaries.
  - Rendered as untrusted JSON and escapes `<`, `>`, and backticks.
- Reply parent context:
  - Rendered when the user replies to another Discord message.
  - Parent message content is capped at 4,000 characters.
- Recent chat context:
  - Chat route always includes channel history up to 15 user/assistant turns.
  - Smart Router task route includes recent chat only when the current prompt references prior context by regex.
- Attachments:
  - Images become Anthropic image blocks and Codex local images.
  - Small text files are inlined.
  - Large text/PDF/binary files are saved under `.miniclaw-attachments/<task_id>` and described by path.
  - Audio is transcribed when possible.
- Cron pre-context:
  - `pre_script` stdout is prepended as a code-fenced block.
  - `pre_provider` output is prepended as a code-fenced JSON block.
  - Each pre-context path has a 50,000-character cap.

## Real Case 1: Chat

Observed runtime case:

- Time: 2026-05-13 15:03 UTC.
- User prompt: `这是为什么？`
- Smart Router decision: `chat`, confidence `0.3`, ambiguity high.
- Current local default provider: Codex.
- Recent chat contained a prior assistant explanation about why a watchlist stock task skipped.

What MiniClaw likely sent to Codex:

```text
<chat identity, including read-only tools and "no Write/Edit/Agent">

<memory_context ...>
about 4.1k chars of MiniClaw memory
</memory_context>

你正在处理 Discord 轻量聊天...

<discord_message_context trust="untrusted">
redacted source message metadata
</discord_message_context>

<conversation_history trust="historical-context">
<message role="assistant">
prior explanation about watchlist provider skip
</message>
<message role="user">
这是为什么？
</message>
...
</conversation_history>

<user_message>
这是为什么？
</user_message>
```

Prompt assessment:

- Good: chat stays read-only and includes history, so a vague follow-up can be answered.
- Problem: history is always added for chat, not only when referenced. That can spend context on stale channel chatter.
- Problem: `buildHistoryContext()` wraps raw message content directly in XML-like tags without escaping delimiters. A malicious or accidental `</message>` / `</conversation_history>` sequence can break the intended structure.
- Problem: the router classified this as chat despite high ambiguity. That is reasonable for a vague follow-up, but the chat path then depends heavily on recent history quality.

## Real Case 2: Task

Observed runtime case:

- Time: 2026-05-13 15:21 UTC.
- User prompt: `我现在的eastmoney-jywg/default 正常吗`
- Smart Router decision: `task_confirm`, confidence `0.8`.
- Capability reason: runtime inspection needed.
- User accepted task creation.
- Task completed through Codex runtime.
- The user message replied to a prior third-party health alert, so reply parent context was included.

Execution prompt shape:

```text
<task_source_metadata trust="untrusted">
{
  "provider": "discord",
  "route_type": "smart_router_confirmed",
  "source_channel_name": "<redacted>",
  "source_message_url": "<redacted>",
  "cwd": "<workspace-root>",
  "was_mentioned": true,
  "task_thread_name": "🤖 我现在的eastmoney-jywg/default 正常吗"
}
</task_source_metadata>

<reply_parent_context trust="untrusted">
{
  "kind": "reply",
  "provider": "discord",
  "content": "MiniClaw 第三方连接健康检查 ... eastmoney-jywg/default health 异常 ..."
}
</reply_parent_context>

<user_task priority="current">
我现在的eastmoney-jywg/default 正常吗
</user_task>
```

Then Codex task prepended identity, supervisor, memory, and the Codex task instruction before this execution prompt.

Prompt assessment:

- Good: the reply parent gives the agent the exact health-alert context needed to answer the current question.
- Good: task context JSON is escaped for `<`, `>`, and backticks, reducing delimiter injection risk.
- Good: only the display prompt is persisted for Discord task rows; the richer execution prompt is reconstructable from source/parent JSON.
- Problem: identity, supervisor, and memory are injected even for a narrow runtime health check. The supervisor block alone is about 1.6k characters and may encourage unnecessary subagent orchestration.
- Problem: MiniClaw does not store a redacted component-level prompt audit for Discord tasks. It stores display prompt and context metadata, but not the exact rendered prompt shape/hash/char count that reached Codex or Claude.

## Real Case 3: Cron Task

Observed runtime case:

- Job: `us-stock-hourly-pulse`.
- Time: 2026-05-13 15:30 UTC.
- Type: `task`.
- Pre-provider: `stock-pulse`.
- Provider status: ok.
- Task provider: Codex.
- Final prompt persisted length: about 31.6k characters.
- Pre-provider context chars recorded: about 29.9k.
- Codex usage recorded: 61.7k input tokens, 3.9k output tokens, 2.9k reasoning tokens.
- Tool events: 10, mostly web search calls for benchmark index data.
- Duration: about 91 seconds.

Cron prompt shape:

````text
[cron:us-stock-hourly-pulse]

内置 provider `stock-pulse` 采集到的数据如下。

如果末尾出现 `... (truncated)`...

```json
{
  "generated_at": "...",
  "source": "stock-pulse",
  "profile": "us-hourly",
  "run_context": { ... },
  "universe": { ... },
  "positions": [ redacted holdings/watchlist/index rows ],
  "position_groups": { redacted grouped rows },
  "alerts": [ ... ],
  "failures": [ ... ],
  "warnings": [ ... ],
  "usage_notes": [ ... ]
}
```

你是我的美股盘中异动分析助手...
````

Prompt assessment:

- Good: provider computes market/session state before the LLM call, so the LLM is not guessing the raw facts.
- Good: the prompt explicitly says not to invent alerts and not to provide unsolicited trade instructions.
- Problem: provider data dominates the prompt. The LLM sees full `positions[]` and also grouped `position_groups`, which duplicates many fields.
- Problem: private portfolio details and P&L values are persisted in `tasks.prompt` for cron tasks. This is convenient for debugging but poor data minimization.
- Problem: the prompt asks the LLM to web-search missing benchmark data. In the observed run this triggered 10 tool events. Benchmark completeness should be a provider responsibility, not an LLM fallback.
- Problem: pre-provider/pre-script output is placed in Markdown code fences without escaping backticks or modeling the content as an untrusted JSON value. A provider/script output containing a code fence can break the prompt boundary.
- Problem: the 50k character cap is blunt. It truncates by tail length, not by semantic priority, and does not give the model a structured manifest of omitted data.

## Cross-Provider Differences

### Priority Difference

Claude task puts MiniClaw identity/supervisor/memory in `systemPrompt.append` on top of the `claude_code` preset. Codex task places the same material in the text prompt passed to `thread.runStreamed()`.

That means MiniClaw's own task instructions are rendered at different semantic layers across providers. This can create subtle behavior drift:

- Claude Code treats MiniClaw identity/supervisor/memory as system append.
- Codex sees the same content as part of the user input payload.

The current code does not have a provider-neutral `PromptEnvelope` that preserves component role, trust level, priority, and budget before rendering to provider-specific SDK calls.

### Tool Difference

Claude chat uses MiniClaw-defined `CHAT_TOOLS`. Codex chat uses Codex SDK capabilities constrained by thread options. The visible chat identity tells the model about MiniClaw's read-only tools, but the actual Codex SDK tool surface is not expressed by the same `CHAT_TOOLS` schema.

### Persistence Difference

Discord task rows persist display prompt plus source/parent JSON. Cron task rows persist the full rendered prompt, including provider output. This inconsistency is important:

- Discord task is safer but harder to audit exactly.
- Cron task is easier to reproduce but can store too much private data.

## Problems To Fix

### P0: Full Cron Prompt Persistence Leaks Too Much Context

`src/cron/runner-task.ts` persists the full rendered cron prompt into `tasks.prompt`. For provider-heavy jobs, this can include private portfolio rows, P&L, email diagnostics, and other sensitive derived data.

Fix direction:

- Persist a display prompt or prompt hash by default.
- Store component-level metadata: component type, char count, hash, redacted preview.
- Store raw provider payload only in a provider-specific artifact path with explicit redaction/retention policy, or do not persist it at all.

### P0: Untrusted Context Escaping Is Incomplete

Task source/reply JSON is escaped well, but chat history and Smart Router recent chat context embed raw message content inside XML-like tags. Cron pre-script/pre-provider output is injected into Markdown fences without escaping fence delimiters.

Fix direction:

- Render all untrusted context through one safe renderer.
- Escape `<`, `>`, backticks, and code-fence delimiters consistently.
- Prefer JSON-string encoded content inside trusted wrapper tags rather than raw Markdown fences.

### P1: Prompt Budget Is Not Managed By Component Priority

Current caps are mostly local constants:

- memory: about 4k chars by line order.
- chat history: fixed recent turns.
- Smart Router recent context: max chars.
- cron pre-context: 50k chars.
- attachments: small text can inline up to 1 MB.

There is no global context budget manager that says: identity first, current task next, direct source/reply context next, recent history only if relevant, provider summary before raw rows, memory only if relevant.

Fix direction:

- Introduce component budgets and priority ordering.
- Record char/token estimate per component.
- Add route-specific defaults for chat, task, cron, and resume.

### P1: Supervisor And Memory Are Always-On For Task

For narrow tasks, the supervisor block and broad memory context add cost and behavioral noise. A status check does not need multi-agent orchestration guidance unless the task actually needs subagents.

Fix direction:

- Make supervisor injection conditional on a task capability flag such as `allow_subagents` or `expected_complexity >= medium`.
- Make memory retrieval scoped by project/channel/route keywords rather than raw insertion order.
- Add stale/duplicate memory cleanup and per-memory last-used metadata.

2026-05-15 Agent Run Manager status:

- Default single-agent Codex/Claude task prompts still keep the existing identity/supervisor/memory behavior for backward compatibility.
- Managed tasks now have an explicit Manager-owned child role prompt instead of relying on the generic Codex task supervisor block as the orchestration authority.
- `agent_run_manager.auto_enabled=true` introduces a local complexity gate so only medium/high complexity tasks enter the managed path automatically; `agent_run_manager.enabled=false` with `auto_enabled=false` remains the conservative rollback state.
- Managed child prompts also include the live Agent Bus MCP usage block and the `miniclaw_agent_envelope` fallback instruction; these code-owned prompt fragments are now registered in `docs/prompts.md`.

### P1: Provider Payloads Need Schema-Aware Compaction

Stock/provider payloads often contain both raw rows and derived grouped rows. This is useful for deterministic reporting, but inefficient when both are sent in full.

Fix direction:

- Require each provider to expose a compact `llm_context` with:
  - run summary;
  - top alerts;
  - grouped report rows already reduced to fields the prompt needs;
  - failures/warnings;
  - raw artifact path/hash for deeper inspection.
- Keep full raw payload out of the normal prompt.
- For `stock-pulse`, include required benchmark indices in provider output and remove routine LLM web fallback.

### P1: Prompt Rendering Is Scattered Across Routes

Prompt logic currently lives in:

- `src/agent/chat.ts`
- `src/agent/runners/codex-task-runner.ts`
- `src/agent/runners/claude-task-runner.ts`
- `src/routing/task-context.ts`
- `src/routing/context.ts`
- `src/routing/chat-context.ts`
- `src/cron/runner-task.ts`
- `prompts/templates/*.md`

This makes it hard to answer "what exactly reached the agent?" without reading several files and knowing which route/provider branch was active.

Fix direction:

- Add `src/prompt/envelope.ts`.
- All routes build a typed `PromptEnvelope`.
- Provider adapters render the envelope into Codex/Claude-specific input.
- Add deterministic snapshot tests for chat/task/cron envelope rendering.

### P2: Router Prompt And Execution Prompt Are Separate Worlds

The Smart Router classifier sees a cropped user message and attachment flag. It does not see reply parent, recent history, cwd, channel purpose, or provider/task context that later affects execution.

Fix direction:

- Feed the router a small, safe route context: reply-parent summary, channel purpose, route cwd, attachment manifest.
- Continue to keep router model client tool-less and non-workspace.
- Log route decision component hashes and final execution route.

## Recommended Next Iteration

### Slice 1: Prompt Audit Envelope

Add a provider-neutral prompt envelope type:

```ts
type PromptComponent = {
  id: string;
  role: "identity" | "system_policy" | "memory" | "supervisor" | "source" | "history" | "provider_context" | "attachment_manifest" | "user_task";
  trust: "trusted" | "user-maintained" | "untrusted";
  priority: "required" | "high" | "medium" | "low";
  text: string;
  charCount: number;
  hash: string;
  redactedPreview: string;
};
```

Deliverables:

- `buildChatEnvelope()`
- `buildTaskEnvelope()`
- `buildCronTaskEnvelope()`
- `renderCodexInput(envelope)`
- `renderClaudeChatInput(envelope)`
- `renderClaudeTaskInput(envelope)`
- Tests for the three real-case shapes in this report.

### Slice 2: Context Budget Manager

Add a single budget pass before rendering:

- Required: current user task, route identity.
- High: direct source/reply context, provider summary.
- Medium: relevant memory, recent chat if referenced.
- Low: supervisor, raw provider rows, attachment previews.

The budget manager should output:

- included component list;
- omitted component list;
- truncation reason;
- estimated token count;
- prompt hash.

### Slice 3: Safe Untrusted Renderer

Replace all ad hoc context wrappers with one renderer:

- `renderUntrustedJsonBlock(tag, value)`
- `renderUntrustedTextBlock(tag, text)`
- `renderAttachmentManifest(attachments)`
- consistent escaping for XML-like tags and code fences.

Apply it to:

- chat history;
- Smart Router recent chat;
- cron pre-script output;
- cron pre-provider output;
- attachment inline text.

### Slice 4: Provider LLM Context Contract

Add a provider framework field:

```ts
interface ProviderRunResult {
  text: string;          // backward compatibility
  llmContext?: string;   // compact prompt-ready context
  rawArtifactPath?: string;
  redactedPreview?: string;
}
```

Then migrate the highest-cost cron providers first:

1. `stock-pulse`
2. `stock-watchlist-research`
3. `market-intel`
4. `cmb-credit-card-email`

### Slice 5: Prompt Audit Storage

Add a safe audit table or task event payload:

- task id;
- route;
- provider;
- rendered prompt hash;
- component hashes;
- char counts;
- redacted previews;
- whether full provider payload was persisted;
- final input token usage when available.

Do not store full raw prompt by default.

## Verification Plan

Minimum verification for the next iteration:

- Prompt unit tests:
  - chat prompt envelope with Discord source, reply parent, history.
  - task prompt envelope with source, reply parent, user task.
  - cron prompt envelope with provider context and large payload truncation.
- Snapshot tests:
  - update existing prompt snapshot only after reviewing semantic diff.
- Security tests:
  - context containing `</user_task>`, triple backticks, and fake system instructions remains inert.
- Storage tests:
  - cron task no longer stores full provider payload in `tasks.prompt`.
  - prompt audit stores hashes/previews/counts only.
- Regression tests:
  - `pnpm vitest run src/__tests__/prompt-snapshot.test.ts src/routing/__tests__/task-context.test.ts src/routing/__tests__/context.test.ts src/cron/__tests__/runner-task.test.ts`
  - `pnpm run typecheck`
  - `pnpm run quality:docs`
