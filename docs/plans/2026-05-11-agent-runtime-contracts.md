# Agent Runtime, Model Client, IM Transport, And Data Provider Contracts

Status: done
Date: 2026-05-11

## Background

MiniClaw currently switches behavior around `AgentProvider = "claude" | "codex"`. Multiple areas branch on `config.agentProvider`, including task execution, chat, Stage, routing LLM calls, session validation, and runtime config display.

This has worked for two coding-agent backends, but the abstraction is brand-based rather than capability-based. If MiniClaw later adds Hermes Agent, OpenClaw, a plain model API for classification, Telegram, Slack, Teams, or additional data providers, brand branches will spread.

The target is capability contracts:

- `AgentRuntime`: long-running coding/task execution with workspace permission and session semantics.
- `ModelClient`: short non-workspace LLM calls for router, summary, diagnosis, formatting.
- `IMTransport`: messaging surface operations such as send, edit, thread, button, file upload, rate limit, and permission checks.
- `DataProvider`: WeChat, email, Futu, Eastmoney, market data, and similar deterministic data collection.

## Goals

- Introduce capability-oriented contracts without breaking current Claude/Codex behavior.
- Keep `agentProvider` as a backward-compatible config alias during transition.
- Ensure adding a plain LLM API for router/doctor does not require pretending it is a coding agent runtime.
- Ensure adding an IM transport does not require changing Claude/Codex runners.
- Keep Data providers separate from AI providers.

## Non-Goals

- Do not build a generic Agent platform.
- Do not migrate all call sites in one session.
- Do not add Telegram/Slack/Teams in this slice.
- Do not remove Claude/Codex config keys until compatibility and docs are ready.
- Do not default tasks to multi-agent execution.

## Existing Architecture Evidence

- `src/config.ts`: exports `AgentProvider` and a single `config.agentProvider`.
- `src/agent/session.ts`: formats and validates provider-prefixed session ids.
- `src/agent/task.ts`: provider-specific task execution branch.
- `src/agent/chat.ts`: provider-specific chat behavior.
- `src/agent/runtime-config.ts`: displays current provider/model/runtime settings.
- `src/routing/llm.ts`: classification/model path tied to current config.
- `src/stage/agent.ts`: Stage path branches on current provider.
- `src/providers/types.ts`: data pre-provider contract is currently unrelated but thin.

## Proposed Contracts

### `AgentRuntime`

```ts
export interface AgentRuntime {
  id: string;
  kind: "coding_agent";
  capabilities: {
    resumeSession: boolean;
    cancel: boolean;
    toolEvents: boolean;
    workspaceWrite: boolean;
  };
  startTask(input: AgentTaskInput): Promise<AgentTaskResult>;
  resumeTask?(input: AgentTaskResumeInput): Promise<AgentTaskResult>;
  startChat?(input: AgentChatInput): Promise<AgentChatResult>;
}
```

This contract should align with `TaskViewEvent` and task runner work, but the first slice may only define types and adapter shims.

### `ModelClient`

```ts
export interface ModelClient {
  id: string;
  kind: "model_client";
  complete(input: ModelCompletionInput): Promise<ModelCompletionResult>;
  classify?<T>(input: ModelClassificationInput<T>): Promise<T>;
}
```

Use cases:

- Smart Router classifier
- Auto Doctor summarization/diagnosis
- report formatting
- short explanations that do not need workspace write permissions

### `IMTransport`

```ts
export interface IMTransport {
  id: string;
  kind: "im_transport";
  send(input: SendMessageInput): Promise<SentMessage>;
  edit(input: EditMessageInput): Promise<void>;
  createThread(input: CreateThreadInput): Promise<ThreadRef>;
  sendFile(input: SendFileInput): Promise<void>;
}
```

Start by documenting Discord as the only implemented transport. Do not move Discord types behind this contract until there is a concrete second transport or a testability need.

### `DataProvider`

Keep separate from `AgentRuntime` and `ModelClient`. The detailed provider framework is covered by `2026-05-11-provider-framework-sdk.md`.

## Implementation Plan

1. Add contract types in a neutral location.
   - Candidate files:
     - `src/runtime/agent-runtime.ts`
     - `src/runtime/model-client.ts`
     - `src/runtime/im-transport.ts`
   - Avoid importing Discord, Claude, or Codex SDK types into the contract files.
2. Add adapter shims for current providers.
   - `src/agent/runtimes/claude-runtime.ts`
   - `src/agent/runtimes/codex-runtime.ts`
   - These can wrap existing functions at first.
3. Add a runtime registry.
   - `getAgentRuntime(id)` returns Claude/Codex runtime adapters.
   - `getDefaultAgentRuntime(config)` maps existing `config.agentProvider` to a runtime id.
4. Keep `config.agentProvider` as compatibility.
   - Add future-compatible config shape behind it:
     - `runtime.default_agent`
     - `model.default_client`
   - Do not require users to rewrite config in the first slice.
5. Move Smart Router and Doctor short model calls toward `ModelClient`.
   - Start with an adapter around existing `src/routing/llm.ts`.
   - Do not give classifier clients workspace permissions.
6. Align session id validation.
   - Replace provider-only assumptions with runtime id where possible.
   - Keep `claude:<id>` and `codex:<id>` compatibility.
7. Update runtime config display.
   - `/agent-config` should show:
     - default agent runtime;
     - default model client;
     - transport;
     - data provider config summary only when safe.
8. Add tests.
   - Runtime registry selection.
   - Config compatibility mapping.
   - Session id compatibility.
   - ModelClient does not expose task runtime capabilities.

## Migration Strategy

### Phase 1: Types And Registry

- Add contracts and registry.
- Keep all existing behavior.
- Add tests for default mapping.

