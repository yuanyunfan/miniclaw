# MiniClaw Chat Router Current Logic

> Snapshot: 2026-05-11.
> This document describes the code path that currently decides whether an inbound Discord message is ignored, handled as chat, converted into a task, or resumed in an existing task thread.

## Conclusion

MiniClaw 的 chat router 不是一个单点判断，而是两层路由：

1. `src/routing/message-route.ts` 先做硬分流：`ignore`、`thread_continuation`、`task_channel`、`chat`。
2. 只有已经进入 `chat` 的消息，才会在 `src/routing/intent.ts` 里走 smart router，把自然语言请求进一步判成 `chat`、`task_suggest`、`task_confirm` 或 `task_auto`。

当前默认倾向是 LLM-first 但权限保守：自然语言语义不再靠 `TASK_SIGNALS` / `CHAT_SIGNALS` 之类 regex 判断，而是由 LLM capability classifier 判断需要哪些能力；本地 policy 再把写文件、运行命令、Git、运行态排查、持久化输出映射成 `task_confirm`，把浏览器、当前信息、多步研究、长任务、URL-only 映射成 `task_suggest`。LLM 不可用时只使用 URL、附件、空消息等客观事实，避免 regex 漏判继续扩大。

## 路由流程图

```mermaid
flowchart TD
    A["Discord 新消息"] --> B{"作者是否允许？"}
    B -->|否| X0["忽略"]
    B -->|是| C{"是否为可续话任务线程？<br/>有 session 且不是 cron"}

    C -->|是| T0["任务线程续话"]
    T0 --> T1["新建 task 记录"]
    T1 --> T2["执行任务<br/>续接原 session"]

    C -->|否| D{"频道是否在<br/>taskChannelIds？"}
    D -->|是| K0["任务频道消息"]
    K0 --> K1["消息去重"]
    K1 --> K2["解析工作目录<br/>处理附件"]
    K2 --> K3["创建任务线程"]
    K3 --> K4["执行任务"]

    D -->|否| E{"自动回复频道<br/>或明确 mention bot？"}
    E -->|否| X1["忽略"]
    E -->|是| F["进入 chat 候选"]

    F --> G{"正文为空<br/>且没有附件？"}
    G -->|是| G1["回复问候语"]
    G -->|否| H{"显式记忆指令？"}
    H -->|是| H1["写入记忆<br/>回复成功"]
    H -->|否| I{"smartRouter<br/>是否启用？"}

    I -->|否| C0["chat 路径"]
    I -->|是| J["客观事实提取<br/>URL / 附件 / 空消息"]
    J --> L{"LLM 能力分类器<br/>是否启用且可调用？"}
    L -->|是| L1["LLM 判断能力需求<br/>输出 capability JSON"]
    L -->|否| M["仅使用客观事实<br/>标记 classifier fallback"]
    L1 --> N["能力映射为路由意图"]
    M --> N

    N --> O{"能力意图"}
    O -->|高风险<br/>写文件/命令/Git/运行态/持久化| P["强建议转 task"]
    O -->|软任务<br/>浏览器/当前信息/研究/纯 URL| Q["可能更适合 task"]
    O -->|无任务能力<br/>或轻量问答| C0

    P --> R["结合频道策略<br/>决定最终动作"]
    Q --> R
    R --> S{"是否为自动 task 频道<br/>且置信度足够？"}
    S -->|是| A0["自动 task"]
    A0 --> A1["创建任务线程<br/>执行任务"]
    S -->|否| U{"当前频道或 mention<br/>是否允许确认？"}
    U -->|否| C0
    U -->|是| V["显示确认按钮<br/>转 task / 继续 chat / 取消"]
    V -->|转 task| V1["确认创建 task<br/>创建线程并执行"]
    V -->|继续 chat| C0
    V -->|取消| V2["取消处理"]

    C0 --> C1["处理附件"]
    C1 --> C2["构造 chat 运行上下文"]
    C2 --> C3["执行 chat"]
    C3 --> C4{"Agent provider"}
    C4 -->|Codex| C5["只读 Codex thread"]
    C4 -->|Claude| C6["messages.stream<br/>chat 工具循环"]
    C5 --> C7["分块回复<br/>标记成功或失败"]
    C6 --> C7
```

