# Smart Router Evaluation Loop

Status: done
Date: 2026-05-11

## Background

`smart_router_decisions` already records enough for single-decision debugging: prompt hash/preview, capability JSON, classifier timing/error, action result, and created task id. It does not yet provide a long-term quality loop.

MiniClaw needs to answer operational questions such as:

- Did the user accept the suggested task route or continue chat?
- Did an auto-created task complete successfully?
- Which prompts were false positives or false negatives?
- Did classifier failure actually hurt user experience?
- Which route corrections should become deterministic fixtures?

## Goals

- Persist user choice, final route, task final status, and route correction metadata.
- Update Smart Router button handlers to record choice and final action.
- Link router decisions to created task outcome.
- Add a local `router-review` report and optionally a Discord command.
- Convert high-frequency real prompts into deterministic fixtures.
- Keep deterministic policy as the permission boundary; LLM classifier remains only a capability hint.

## Non-Goals

- Do not make the LLM classifier authoritative for permissions.
- Do not store full prompt text unless existing config explicitly enables it.
- Do not auto-train or fine-tune a model from user prompts.
- Do not change default routing behavior without tests and docs.
- Do not require real Discord or real LLM calls for evaluation reports.

## Existing Architecture Evidence

- `src/bot.ts`: logs Smart Router decisions and handles Smart Router buttons.
- `src/routing/*`: deterministic intent, context, confirmation, classifier, and action resolution logic.
- `src/store/db.ts`: `smart_router_decisions` table and helpers.
- `docs/bot-routing.md` and `docs/chat-router-current-logic.md`: current routing behavior and decision fields.
- `docs/plans/2026-05-07-smart-task-router-implementation.md`: original implementation plan and non-goals.
- `src/store/__tests__/db.test.ts`: schema invariant tests for Smart Router fields.

## Data Model Proposal

Add columns to `smart_router_decisions` or a narrow companion table. Prefer columns first if the current table remains small and migration is straightforward.

Candidate columns:

- `user_choice TEXT`
  - examples: `accepted_task`, `continued_chat`, `cancelled`, `ignored`, `auto_task_no_choice`
- `final_route TEXT`
  - examples: `chat`, `task`, `none`
- `task_final_status TEXT`
  - examples: `completed`, `failed`, `cancelled`, `interrupted`, `not_created`
- `correction_type TEXT`
  - examples: `false_positive`, `false_negative`, `classifier_error`, `policy_blocked`, `user_override`, `none`
- `correction_note TEXT`
  - short redacted note or deterministic reason
- `resolved_at TEXT`
  - when the final route/outcome became known

If this expands beyond router-only fields, use `smart_router_feedback`:

```sql
CREATE TABLE smart_router_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id INTEGER NOT NULL,
  user_choice TEXT,
  final_route TEXT NOT NULL,
  task_final_status TEXT,
  correction_type TEXT,
  correction_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_id) REFERENCES smart_router_decisions(id)
);
```

## Implementation Plan

1. Confirm current schema and helpers.
   - Read `src/store/db.ts` around `smart_router_decisions`.
   - Identify whether update helpers can safely update nullable new fields.
2. Add persistence fields.
   - Add migration columns or companion table.
   - Add typed helpers such as `recordSmartRouterUserChoice`, `recordSmartRouterTaskOutcome`, and `listSmartRouterReviewRows`.
   - Add schema tests in `src/store/__tests__/db.test.ts`.
3. Update button handling.
   - When user clicks "转为 task", record `user_choice=accepted_task`, `final_route=task`.
   - When user clicks "继续 chat", record `user_choice=continued_chat`, `final_route=chat`.
   - When confirmation expires or is cancelled, record a clear terminal state if possible.
   - Preserve custom id privacy; do not put prompt text in button ids.
4. Link created task outcomes.
   - On task creation, keep `created_task_id` as today.
   - On task final status update, update the related decision row if one exists.
   - Prefer a small helper invoked at the same point task status is finalized, not a polling loop.
   - If this creates coupling from task execution to router store, isolate it behind a generic `onTaskFinalized` hook or repository helper.
5. Add route correction capture.
   - Start with explicit button choices and task outcome; do not over-infer corrections.
   - Add a simple slash/local command path later if the user wants to mark a prior decision as false positive/negative.
   - Optional CLI: `pnpm run router:mark -- --decision <id> --correction false_positive`.