### Phase 2: Task Runtime Adapter

- Use the registry inside `executeTask`.
- Preserve public `executeTask` signature.
- Reuse `TaskViewEvent` work if already landed.

### Phase 3: Model Client Adapter

- Route Smart Router classifier and Auto Doctor short calls through `ModelClient`.
- Keep deterministic policy outside model client.

### Phase 4: Config Shape

- Add `runtime.default_agent` and `model.default_client` as optional config.
- Existing `agent_provider` remains supported and emits no hard error.
- Docs show the new preferred structure.

## Verification Plan

- Focused tests:
  - New runtime registry tests.
  - `pnpm vitest run src/agent/__tests__/runtime-config.test.ts src/agent/__tests__/codex.test.ts`
  - Smart Router classifier tests if touched.
- Static:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Regression:
  - `pnpm test`
  - `pnpm run build` when exports/config shape change.

## Risks And Rollback

- Risk: abstract contracts become speculative overengineering.
  - Mitigation: start as thin shims over existing Claude/Codex behavior; migrate only concrete call sites.
- Risk: config compatibility breaks running bot.
  - Mitigation: keep old config keys and tests; do not make new keys required.
- Risk: `ModelClient` accidentally gains workspace/tool permissions.
  - Mitigation: separate types and modules; do not reuse `AgentRuntime` for classifier calls.
- Risk: transport abstraction slows Discord work.
  - Mitigation: document Discord as the only transport until there is a real second transport.

## Documentation Sync

- Update `docs/architecture.md` runtime section.
- Update `docs/features/03-discord-task-output.md` only if Discord boundaries change.
- Update config examples when `runtime.default_agent` or `model.default_client` are accepted.
- Run `pnpm run quality:docs`.

## Execution Notes

Record which phase landed, compatibility behavior, and verification commands here when implemented.

- 2026-05-12: Landed Phase 1 contracts and registry. Added neutral `AgentRuntime`, `ModelClient`, and `IMTransport` contract types; added Claude/Codex `AgentRuntime` adapter shims over the existing task runners; added a runtime registry with legacy `agentProvider` default mapping and future-shaped `runtime.default_agent` resolution helper; documented the current transition boundary in `docs/architecture.md`. Existing task execution still selects runners through the old path; no behavior migration to `executeTask` happened in this phase.
- Verification: `pnpm vitest run src/agent/__tests__/runtime-registry.test.ts src/runtime/__tests__/contracts.test.ts`; `pnpm run typecheck`; `pnpm vitest run src/agent/__tests__/runtime-config.test.ts src/agent/__tests__/codex.test.ts`; `pnpm run lint`; `pnpm run quality:docs`; `pnpm run build`; `pnpm test`. During an earlier parallel verification attempt, `pnpm test` hit transient SQLite migration lock/unique errors in DB-heavy suites; rerunning those suites directly and then rerunning full `pnpm test` passed.
- 2026-05-12: Landed Phase 2 task runtime adapter wiring. `executeTask` now resolves the selected `AgentRuntime` through the runtime registry and calls `runtime.startTask` while preserving the public `executeTask` signature, Discord task view handling, cancellation/interruption normalization, DB completion updates, and raw/embed output modes. E2E fake task execution now wraps the selected runtime id through the same `AgentRuntime` contract instead of bypassing the runtime boundary with the old runner selector. Updated architecture/task-output docs to reflect the new runtime selection boundary.
- Verification: `pnpm vitest run src/agent/__tests__/task-runtime-registry.test.ts src/agent/__tests__/task-helpers.test.ts src/agent/__tests__/runtime-registry.test.ts src/agent/__tests__/e2e-fake-runtime.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm test` (144 files, 718 tests); `pnpm run quality:docs`.
- 2026-05-12: Landed Phase 3 Smart Router `ModelClient` adapter wiring. Added provider-neutral model client adapters for Anthropic-compatible Messages, OpenAI-compatible chat completions, and read-only Codex thread completions; `src/routing/llm.ts` now classifies through the `ModelClient` contract instead of owning provider SDK calls directly. Preserved existing classifier provider selection, model inheritance, OpenAI system prompt, JSON response format, timeout behavior, optional Codex fallback, and read-only/no-network Codex classifier boundary. Auto Doctor currently has no short LLM call path to migrate, so docs now state that explicitly rather than implying a hidden doctor model client path.
- Verification: `pnpm vitest run src/routing/__tests__/llm.test.ts src/runtime/__tests__/contracts.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run quality:docs`; `pnpm run build`; `pnpm test` (144 files, 719 tests).
- 2026-05-12: Landed Phase 4 config shape and runtime display wiring. Added optional `runtime.default_agent` / `MINICLAW_RUNTIME_DEFAULT_AGENT` and `model.default_client` / `MINICLAW_MODEL_DEFAULT_CLIENT` config support while keeping legacy `agent.provider` as the fallback alias. Smart Router LLM provider selection now falls back to `model.default_client` unless the router-specific provider is configured. Task intake, `/resume`, thread continuation, and `/health` now use the effective default `AgentRuntime` for task display and session preflight checks. `/agent-config` now shows default AgentRuntime, legacy provider alias, ModelClient default/router client, Discord as the implemented IMTransport, and safe pre-provider names. Updated config example and docs to reflect the accepted config shape and Discord task boundary.
- Verification: `pnpm vitest run src/__tests__/config.test.ts src/config/__tests__/config-boundaries.test.ts src/agent/__tests__/runtime-config.test.ts src/agent/__tests__/session.test.ts src/agent/__tests__/task-helpers.test.ts src/agent/__tests__/runtime-registry.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run quality:docs`; `pnpm run build`; `pnpm test` (144 files, 719 tests).