## Code Map

- `src/bot.ts`: Discord `MessageCreate` / button interaction 的主编排。
- `src/routing/message-route.ts`: 外层 message route，决定是否进入 thread continuation、task channel、chat 或 ignore。
- `src/routing/intent.ts`: smart router 的客观事实提取、LLM capability 到 route intent 的映射、频道策略。
- `src/routing/llm.ts`: 可选 LLM capability classifier，只判断能力需求，不直接决定最终 route。
- `src/routing/confirmations.ts`: smart router 按钮确认的 10 分钟内存态。
- `src/discord/task-intake.ts`: task 创建、thread 创建、DB 写入、`executeTask()` 启动。
- `src/agent/chat.ts`: 真正执行 chat 的 Claude / Codex 分支。
- `src/routing/context.ts`, `src/routing/task-context.ts`, `src/routing/chat-context.ts`: recent chat、source metadata、reply parent context 注入。

## Layer 1: Discord Message Route

入口在 `src/bot.ts` 的 `Events.MessageCreate`。第一层 route 由 `resolveDiscordMessageRoute()` 计算，优先级固定如下。

### 1. Author Gate

先判断作者是否允许：

- 普通运行态：只允许 `config.allowedUserId`，bot 自己或其他用户直接 `ignore`。
- E2E mode：允许 `config.e2e.senderUserIds`，其中 bot author 也只在 E2E mode 下允许。

实现点：`src/e2e/safety.ts:isAllowedDiscordMessageAuthor()`。

### 2. Thread Continuation

满足以下条件时返回 `thread_continuation`：

- 当前 Discord channel 是 thread。
- `getTaskByThreadId(channel.id)` 能找到 task。
- 找到的 task 有 `session_id`。
- `discord_user_id !== "cron"`，避免 cron 产生的记录被误当成用户续话。

命中后，MiniClaw 会：

- 加 `🔄` reaction。
- 新建一个 task row。
- 构造 source metadata 和 reply parent context。
- 调 `executeTask({ resumeSessionId: continuableTask.session_id })` 续上原 session。

这个路径优先于 task channel 和 chat channel。

### 3. Task Channel

如果当前 channel 在 `config.taskChannelIds` 中，返回 `task_channel`。

命中后普通消息直接变成 task：

- 去重 `message.id`。
- 移除 bot mention 后取正文；只有附件时 prompt 用 `请处理这些附件`。
- 检查 `maxConcurrentTasks`。
- 按 channel default 或 default cwd 解析工作目录。
- `message.startThread()` 创建 task thread。
- `createAndRunDiscordTask()` 写 DB、发 status embed、启动 `executeTask()`。

如果一个 channel 同时在 task channel 和 auto-reply channel 中，task channel 优先。

### 4. Chat Eligible

如果未命中前两类，满足任一条件时返回 `chat`：

- `config.autoReplyChannelIds` 包含 `*`。
- `config.autoReplyChannelIds` 包含当前 channel id。
- 消息明确 mention 了 bot。

否则返回 `ignore`。

当前本机运行配置的关键点是：`auto_reply_channels` 是 wildcard，smart router enabled，`confirm_channels` 也是 wildcard，`auto_task_channels` 为空。因此绝大多数允许用户发出的普通 channel 消息都会先进入 chat eligible，再由 smart router 判断是否弹 task 按钮；不会自动创建 task，除非以后配置 auto-task channel。

## Layer 2: Chat Entry Prechecks

进入 `chat` route 后，`src/bot.ts` 继续做本地短路判断：

1. 对 `message.id` 做内存去重。Map 上限 500 条，旧记录按 5 分钟窗口清理。
2. 移除 bot mention，得到 `content`。
3. 收集附件，但此时尚未解析附件内容；smart router 只知道 `hasAttachments`。
4. 如果没有正文也没有附件，直接回复问候语并 return。
5. 如果命中显式记忆指令，调用 `parseExplicitMemory()` 和 `addMemory()`，直接写 memory 并 return。
6. 如果 `config.smartRouter.enabled`，进入 smart router。
7. 如果 smart router 最终决定继续 chat，才解析附件、加 `👀` reaction、发 typing、构造 chat runtime context、调用 `chat()`。

