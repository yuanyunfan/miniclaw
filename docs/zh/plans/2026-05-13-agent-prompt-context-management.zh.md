---
doc_id: agent-prompt-context-management-plan
lang: zh
translation_of: docs/plans/2026-05-13-agent-prompt-context-management.md
translation_status: not_required
---

# Agent Prompt 上下文管理

状态：draft
日期：2026-05-13

## 背景

MiniClaw 当前在 chat、task、Smart Router、cron、provider、memory 和 runtime adapter 多个模块中组装 agent prompt。当前实现能跑通，但 `docs/archive/features/19-agent-prompt-context-audit.md` 的审计发现了几类会影响后续迭代的问题：

- Codex 与 Claude Code 收到的 prompt 分层方式不一致。
- Cron / provider prompt 可能非常大，并且会把私有 provider payload 持久化到 SQLite。
- Task、chat history、recent chat、cron pre-context 的 untrusted context escaping 不一致。
- Memory 和 supervisor 在 task 中 always-on，即使任务很窄也会注入。
- 当前没有 component-level prompt audit，无法在不保存敏感 raw context 的前提下回答“agent 实际收到了什么”。

## 目标

- 让 prompt 构造显式化、类型化、可审计，并尽量 provider-neutral。
- 在没有明确测试覆盖的情况下，不改变当前 chat / task / cron 行为。
- 降低 provider-heavy cron run 的 prompt 膨胀。
- 避免把完整私有 provider payload 持久化到 `tasks.prompt`。
- 在 SDK contract 允许的范围内，让 Codex 和 Claude Code 行为更一致。
- 增加 durable audit evidence：component hashes、char counts、redacted previews、token usage。

## 非目标

- 本 slice 不重设计 Smart Router policy。
- 不移除 Claude 或 Codex 支持。
- 除新增 compact prompt context 字段外，不改变 provider 业务逻辑。
- 不构建通用 multi-agent 平台。
- 默认不存 raw prompts。

## 现有架构证据

- `src/agent/chat.ts`：chat prompt assembly 和 Claude/Codex chat branching。
- `src/agent/runners/codex-task-runner.ts`：Codex task wrapper。
- `src/agent/runners/claude-task-runner.ts`：Claude Agent SDK task wrapper。
- `src/routing/task-context.ts`：task source/reply context envelope。
- `src/routing/context.ts`：Smart Router recent chat context。
- `src/routing/chat-context.ts`：chat Discord runtime context。
- `src/cron/runner-task.ts`：cron pre-context rendering 和 persistence。
- `prompts/templates/cron-*.md`：cron prompt templates。
- `prompts/supervisor.md`：task 中注入的 supervisor guidance。
- `docs/archive/features/19-agent-prompt-context-audit.md`：当前实现审计和真实案例证据。

## 实施计划

1. 新增 prompt envelope 模块。
   - 新文件：`src/prompt/envelope.ts`。
   - 定义 `PromptComponent`、`PromptEnvelope`、trust level、priority、route、provider、audit metadata。
   - 包含 char count、hash、redacted preview helpers。

2. 新增安全 untrusted renderers。
   - 新文件：`src/prompt/renderers.ts`。
   - 提供 JSON/text renderers，统一 escape `<`、`>`、反引号和 code-fence delimiters。
   - 替换 task context、chat history、recent chat context、cron pre-context 中的 ad hoc wrappers。

3. 新增 route envelope builders。
   - `buildChatEnvelope()`
   - `buildTaskEnvelope()`
   - `buildCronTaskEnvelope()`
   - 第一阶段保留当前 route ordering 和 context inclusion behavior。

4. 新增 provider adapters。
   - `renderCodexInput(envelope, attachments)`
   - `renderClaudeChatInput(envelope, attachments)`
   - `renderClaudeTaskInput(envelope, attachments)`
   - 保留 Claude task `systemPrompt.append` 语义。
   - 保持 Codex thread options 不变。

5. 新增 context budget manager。
   - 先使用 route-specific defaults。
   - 记录 included / omitted / truncated components。
   - 在 snapshot tests 固化当前行为前，不改变 cron truncation policy。

6. 默认停止持久化完整 cron provider payload。
   - `tasks.prompt` 只存 display prompt 或高层 cron prompt。
   - 新增安全 prompt audit event，记录 component hashes / counts / previews。
   - 保留足够 debug 证据，但不保留私有 raw payload。

7. 新增 provider compact-context contract。
   - 在 provider run result 中增加可选 `llmContext`、`rawArtifactPath`、`redactedPreview`。
   - 先迁移 `stock-pulse`，因为它产生了当前观测到的最大 prompt。
   - 把 benchmark-index completeness 前移到 provider output，不再依赖常规 LLM web fallback。

8. 更新 docs 和 tests。
   - 更新 `docs/prompts.md`。
   - 更新本 plan 的 Execution Notes。
   - 为 chat / task / cron envelope rendering 增加 prompt snapshots。

## 验证计划

- Unit tests：
  - `src/prompt/__tests__/envelope.test.ts`
  - `src/prompt/__tests__/renderers.test.ts`
  - 现有 task/chat/recent chat context tests。
- Snapshot tests：
  - `pnpm vitest run src/__tests__/prompt-snapshot.test.ts`
  - 新增 chat、task、cron envelope rendering snapshots。
- Cron tests：
  - `pnpm vitest run src/cron/__tests__/runner-task.test.ts`
  - 验证 cron task persistence 不再保存完整 provider payload。
- Security tests：
  - 覆盖恶意 `</user_task>`、`</conversation_history>`、三反引号和 fake instruction strings。
- Static checks：
  - `pnpm run typecheck`
  - `pnpm run lint`
  - `pnpm run quality:docs`

## 风险与回滚

- 风险：provider-neutral envelope 抽象过度。
  - 缓解：只迁移现有 call sites，第一版 adapter 保持很薄。
  - 回滚：撤回 adapter wiring，但保留当前行为测试。

- 风险：不再持久化 full cron prompt 后 debug 变难。
  - 缓解：prompt audit 记录 hashes、counts、redacted previews、route/provider metadata 和可选 artifact path。
  - 回滚：增加 local-only debug flag 用于 full prompt persistence，并附带明确 warning 和 retention。

- 风险：context budgeting 改变输出行为。
  - 缓解：先以 behavior-preserving 模式落地 envelope 和 audit；truncation 变更按 provider 分批加测试。
  - 回滚：把 budgets 设到足够高，先维持当前输出，同时保留 audit metadata。

- 风险：Claude 和 Codex SDK 无法表达完全一致的 priority layers。
  - 缓解：先显式建模理想 envelope，再按 provider 渲染最接近的等价输入，并在文档中记录差异。

## 文档同步

- `docs/archive/features/19-agent-prompt-context-audit.md`：source audit。
- `docs/prompts.md`：更新 prompt asset ownership 和 envelope rendering rules。
- `docs/archive/features/03-discord-task-output.md`：只有 task trace/audit 输出影响用户可见行为时更新。
- `docs/archive/features/04-smart-task-router.md`：只有 router input context 改变时更新。
- `docs/README.md`：保持 feature index 当前。

## 执行记录

- 2026-05-13：基于当前实现审计起草。尚未落地实现。

