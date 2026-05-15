# Agent Run Manager

Status: in-progress managed runtime path
Date: 2026-05-15

## Conclusion

Agent Run Manager is MiniClaw's task-scoped managed multi-agent execution layer. It sits between `executeTask()` and the selected Claude/Codex runtime, keeps the default single-agent path unchanged, and only takes over when `agent_run_manager.enabled=true` or when `agent_run_manager.auto_enabled=true` and the local complexity classifier marks the task as medium/high complexity.

The implementation is intentionally local-first: durable state is SQLite, live child coordination uses the MiniClaw Agent Bus MCP server, ACP is a localhost/token-protected interoperability surface, and `agent_run_manager.enabled=false` remains the rollback path.

## Runtime Boundary

`executeTask()` selects the normal `AgentRuntime` through `src/agent/runtimes/registry.ts`. After that, `src/agent/run-manager/complexity.ts` decides whether to keep the single-agent runtime or create `AgentRunManager`.

Routing rules:

- `agent_run_manager.enabled=true`: force managed path.
- `agent_run_manager.enabled=false` and `agent_run_manager.auto_enabled=false`: keep single-agent path.
- `agent_run_manager.enabled=false` and `agent_run_manager.auto_enabled=true`: use the local complexity score; `complexity_min_score` defaults to `4`.

The classifier is deterministic and local. It scores long prompts, C-slice / implementation-plan language, runtime/schema/MCP/ACP changes, explicit verification needs, docs-driven context, attachments, and resume context. It does not call an LLM and does not grant workspace permissions.

## Managed Execution Model

The current default managed plan is still a bounded `planner -> generator -> evaluator` FSM:

- `planner`: read-only handoff and acceptance criteria.
- `generator`: workspace-write role that produces implementation artifacts.
- `evaluator`: read-only verdict role with bounded fix-loop feedback.
- `supervisor`: root run that owns scheduler state, route state, final synthesis, and cancellation cascade.

The scheduler persists `agent_scheduler_state` and can move the root run to `waiting` while it waits for a child message. Agent Bus direct messages wake in-memory waiters without SQLite polling, while SQLite remains the durable log and restart recovery source.

## State And Bus

Durable state lives in:

- `agent_runs`
- `agent_messages`
- `agent_artifacts`
- `blackboard_facts`
- `agent_scheduler_state`

The typed store facade is `src/store/agent-run-manager.ts`; Manager and ACP/MCP adapters do not write raw SQL. `src/agent/run-manager/bus.ts` enforces sender/receiver task ownership, message kind policy, message count, artifact byte size, and causal ping-pong depth.

## Child Runtime Injection

Real Claude/Codex child runs receive `managedContext`:

- `miniclaw-agent-bus` MCP stdio server config.
- task/run env vars.
- guardrail env vars.
- role runtime policy.
- allowed tool names.
- prompt usage block.

Codex child sessions receive role-specific sandbox and approval policy overrides. Planner/evaluator default to read-only; generator defaults to workspace-write with `approvalPolicy=never`. Claude child sessions receive role-scoped `mcpServers`, `allowedTools`, `permissionMode`, and `canUseTool`.

Every child still returns a final fenced `miniclaw_agent_envelope` JSON block. This is the compatibility fallback and the durable summary contract for messages, artifacts, blackboard facts, verdicts, and fix lists.

## ACP Lifecycle

`src/agent/run-manager/acp/` exposes a minimal localhost ACP-style server for external agents:

- `GET /manifest`
- `POST /runs`
- `POST /messages`
- `GET /mailbox`
- `POST /artifacts`
- `GET /artifacts/:id`
- `GET /blackboard`
- `POST /blackboard`
- `GET /trace`

ACP is task-scoped. When `agent_run_manager.acp.enabled=true`, the manager starts the server for a managed task and stops it when the task finishes or fails. It defaults to `127.0.0.1`, an ephemeral port, and an ephemeral bearer token unless `agent_run_manager.acp.token` is explicitly configured.

Hardening currently implemented:

- bearer token auth by adapter policy;
- in-memory rate limit per token/IP;
- request payload byte cap;
- redacted error responses through the shared diagnostic redaction policy;
- optional redacted task trace export through the existing task trace exporter.

ACP is not a public marketplace or remote-control plane.

## Guardrails

`agent_run_manager` config currently supports:

- `max_turns`
- `timeout_ms`
- `max_messages`
- `max_artifact_bytes`
- `max_spawn_depth`
- `max_children_per_run`
- `max_concurrent_runs`
- `max_ping_pong_turns`
- `cleanup_ttl_ms`
- `max_fix_iterations`
- `auto_enabled`
- `complexity_min_score`
- `acp.*`

The app sweeper starts when forced or auto manager routing is enabled. It reconciles stale active runs, waiting scheduler timeouts, cancelled/terminal parent-child state, orphan children, restart wake messages, and TTL cleanup for manager-owned durable state.

## Current Limits

- The default scheduler is an FSM with a bounded fix loop, not arbitrary LLM-generated DAG execution.
- Final synthesis is still thin: it uses verdict, summary, and active blackboard facts; richer artifact-summary evidence is a follow-up.
- `/task-log` and incident views can show the underlying task trace, but there is no dedicated multi-agent visual trace yet.

## Verification

C6 verification added and passed:

- `pnpm exec vitest run src/agent/run-manager/acp/__tests__/server.test.ts src/agent/run-manager/acp/__tests__/adapter.test.ts src/agent/__tests__/task-helpers.test.ts src/config/__tests__/config-boundaries.test.ts`
- `pnpm exec tsc --noEmit`