注意：附件内容不会参与 smart router 的文本分类。router 只拿到当前消息正文和 `hasAttachments` 布尔值。

## Smart Router: Capability Classification

`classifySmartRoute()` 现在是 LLM-first。它不再用任务/聊天/模糊三组语义 regex 先判 intent，而是先提取少量客观事实，再尽可能调用 LLM capability classifier。

### Objective Facts

`classifyMessageCapabilities()` 只做不依赖自然语言语义的事实提取：

- 是否为空消息：`empty_message`。
- 是否有 Discord 附件：`attachments` / `hasAttachments`。
- 是否含外部 URL：`external_url` / `hasExternalUrl`。
- 是否只有 URL 或“链接: URL”这类结构文本：`url_only` / `isUrlOnly`。

它不会再判断“修改”“加个”“排序”“解释”“总结”“调研”等语义，也不会把这些词映射成 `needsFileWrite`、`needsShell` 或 `needsMultiStepResearch`。这些判断交给 LLM。

### LLM Capability Classifier

LLM classifier 在 `src/routing/llm.ts`，只输出 capability JSON，不回答用户问题，也不直接决定最终 route。

调用条件：

- `policy.enabled === true`。
- `policy.llmClassifier.enabled === true`。
- 当前消息不是“空正文且无附件”。
- 运行时传入了 classifier 实现。

`only_when_ambiguous` 字段为了配置兼容仍然存在，但当前 LLM-first 逻辑不再用它限制调用范围。只要消息已经进入 chat eligible 且非空，LLM classifier 都会被调用。

classifier prompt 的边界：

- 不允许回答用户问题。
- 不允许浏览、抓 URL、读文件、跑命令。
- 只判断如果 MiniClaw 要处理这条消息，需要哪些能力。
- 明确要求不要做关键词匹配，要从完整自然语言推断真实意图。
- 内置了两个真实样例：
  - `steipete的1099 次贡献...` 应输出 `needs_current_info=true`、`needs_multi_step_research=true`。
  - `stock-pulse中的当前持仓盘中快照 ... 加个 ... 排序` 应输出 `needs_file_write=true`。

Codex provider 下的 classifier 默认优先使用轻量 OpenAI-compatible `chat/completions` API：

- `routing.smart_router.llm_classifier.provider: auto` 时，如果配置了 `OPENAI_API_KEY`，走 OpenAI 风格 API；如果只配置了 `OPENAI_BASE_URL`，走 OpenAI-compatible API；两者都没有时回退到 Codex thread。
- `provider: openai` 强制要求 `OPENAI_API_KEY`。
- `provider: openai_compatible` 强制要求 `OPENAI_BASE_URL`，如同时配置 `OPENAI_API_KEY` 会带上 Bearer Authorization。
- `provider: codex` 强制使用原来的 read-only Codex thread。
- `model` 默认 `gpt-4o-mini`，`timeout_ms` 默认 8000。
- `fallback_to_codex: true` 时，轻量 API 调用失败会回退到 read-only Codex thread；设为 `false` 时直接把 classifier 失败暴露给 smart router fallback。

Codex thread fallback 仍关闭 web search 和 network，最多 30 秒超时。Claude provider 下仍使用 Anthropic messages API，temperature 0。

### Classifier Failure Fallback

LLM 失败不会阻断消息：

- classifier 抛错：`riskFlags` 增加 `classifier_failed`。
- classifier 没有传入：`riskFlags` 增加 `classifier_unavailable`。
- 继续使用客观事实能力，例如 URL-only 仍会 `task_suggest`。
- 纯自然语言语义不会再靠 fallback regex 补判；例如“加个/排序/修一下”在 classifier 失败时不会被本地 regex 升级为 task。

### Capability To Intent

`resolveCapabilitiesToRouteDecision()` 将能力映射为 route intent。

高风险能力直接变 `task_confirm`：

- `needsFileWrite`
- `needsShell`
- `needsGit`
- `needsRuntimeInspection`
- `createsPersistentOutput`

软 task 能力变 `task_suggest`：

- `needsBrowser`
- `needsCurrentInfo`
- `needsMultiStepResearch`
- `needsLongRunning`
- `isUrlOnly`

其他情况保持 `chat`。

