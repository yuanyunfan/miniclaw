# IM Transport Abstraction And Feishu Outbound Validation

Status: completed
Date: 2026-05-14

## Background

MiniClaw already has neutral `AgentRuntime`, `ModelClient`, and `IMTransport` contract files, but the active messaging path still depends on Discord SDK types in bot routing, cron delivery, task view rendering, recovery outbox, and doctor notifications.

The immediate need is to make future IM integrations practical without changing Claude/Codex task runners. The second IM validation target is Feishu, not Telegram.

## Goals

- Keep current Discord behavior as the default and preserve existing cron YAML compatibility.
- Introduce an IM adapter boundary with explicit capabilities and target references.
- Add a Feishu outbound transport using custom bot webhook semantics.
- Let cron jobs opt into extra IM delivery via a logical `delivery_route`.
- Route recovery outbox flushing through the transport boundary for current Discord rows.
- Prove the abstraction with focused unit tests before any complete inbound gateway migration.

## Non-Goals

- Do not replace the Discord bot gateway in this slice.
- Do not migrate slash commands, Discord buttons, or thread continuation into a platform-neutral inbound gateway yet.
- Do not require users to rewrite existing cron files.
- Do not make Feishu support interactive retry buttons or task resume.

## Existing Architecture Evidence

- `src/runtime/im-transport.ts` defines the initial neutral transport contract.
- `src/bot.ts` owns the active Discord gateway and event dispatch.
- `src/discord/task-view-reporter.ts` owns Discord task progress/final rendering.
- `src/cron/runner-message.ts`, `src/cron/runner-task.ts`, and `src/cron/failure-notifier.ts` directly send to Discord channels.
- `src/monitoring/recovery-outbox.ts` currently flushes pending deliveries through a Discord `Client`.

## Implementation Plan

1. Add `src/im/contracts.ts` with transport ids, capabilities, targets, message refs, and send/edit/file/thread contracts.
2. Keep `src/runtime/im-transport.ts` as a compatibility re-export.
3. Add config support for:
   - `im.default_transport`
   - `im.transports.feishu.enabled`
   - `im.transports.feishu.webhook_url`
   - `im.transports.feishu.secret`
   - `im.routes.<name>.targets[]`
4. Add outbound adapters:
   - `src/im/adapters/discord/transport.ts`
   - `src/im/adapters/feishu/transport.ts`
5. Add `src/im/registry.ts` and `src/im/delivery.ts` for resolving logical delivery routes and sending text fanout.
6. Migrate the low-risk outbound paths first:
   - `type=message` cron delivery
   - cron task/skill final extra delivery
   - cron failure alert extra delivery as text-only Feishu fallback
   - recovery outbox flush through the Discord transport boundary
7. Update docs and config example.

## Verification Plan

- Unit tests:
  - config route parsing
  - cron loader `delivery_route`
  - Feishu webhook payload/signature
  - IM delivery fanout
  - recovery outbox flush still marks Discord rows delivered
- Static checks:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Focused regression:
  - `pnpm vitest run src/im/__tests__ src/cron/__tests__/runner-message.test.ts src/cron/__tests__/loader.test.ts src/monitoring/__tests__/recovery-outbox.test.ts src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts`

## Risks And Rollback

- Risk: Feishu delivery failure makes a successful task look failed.
  - Mitigation: task/skill extra delivery logs warnings and does not change the task result; `type=message` still treats delivery as the job business action.
- Risk: route config accidentally disables Discord output.
  - Mitigation: legacy `channel` remains the primary Discord target; `delivery_route` adds extra targets unless a caller explicitly uses route-only delivery later.
- Risk: premature inbound abstraction expands the slice.
  - Mitigation: keep Discord gateway and command handling unchanged.
- Rollback: remove `delivery_route` from cron jobs and leave `im.transports.feishu.enabled=false`; Discord delivery path remains the default.

## Documentation Sync

- Update `docs/architecture.md` to describe the current outbound-only IM abstraction status.
- Update `config.example.yaml` with Feishu transport and route examples.

## Execution Notes

- 2026-05-14: Implemented outbound IM abstraction with neutral contracts, Discord transport adapter, Feishu custom-bot webhook transport, logical `delivery_route` fanout for cron message/task/skill results, cron failure extra delivery, and recovery outbox flushing through the Discord transport boundary.
- Verification: `pnpm run typecheck`; `pnpm vitest run src/im/__tests__ src/cron/__tests__/runner-message.test.ts src/cron/__tests__/loader.test.ts src/monitoring/__tests__/recovery-outbox.test.ts src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts` (7 files, 60 tests); `pnpm run lint`; `pnpm run quality:docs`; `pnpm test` (167 files, 828 tests); `pnpm run build`.
