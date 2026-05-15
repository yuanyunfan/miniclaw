---
doc_id: agent-prompt-context-audit
lang: zh
translation_of: docs/archive/features/19-agent-prompt-context-audit.md
translation_status: not_required
---

# Agent Prompt 与上下文注入审计

状态：当前实现审计
日期：2026-05-13

## 结论

MiniClaw 并不是把 Discord 里的用户原始文本直接转发给 Codex 或 Claude Code。它会根据入口和 provider，把用户消息包装成多层 prompt：identity、长期 memory、可选 supervisor、多种 Discord source metadata、reply parent、最近 chat history、附件、cron pre-context、provider 输出，以及当前用户任务。

不同路径的实际输入形态不一样：

- Codex chat / task：收到一个扁平化的 `UserInput` 文本块，外加可选 Codex attachment inputs。
- Claude chat：走 Anthropic Messages API，收到 `system` 和 `messages[]` content blocks。
- Claude task：走 Claude Agent SDK `query()`，使用 `systemPrompt.preset = "claude_code"`，并通过 `append` 注入 MiniClaw identity / supervisor / memory。
- Cron `type=task`：先渲染 `[cron:<job>]` 包装和可选 pre-provider / pre-script 数据块，再进入和 Discord task 相同的 task runner。

当前设计能工作，但上下文管理已经偏分散。主要问题是：

- cron / provider prompt 容易膨胀。
- trusted / untrusted 上下文渲染不一致。
- cron full prompt 被持久化，存在隐私和数据最小化风险。
- task 永久注入 memory 和 supervisor，窄任务也会带上不必要上下文。
- prompt 逻辑散落在多处，难以回答“真正传给 agent 的 prompt 是什么”。

## 范围与证据

本审计基于当前 repo 代码，以及本机 `~/.miniclaw/config.yaml`、`~/.miniclaw/data.db` 中的脱敏运行证据。

关键代码证据：

- `src/agent/chat.ts`：chat history、memory、Codex chat prompt、Claude chat messages。
- `src/agent/runners/codex-task-runner.ts`：Codex task prompt 组装。
- `src/agent/runners/claude-task-runner.ts`：Claude Agent SDK task options。
- `src/routing/task-context.ts`：Discord task source / reply context envelope。
- `src/routing/chat-context.ts`：Discord chat runtime context。
- `src/routing/context.ts`：Smart Router recent chat injection。
- `src/cron/runner-task.ts`：cron pre-script / pre-provider 渲染和 task 执行。
- `prompts/templates/*.md`：cron prompt 模板。
- `prompts/supervisor.md`：task supervisor block。

本机运行证据：

- 默认 agent provider / runtime 是 Codex。
- Codex chat sandbox 是 `read-only`；Codex task sandbox 继承本机 Codex 配置。
- Smart Router 已开启，默认模式是 `confirm`，confirm channels 是通配，auto-task channels 为空。
- `buildMemoryPrompt()` 当前渲染约 4.1k 字符；原始 MiniClaw memory 文件约 8.6 KB。
- `buildSupervisorBlock()` 当前渲染约 1.6k 字符。
- 一次真实 `us-stock-hourly-pulse` cron run 渲染出约 31.6k 字符的 task prompt，其中 pre-provider context 约 29.9k 字符；Codex turn 记录约 61.7k input tokens、3.9k output tokens、2.9k reasoning tokens、10 个 tool events，总耗时约 91 秒。

敏感运行细节，例如 channel id、user id、邮箱凭据、cookie/session 数据、完整私有持仓 payload，本文档均不写入。

## Prompt 入口

### Chat 路径

Discord chat handler 在调用 agent 前会做四件事：

1. 去掉 bot mention；如果只有附件没有文本，补默认 prompt。
2. Smart Router 开启时先做 route decision。
3. 把附件处理成 Anthropic content blocks 和 Codex input entries。
4. 从 Discord source metadata 和可选 reply parent 构造 runtime context。

对应代码流：

- `src/bot/message-chat.ts:75-160`：chat 前 Smart Router decision。
- `src/bot/message-chat.ts:172-180`：构造 `chatRuntimeContext`。
- `src/agent/chat.ts:77-82`：构造 `system = identity + memory`。
- `src/agent/chat.ts:108-115`：Claude chat 的 user content 顺序。
- `src/agent/chat.ts:284-290`：Codex chat 的扁平 prompt 顺序。

### Task 路径

Discord task 创建时，先用 source metadata 和可选 reply parent 构造执行 prompt：

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

