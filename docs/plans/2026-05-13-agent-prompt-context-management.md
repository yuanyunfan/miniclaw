# Agent Prompt Context Management

Status: draft
Date: 2026-05-13

## Background

MiniClaw currently assembles agent prompts across chat, task, Smart Router, cron, provider, memory, and runtime adapter modules. The current implementation is functional, but an audit in `docs/archive/features/19-agent-prompt-context-audit.md` found several issues that will limit the next iteration:

- Codex and Claude Code receive differently layered prompt inputs.
- Cron/provider prompts can become very large and persist private provider payloads in SQLite.
- Untrusted context escaping is inconsistent across task, chat history, recent chat, and cron pre-context.
- Memory and supervisor context are always-on for task, even when the task is narrow.
- There is no component-level prompt audit showing what reached the agent without storing raw sensitive context.

## Goals

- Make prompt construction explicit, typed, inspectable, and provider-neutral.
- Preserve current chat/task/cron behavior unless a specific change is covered by tests.
- Reduce prompt bloat for provider-heavy cron runs.
- Avoid persisting full private provider payloads in `tasks.prompt`.
- Keep Codex and Claude Code behavior aligned where their SDK contracts allow it.
- Add durable audit evidence: component hashes, char counts, redacted previews, and token usage.

## Non-Goals

- Do not redesign Smart Router policy in this slice.
- Do not remove Claude or Codex support.
- Do not change provider business logic except to add compact prompt context fields.
- Do not build a general multi-agent platform.
- Do not store raw prompts by default.

## Existing Architecture Evidence

- `src/agent/chat.ts`: chat prompt assembly and Claude/Codex chat branching.
- `src/agent/runners/codex-task-runner.ts`: Codex task wrapper.
- `src/agent/runners/claude-task-runner.ts`: Claude Agent SDK task wrapper.
- `src/routing/task-context.ts`: task source/reply context envelope.
- `src/routing/context.ts`: Smart Router recent chat context.
- `src/routing/chat-context.ts`: chat Discord runtime context.
- `src/cron/runner-task.ts`: cron pre-context rendering and persistence.
- `prompts/templates/cron-*.md`: cron prompt templates.
- `prompts/supervisor.md`: supervisor guidance injected into task.
- `docs/archive/features/19-agent-prompt-context-audit.md`: current-state audit and real-case evidence.

## Implementation Plan

1. Add a prompt envelope module.
   - New file: `src/prompt/envelope.ts`.
   - Define `PromptComponent`, `PromptEnvelope`, trust level, priority, route, provider, and audit metadata.
   - Include helpers for char count, hash, and redacted preview.

2. Add safe untrusted renderers.
   - New file: `src/prompt/renderers.ts`.
   - Provide JSON/text renderers that escape `<`, `>`, backticks, and code-fence delimiters.
   - Replace ad hoc wrappers in task context, chat history, recent chat context, and cron pre-context.

3. Add route envelope builders.
   - `buildChatEnvelope()`
   - `buildTaskEnvelope()`
   - `buildCronTaskEnvelope()`
   - Keep current route ordering and context inclusion behavior in the first slice.

4. Add provider adapters.
   - `renderCodexInput(envelope, attachments)`
   - `renderClaudeChatInput(envelope, attachments)`
   - `renderClaudeTaskInput(envelope, attachments)`
   - Keep Claude task `systemPrompt.append` semantics.
   - Keep Codex thread options unchanged.

5. Add a context budget manager.
   - Start with route-specific defaults.
   - Record included/omitted/truncated components.
   - Do not change cron truncation policy until snapshot tests capture current behavior.

6. Stop persisting full cron provider payloads by default.
   - Store display prompt or high-level cron prompt in `tasks.prompt`.
   - Add safe prompt audit event with component hashes/counts/previews.
   - Preserve enough evidence to debug without private raw payload.

7. Add provider compact-context contract.
   - Add optional `llmContext`, `rawArtifactPath`, and `redactedPreview` to provider run result.
   - Migrate `stock-pulse` first because it produced the largest observed prompt.
   - Move benchmark-index completeness into provider output instead of routine LLM web fallback.

8. Update docs and tests.
   - Update `docs/prompts.md`.
   - Update this plan execution notes.
   - Add prompt envelope snapshots for chat/task/cron.

## Verification Plan

- Unit tests:
  - `src/prompt/__tests__/envelope.test.ts`
  - `src/prompt/__tests__/renderers.test.ts`
  - Existing context tests for task/chat/recent chat.
- Snapshot tests:
  - `pnpm vitest run src/__tests__/prompt-snapshot.test.ts`
  - New snapshots for chat, task, cron envelope rendering.
- Cron tests:
  - `pnpm vitest run src/cron/__tests__/runner-task.test.ts`
  - Verify cron task persistence no longer stores full provider payload.
- Security tests:
  - Include malicious `</user_task>`, `</conversation_history>`, triple-backtick, and fake instruction strings.
- Static checks:
  - `pnpm run typecheck`
  - `pnpm run lint`
  - `pnpm run quality:docs`

## Risks And Rollback

- Risk: provider-neutral envelope becomes too abstract.
  - Mitigation: migrate only existing call sites and keep the first adapter thin.
  - Rollback: revert adapter wiring while keeping tests for current behavior.

- Risk: removing full cron prompt persistence makes debugging harder.
  - Mitigation: prompt audit records hashes, counts, redacted previews, route/provider metadata, and optional artifact path.
  - Rollback: add a local-only debug flag for full prompt persistence with clear warning and retention.

- Risk: context budgeting changes output behavior.
  - Mitigation: first land envelope and audit in behavior-preserving mode; enable truncation changes per provider behind tests.
  - Rollback: set budgets high enough to match current output while keeping audit metadata.

- Risk: Claude and Codex SDKs cannot represent the same priority layers.
  - Mitigation: model the desired envelope explicitly, then render the nearest equivalent per provider and document deltas.

## Documentation Sync

- `docs/archive/features/19-agent-prompt-context-audit.md`: source audit.
- `docs/prompts.md`: update prompt asset ownership and envelope rendering rules.
- `docs/archive/features/03-discord-task-output.md`: update only if task trace/audit output changes user-visible behavior.
- `docs/archive/features/04-smart-task-router.md`: update only if router input context changes.
- `docs/README.md`: keep feature index current.

## Execution Notes

- 2026-05-13: Drafted from current-state audit. No implementation has landed yet.