这里的关键边界是：LLM 只给 capability，本地代码决定权限。`needsCurrentInfo`、`needsMultiStepResearch`、`needsBrowser`、`needsLongRunning` 不算高风险，所以只会 suggestion；写文件、命令、Git、运行态、持久化输出才会 confirmation。

## Final Action Policy

`resolveSmartRouterAction()` 负责把 `task_suggest` / `task_confirm` 变成最终动作。

### Smart Router Disabled

如果 `policy.enabled === false`，所有 smart router decision 都被改回 `chat`。

### Chat / Ignore

如果 intent 已经是 `chat` 或 `ignore`，直接保持，不再按频道提升。

### Auto Task

只有满足全部条件才会自动创建 task：

- 当前 channel 在 `policy.autoTaskChannelIds`。
- confidence >= `policy.minAutoConfidence`。
- intent 是 `task_auto`，或 `defaultMode === "auto"`，或 intent 是 `task_confirm`。

当前本机 `auto_task_channels` 为空，因此不会自动创建 task。

### Confirmation Allowed

如果不是 auto task，需要看当前 channel 是否允许展示确认按钮：

- 消息 mention 了 bot：允许。
- `confirmChannelIds` 为空：允许所有 eligible chat channel。
- `confirmChannelIds` 包含 `*`：允许所有 eligible chat channel。
- `confirmChannelIds` 包含当前 channel id：允许。

不允许时，decision 会降回 `chat`，reason 追加 `channel is not configured for smart-router confirmation`。

### Confirm Or Suggest

允许 confirmation 后：

- `task_confirm` 保持 `task_confirm`，展示“转为 task / 继续 chat / 取消”按钮。
- `task_suggest` 保持 `task_suggest`，也展示同一组按钮，但文案更弱：可能更适合 task。
- 旧路径里只有没有 capabilities 的 decision 且 confidence 达标时，才会按 confidence 提升为 `task_confirm`；当前主分类路径都会带 capabilities，因此基本不会走这个提升分支。

## Action Execution Details

### `task_auto`

执行顺序：

1. 写 `smart_router_decisions`，`action_result=auto_task_start`。
2. 回复“已识别为 task，正在创建任务线程...”。
3. 加 `👀` reaction。
4. `createAndRunDiscordTask()` 创建 thread、写 `tasks`、发 status embed、启动 `executeTask()`。
5. 成功后把 decision log 更新为 `auto_task_created` 并写入 `created_task_id`。
6. 失败时更新 `auto_task_failed`，加 `❌` reaction 并回复错误。

### `task_suggest` / `task_confirm`

执行顺序：

1. 写 `smart_router_decisions`，`action_result=confirmation_pending`。
2. 保存 `PendingTaskConfirmation` 到内存 Map，默认 10 分钟过期。
3. Discord 回复按钮：`转为 task`、`继续 chat`、`取消`。

按钮处理：

- custom id 形如 `miniclaw:smart:<action>:<token>`，不携带 prompt。
- 只有原始用户可以操作。
- `cancel`: 更新 log 为 `cancelled`。
- `chat`: 更新 log 为 `continued_chat`，用原 prompt 继续 chat。
- `task`: 创建 task thread，成功后更新 log 为 `confirmed_task_created` 和 `created_task_id`。
- 进程重启后内存确认状态丢失，旧按钮会提示过期或 missing。

### `chat`

执行顺序：

1. 写 `smart_router_decisions`，`action_result=chat`。
2. 如果有附件，解析附件并发送 notice。
3. 加 `👀` reaction，每 8 秒刷新 typing。
4. 构造 `discord_message_context` 和可选 `reply_parent_context`。
5. 调用 `chat()`。
6. 分块 reply，移除 `👀`，加 `✅`。
7. 出错时移除 `👀`，加 `❌`，并回复格式化错误。

Codex chat 的当前实现使用 `codexThreadOptions("chat", config.defaultCwd)` 启动 read-only thread。channel-specific cwd 会进入 runtime context，但不是 Codex chat thread 的 working directory。task 路径才会把 resolved cwd 作为 `executeTask()` 的工作目录。

## Context Injection

smart router 创建 task 时默认只把当前消息作为任务指令。只有 prompt 明确引用最近上下文时，`buildSmartTaskPrompt()` 才会注入 recent chat：