6. Add review report.
   - New script: `scripts/router-review.ts`.
   - Package script candidate: `"router:review": "tsx scripts/router-review.ts"`.
   - Report dimensions:
     - time window, default 7 days;
     - channel;
     - initial intent/action;
     - classifier error type;
     - user choice;
     - final route;
     - task outcome;
     - correction type.
   - Output terminal-friendly text, not wide Markdown tables.
7. Add fixtures.
   - Extract representative prompts into `src/routing/__fixtures__/smart-router-prompts.ts` or JSON.
   - Categories:
     - current info lookup;
     - multi-step research;
     - file/code change;
     - runtime inspection;
     - ordinary explanation/chat;
     - ambiguous follow-up using recent context.
   - Tests should assert deterministic policy and expected suggested action.
8. Optional Discord command.
   - Add `/router-review days:<n> channel:<optional>`.
   - Keep output summary under Discord content limits.
   - Do not expose prompt text, only prompt preview/hash and aggregate counts.

## Verification Plan

- Focused tests:
  - `pnpm vitest run src/store/__tests__/db.test.ts`
  - `pnpm vitest run src/routing/__tests__/intent.test.ts src/routing/__tests__/context.test.ts src/routing/__tests__/confirmations.test.ts`
  - New `router-review` script tests if implemented.
- Static checks:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Regression:
  - `pnpm test`
- Manual local smoke:
  - Insert or reuse local test decisions.
  - Run `pnpm run router:review -- --days 7`.
  - Confirm the report separates classifier errors, user choices, and task failures.

## Risks And Rollback

- Risk: new schema fields become another monolithic DB edit.
  - Mitigation: keep fields nullable and add tests; if DB migration refactor has landed, add a versioned migration.
- Risk: task outcome update couples router to task execution too tightly.
  - Mitigation: use a small store helper keyed by `task_id`; task execution does not need to understand router logic.
- Risk: prompt privacy regression.
  - Mitigation: use prompt hash and existing prompt preview config; never add full prompt to reports by default.
- Risk: false correction inference creates misleading metrics.
  - Mitigation: record observed facts first; infer false positive/negative only from explicit user action or dedicated review command.

## Documentation Sync

- Update `docs/bot-routing.md` and `docs/chat-router-current-logic.md` with new feedback fields.
- Update `docs/architecture.md` ER diagram if schema changes.
- Add or update Smart Router feature doc if report command is user-facing.
- Run `pnpm run quality:docs`.

## Execution Notes

Record schema version, added fields, report command, fixture categories, and verification output here when implemented.

2026-05-12 Ralph implementation:

- Bumped DB schema to v9 and added nullable `smart_router_decisions` evaluation fields: `user_choice`, `final_route`, `task_final_status`, `correction_type`, `correction_note`, `resolved_at`; added `idx_smart_router_decisions_task`.
- Added store helpers for confirmation choice, task outcome writeback, and review listing: `recordSmartRouterUserChoice`, `recordSmartRouterTaskOutcome`, `listSmartRouterReviewRows`.
- Wired Smart Router decisions so direct chat, auto task, confirmed task, continued chat, cancel, expired click, and task creation failure write final route/choice facts. Task status updates now backfill linked Smart Router rows by `created_task_id`.
- Added local review report: `pnpm run router:review -- --days 7`, backed by `src/routing/router-review.ts`; report aggregates channel, intent, classifier error, user choice, final route, task outcome, and correction type without printing full prompts.
- Added focused tests for DB schema/helper behavior and review rendering. Added an ambiguous follow-up implementation fixture to existing router eval fixtures.
- Synced docs: `docs/architecture.md`, `docs/bot-routing.md`, `docs/chat-router-current-logic.md`, `docs/features/04-smart-task-router.md`, `docs/features/05-smart-task-router.en.md`, and `scripts/quality-docs.ts`.
- Verification passed:
  - `pnpm vitest run src/routing/__tests__/router-review.test.ts src/store/__tests__/db.test.ts` -> 19 tests passed.
  - `pnpm run typecheck` -> passed.
  - `pnpm run lint` -> passed.
  - `pnpm run quality:docs` -> passed, schema v9.
  - `pnpm run router:review -- --days 7 --limit 5` with a temporary DB -> rendered an empty report successfully.
  - `pnpm ralph:verify -- --task smart-router-evaluation-loop --profile router` -> 57 tests passed; typecheck, lint, and quality docs passed.