对应代码流：

- `src/discord/task-intake.ts:80-87`：创建 thread 并构造 `executionPrompt`。
- `src/discord/task-intake.ts:88-100`：持久化 display prompt 和 context metadata，不持久化完整 execution prompt。
- `src/discord/task-intake.ts:138-145`：把 `executionPrompt` 传给 `executeTask`。
- `src/bot/message-thread-continuation.ts:81-84`：thread follow-up 使用同样的 context envelope，并 resume provider session。

### Cron Task 路径

Cron `type=task` 不是从 Discord message metadata 开始。它先渲染：

```text
[cron:<job_name>]

<optional pre_script or pre_provider block>

<job.prompt rendered with {{date}}, {{time}}, {{cron.name}}, ...>
```

对应代码流：

- `src/cron/runner-task.ts:102-119`：pre-script / pre-provider / task prompt builders。
- `src/cron/runner-task.ts:336-384`：运行 pre-script 或 pre-provider，并把输出拼到 prompt 顶部。
- `src/cron/runner-task.ts:422-424`：渲染最终 cron task prompt。
- `src/cron/runner-task.ts:427-436`：把完整 cron prompt 写入 `tasks.prompt`。
- `src/cron/runner-task.ts:457-460`：把 cron prompt 传给 `executeTask`。

## Codex 实际收到什么

### Codex Chat

当前代码用 chat mode 启动 Codex thread：

```ts
codex.startThread(codexThreadOptions("chat", config.defaultCwd))
```

随后发送一个扁平化 prompt：

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

关键点：

- 实际通过 `codexInput(fullPrompt, attachmentCodexInputs)` 传入。
- 如果有附件，Codex 收到的是数组：`{ type: "text", text: fullPrompt }` 加本地图片/文本附件 entries。
- `codexThreadOptions("chat", ...)` 会应用 chat sandbox、approval policy、reasoning effort、model、web search mode、network access 和 working directory。
- 当前本机配置中，chat sandbox 是 `read-only`。

### Codex Task

Codex task 使用另一套 wrapper：

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

对 cron 来说，`<user_task>` 里的内容就是 `[cron:<job>]`、provider/script 数据块，以及 cron prompt。

关键点：

- Codex task wrapper 总是把 identity、supervisor、memory 放在 task 前面。
- `formatTaskPromptForSystem()` 会避免已经结构化的 task prompt 被重复包一层。
- 附件会作为 Codex SDK input entries 追加。
- `codexThreadOptions("task", input.cwd)` 设置 task working directory 和 task sandbox。

## Claude Code 实际收到什么

### Claude Chat

Claude chat 走 Anthropic Messages API，不走 Claude Agent SDK。MiniClaw 发送的是：

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

本地 chat tools 是只读/调研导向：

- `read_file(path)`：必须是绝对路径，1 MB 上限。
- `bash(command)`：只读命令策略，有输出上限。
- `web_fetch(url)`：只抓公开 HTTP(S)，阻止 private hosts。

### Claude Task

Claude task 使用 `@anthropic-ai/claude-agent-sdk`：

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

关键点：

- Claude Code 把 MiniClaw identity / supervisor / memory 作为 `systemPrompt.append`，其语义层级高于普通 user text。
- 用户任务、source/reply context、cron context 仍在 `prompt` 里。
- 附件会放在用户 content message 的文本 prompt 前。
- `canUseTool` 会阻止 `Skill triad`、限制每个 role 的 subagent 重复调用次数，并拒绝明显破坏性的 Bash 命令。

## MiniClaw 会注入哪些上下文

### 总是或通常注入

- Identity：
  - Chat identity 包含只读工具和能力限制。
  - Task identity 更短，偏 provider-neutral。
- 长期 memory：
  - 来自 MiniClaw memory store。
  - 包在 `<memory_context trust="user-maintained-background">` 中。
  - 当前默认 cap 是 4,000 字符 memory lines，加 wrapper 文本。
- Supervisor block：
  - task 路径中只要存在 subagents 就注入。
  - 描述 researcher、code-investigator、planner、generator、evaluator。
- 当前 prompt：
  - chat 用 `<user_message>`。
  - task 用 `<user_task>` 或已经结构化的 task prompt。

### 路径特定上下文

- Discord source metadata：
  - route type、guild/channel/message ids、channel/thread names、author metadata、message URL、timestamp、cwd、附件摘要。
  - 渲染为 untrusted JSON，并转义 `<`、`>`、反引号。