- 触发词包括：刚才、上面、前面、上一条、之前、继续、基于你的分析、按上面、这个方案、you just、above、previous、continue、your plan 等。
- 注入内容包在 `<recent_chat_context trust="untrusted">` 中。
- 当前任务包在 `<user_task priority="current">` 中。

所有 task 路径都会尽量附带 source metadata：

- route type
- guild/channel/message 信息
- message URL
- cwd
- was mentioned
- attachments summary

如果用户是在 Discord reply 某条消息，系统还会捕获 reply parent context，同样以 untrusted context 注入。

## Decision Logging

smart router decision 会写入 SQLite `smart_router_decisions`：

- `message_id`, `channel_id`, `user_id`
- `prompt_hash`
- `prompt_preview`
- `full_prompt`，只有 `store_full_prompt=true` 时写入；当前本机为 false。
- `intent`, `confidence`, `reason`
- `matched_signals`, `risk_flags`
- `capabilities_json`
- `action_result`
- `created_task_id`

这张表是排查“消息 router 到哪里”的主证据。`matched_signals` 字段为历史兼容名；新逻辑里主要存 classifier evidence，例如 `llm_classifier`、`external_url`、`url_only`、`classifier_failed`。运行日志里的 `[bot] route decision ...` 只保留 channel 尾号、intent、confidence 和 evidence 列表；完整 prompt preview 要查 SQLite。

## Current Edge Cases From Real Prompts

### `steipete的1099 次贡献他是如何做到的？你能给我简单拆解一下吗？`

当前 LLM-first 预期输出：

- intent: `task_suggest`
- capabilities: `needsCurrentInfo=true`, `needsMultiStepResearch=true`
- evidence: `llm_classifier`, `current_contribution_activity`

原因：

- 语义判断交给 LLM，不再要求 prompt 包含 GitHub、today、recent、commit、PR 等固定 signal。
- prompt 中的具体人名、异常高贡献数和“如何做到/拆解”足够让 LLM 推断需要当前活动调查。
- 当前信息和多步研究是软 task 能力，所以给 `task_suggest`，不会直接强制执行。

所以它会在允许确认的 chat channel 中展示“转为 task / 继续 chat / 取消”按钮。

### `stock-pulse中的当前持仓盘中快照 ... 加个 总的日内盈亏 ... 按照日内盈亏来排序`

当前 LLM-first 预期输出：

- intent: `task_confirm`
- capabilities: `needsFileWrite=true`
- evidence: `llm_classifier`, `project_change_request`, `intraday_pnl_sorting`

原因：

- LLM 能从 “stock-pulse 中的当前持仓盘中快照” 和 “要加个数值 / 要排序” 推断这是项目展示逻辑变更。
- 不再要求用户说“修改/实现/更新”等固定词。
- `needsFileWrite` 是高风险 task-only capability，所以本地 policy 映射为 `task_confirm`。

所以它会在允许确认的 chat channel 中展示 task 确认按钮；如果处在 trusted auto-task channel 且 confidence 达标，才会自动创建 task。

## Verification Commands

当前逻辑可以用这些命令验证：

```bash
pnpm exec vitest run src/routing/__tests__/intent.test.ts src/routing/__tests__/message-route.test.ts src/routing/__tests__/router-eval.test.ts
```

```bash
sqlite3 ~/.miniclaw/data.db 'select id, message_id, channel_id, intent, confidence, action_result, created_task_id, prompt_preview from smart_router_decisions order by id desc limit 20;'
```

## Practical Implications

- 用户不需要为了 router 写固定触发词；“加个/排序/拆解一下”这类自然语言会由 LLM 判断真实能力需求。
- LLM 只输出 capability，最终是否转 task 仍由本地 policy 决定。
- classifier 失败时不会用旧 regex 补判语义，系统会继续 chat 或按 URL-only 等客观事实给 suggestion，并记录 `classifier_failed`。
- 想让普通频道自动创建 task，必须配置 `routing.smart_router.auto_task_channels`，并满足 `min_auto_confidence`。
- 只要 `auto_task_channels` 为空，smart router 最多展示按钮，不会直接执行写权限任务。
- 当前 chat path 是轻量 read-only 体验；文件修改、运行验证、commit/push 应进入 task path。