- Reply parent context：
  - 用户 reply 另一条 Discord 消息时注入。
  - parent message content capped at 4,000 chars。
- Recent chat context：
  - chat 路径总是注入当前 channel 最近最多 15 个 user/assistant turns。
  - Smart Router task 路径只有在当前 prompt 明确引用前文时才注入 recent chat。
- 附件：
  - 图片变成 Anthropic image blocks 和 Codex local images。
  - 小文本文件内联。
  - 大文本/PDF/binary 保存到 `.miniclaw-attachments/<task_id>`，prompt 里描述路径。
  - 音频尽量先转写。
- Cron pre-context：
  - `pre_script` stdout 作为 code-fenced block 拼到顶部。
  - `pre_provider` output 作为 code-fenced JSON block 拼到顶部。
  - 两者各自有 50,000 字符 cap。

## 真实案例 1：Chat

运行证据：

- 时间：2026-05-13 15:03 UTC。
- 用户 prompt：`这是为什么？`
- Smart Router decision：`chat`，confidence `0.3`，ambiguity high。
- 本机默认 provider：Codex。
- 最近 chat 中有一条 assistant 解释 watchlist stock task 为什么 skipped。

MiniClaw 很可能传给 Codex 的结构：

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

分析：

- 优点：chat 保持只读，同时带 recent history，所以能回答“这是为什么？”这种模糊追问。
- 问题：chat history 当前总是注入，不只在用户引用前文时注入。这会把 stale channel chatter 带入上下文。
- 问题：`buildHistoryContext()` 直接把原始消息包进 XML-like tags，没有转义 `</message>` / `</conversation_history>` 这类 delimiter。
- 问题：router 在 high ambiguity 下仍判为 chat。这个决策本身可以接受，但 chat 的回答质量会高度依赖 recent history 是否准确。

## 真实案例 2：Task

运行证据：

- 时间：2026-05-13 15:21 UTC。
- 用户 prompt：`我现在的eastmoney-jywg/default 正常吗`
- Smart Router decision：`task_confirm`，confidence `0.8`。
- capability reason：需要 runtime inspection。
- 用户确认创建 task。
- task 通过 Codex runtime 完成。
- 用户消息 reply 到一条第三方健康检查告警，因此 reply parent context 被注入。

执行 prompt 形态：

```text
<task_source_metadata trust="untrusted">
{
  "provider": "discord",
  "route_type": "smart_router_confirmed",
  "source_channel_name": "<redacted>",
  "source_message_url": "<redacted>",
  "cwd": "~/ProjectRepo",
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

随后 Codex task 会在这段 execution prompt 前面再加 identity、supervisor、memory 和 Codex task instruction。

分析：

- 优点：reply parent 直接给了 health alert 上下文，agent 不需要猜用户在问哪个异常。
- 优点：task context JSON 会转义 `<`、`>` 和反引号，降低 delimiter injection 风险。
- 优点：Discord task row 只持久化 display prompt；更丰富的 execution prompt 可由 source/parent JSON 重建。
- 问题：窄任务也会注入 identity、supervisor 和 memory。单是 supervisor block 就约 1.6k 字符，且可能鼓励不必要的 subagent 编排。
- 问题：MiniClaw 没有为 Discord task 存 component-level prompt audit。当前只存 display prompt 和 context metadata，不记录真正传给 Codex/Claude 的 rendered prompt hash、char count、组件列表。

## 真实案例 3：Cron Task

运行证据：

- Job：`us-stock-hourly-pulse`。
- 时间：2026-05-13 15:30 UTC。
- 类型：`task`。
- Pre-provider：`stock-pulse`。
- Provider status：ok。
- Task provider：Codex。
- 最终持久化 prompt 长度：约 31.6k 字符。
- `prepended_context_chars`：约 29.9k。
- Codex usage：约 61.7k input tokens、3.9k output tokens、2.9k reasoning tokens。
- Tool events：10 个，主要是为了补查 benchmark index data 的 web search。
- Duration：约 91 秒。

Cron prompt 形态：

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

分析：

- 优点：provider 在 LLM 调用前完成 market/session 判断，LLM 不需要猜原始事实。
- 优点：prompt 明确要求不要编造 alerts，也不要主动给交易指令。
- 问题：provider data 占据 prompt 主体。LLM 同时看到完整 `positions[]` 和 `position_groups`，大量字段重复。
- 问题：私有持仓明细和 P&L 会被持久化到 `tasks.prompt`。这方便 debug，但不符合数据最小化。
- 问题：prompt 要求 LLM 对缺失 benchmark 数据联网补查。真实运行里因此触发了 10 个 tool events。benchmark 完整性更应该由 provider 保证，而不是交给 LLM fallback。
- 问题：pre-provider / pre-script 输出被放进 Markdown code fence，但没有统一 escape fence delimiter，也没有把内容作为 untrusted JSON value 建模。provider/script 输出一旦包含 code fence，就可能打破 prompt 边界。
- 问题：50k 字符 cap 太粗。它按尾部截断，不按语义优先级截断，也没有给模型结构化说明“哪些数据被省略”。

## Codex 与 Claude Code 的差异

### Priority 层级不同

Claude task 把 MiniClaw identity / supervisor / memory 放到 `systemPrompt.append`，叠加在 `claude_code` preset 上。Codex task 则把同样内容放进 `thread.runStreamed()` 的文本 prompt。

这意味着同一套 MiniClaw 指令在不同 provider 里语义层级不同：

- Claude Code：更接近 system append。
- Codex：更接近 user input payload 的一部分。

当前代码缺少 provider-neutral `PromptEnvelope`，无法统一表达 component role、trust level、priority 和 budget，再由不同 provider adapter 渲染。

### Tool surface 不同

Claude chat 用 MiniClaw 自定义 `CHAT_TOOLS`。Codex chat 用 Codex SDK capabilities，并由 thread options 限制。Chat identity 会告诉模型 MiniClaw 的只读工具边界，但 Codex SDK 的实际工具面并不等同于 `CHAT_TOOLS` schema。

### 持久化策略不同

Discord task row 存 display prompt + source/parent JSON。Cron task row 存完整 rendered prompt，包含 provider output。

这造成一个明显不一致：

- Discord task 更安全，但难以精确 audit。
- Cron task 更容易复现，但可能存太多私有数据。

## 需要修的问题

### P0：cron full prompt 持久化泄露过多上下文

`src/cron/runner-task.ts` 会把完整 rendered cron prompt 写入 `tasks.prompt`。provider-heavy job 可能包含私有持仓、P&L、邮箱诊断和其他敏感派生数据。

修复方向：

- 默认只持久化 display prompt 或 prompt hash。
- 存 component-level metadata：component type、char count、hash、redacted preview。
- 原始 provider payload 只放在 provider-specific artifact path，并明确 redaction / retention policy；或者默认不持久化。

### P0：untrusted context escaping 不完整

Task source/reply JSON 当前处理较好，但 chat history 和 Smart Router recent chat context 会把原始消息直接嵌入 XML-like tags。Cron pre-script / pre-provider output 则直接嵌进 Markdown code fence。

修复方向：

- 所有 untrusted context 走同一个 safe renderer。
- 统一 escape `<`、`>`、反引号和 code-fence delimiter。
- 优先把内容 JSON-string encoded 后放入可信 wrapper，而不是 raw Markdown fence。

### P1：prompt budget 没有按组件优先级管理

当前 cap 都是局部常量：

- memory：按插入顺序约 4k chars。
- chat history：固定 recent turns。
- Smart Router recent context：固定 max chars。
- cron pre-context：50k chars。
- attachments：小文本最多内联 1 MB。

系统缺少全局 context budget manager 来保证：

1. identity 和 current task 永远优先；
2. 直接 source/reply context 高优先级；
3. recent history 只在相关时注入；
4. provider summary 优先于 raw rows；
5. memory 只注入相关部分。

修复方向：

- 引入 component budgets 和 priority ordering。
- 记录每个 component 的 char/token estimate。
- 为 chat、task、cron、resume 设置 route-specific defaults。

### P1：supervisor 和 memory 在 task 中 always-on

窄任务不需要完整 supervisor，也不一定需要 broad memory。比如“检查某个 provider 是否正常”，并不需要 multi-agent 编排提示。

修复方向：

- 根据 task capability flag 控制 supervisor 注入，例如 `allow_subagents` 或 `expected_complexity >= medium`。
- Memory retrieval 改成按 project/channel/route keyword scoped retrieval，而不是按原始插入顺序全塞。
- 增加 stale/duplicate memory cleanup，以及 per-memory last-used metadata。

### P1：provider payload 需要 schema-aware compaction

Stock/provider payload 往往同时包含 raw rows 和 derived grouped rows。这个对确定性报告有用，但把两份都完整发给 LLM 很浪费。

修复方向：

- 要求每个 provider 暴露 compact `llm_context`：
  - run summary；
  - top alerts；
  - 已按 prompt 需要裁剪字段的 grouped report rows；
  - failures/warnings；
  - raw artifact path/hash。
- 普通 prompt 不再带完整 raw payload。
- 对 `stock-pulse`，把 required benchmark indices 补齐放到 provider 输出里，移除常规 LLM web fallback。

### P1：prompt rendering 分散在太多模块

当前 prompt 逻辑分散在：

- `src/agent/chat.ts`
- `src/agent/runners/codex-task-runner.ts`
- `src/agent/runners/claude-task-runner.ts`
- `src/routing/task-context.ts`
- `src/routing/context.ts`
- `src/routing/chat-context.ts`
- `src/cron/runner-task.ts`
- `prompts/templates/*.md`

结果是，每次要回答“真正传给 agent 的 prompt 是什么”，都要读多条路径和 provider 分支。

修复方向：

- 新增 `src/prompt/envelope.ts`。
- 所有 route 先构造 typed `PromptEnvelope`。
- Provider adapters 再把 envelope 渲染成 Codex / Claude-specific input。
- 为 chat/task/cron envelope rendering 加 deterministic snapshot tests。

### P2：router prompt 和 execution prompt 脱节

Smart Router classifier 只看裁剪后的用户消息和 attachment flag。它看不到 reply parent、recent history、cwd、channel purpose 或后续执行会用到的 provider/task context。

修复方向：

- 给 router 一个很小且安全的 route context：reply-parent summary、channel purpose、route cwd、attachment manifest。
- router model client 继续保持 tool-less / non-workspace。
- 记录 route decision component hashes 和最终 execution route。

## 推荐下一步迭代

### Slice 1：Prompt Audit Envelope

新增 provider-neutral prompt envelope type：

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

交付物：

- `buildChatEnvelope()`
- `buildTaskEnvelope()`
- `buildCronTaskEnvelope()`
- `renderCodexInput(envelope)`
- `renderClaudeChatInput(envelope)`
- `renderClaudeTaskInput(envelope)`
- 覆盖本文三个真实案例形态的测试。

### Slice 2：Context Budget Manager

在渲染前统一做预算：

- Required：当前用户任务、route identity。
- High：直接 source/reply context、provider summary。
- Medium：相关 memory、用户明确引用时的 recent chat。
- Low：supervisor、raw provider rows、attachment previews。

Budget manager 输出：

- included components；
- omitted components；
- truncation reason；
- estimated token count；
- prompt hash。

### Slice 3：Safe Untrusted Renderer

用一个 renderer 替换所有 ad hoc wrapper：

- `renderUntrustedJsonBlock(tag, value)`
- `renderUntrustedTextBlock(tag, text)`
- `renderAttachmentManifest(attachments)`
- 统一处理 XML-like tags 和 code fences escaping。

应用到：

- chat history；
- Smart Router recent chat；
- cron pre-script output；
- cron pre-provider output；
- attachment inline text。

### Slice 4：Provider LLM Context Contract

在 provider framework 中加入：

```ts
interface ProviderRunResult {
  text: string;          // backward compatibility
  llmContext?: string;   // compact prompt-ready context
  rawArtifactPath?: string;
  redactedPreview?: string;
}
```

优先迁移高成本 cron providers：

1. `stock-pulse`
2. `stock-watchlist-research`
3. `market-intel`
4. `cmb-credit-card-email`

### Slice 5：Prompt Audit Storage

新增安全 audit table 或 task event payload：

- task id；
- route；
- provider；
- rendered prompt hash；
- component hashes；
- char counts；
- redacted previews；
- 是否持久化 full provider payload；
- provider 可用时记录最终 input token usage。

默认不存 full raw prompt。

## 验证计划

下一步迭代至少需要：

- Prompt unit tests：
  - chat envelope：Discord source、reply parent、history。
  - task envelope：source、reply parent、user task。
  - cron envelope：provider context 和大 payload truncation。
- Snapshot tests：
  - 只有确认语义 diff 后才更新现有 prompt snapshot。
- Security tests：
  - 包含 `</user_task>`、三反引号、fake system instructions 的上下文仍保持 inert。
- Storage tests：
  - cron task 不再把完整 provider payload 存到 `tasks.prompt`。
  - prompt audit 只存 hash / preview / count。
- Regression tests：
  - `pnpm vitest run src/__tests__/prompt-snapshot.test.ts src/routing/__tests__/task-context.test.ts src/routing/__tests__/context.test.ts src/cron/__tests__/runner-task.test.ts`
  - `pnpm run typecheck`
  - `pnpm run quality:docs`
