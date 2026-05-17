# Development Plan Documents

This directory stores durable development plans for non-trivial MiniClaw changes.

Use a plan document before editing production code when a task changes architecture, runtime behavior, data flow, auth/permissions, schema, cron/provider/task execution, Discord output, Agent/Codex/Claude behavior, Stage, or shared configuration.

## Current Planning Notes

- [`2026-05-17-stock-provider-data-layer-migration.md`](2026-05-17-stock-provider-data-layer-migration.md): completed compatibility migration; stock providers keep cron-facing names while implementation moves into `src/stock/` source, data, signal, and report layers.
- [`2026-05-15-documentation-strategy.md`](2026-05-15-documentation-strategy.md): completed; layered documentation policy,`docs/`Docs-driving development source of truth, GitHub Pages as human-facing portal.

File naming:

```text
docs/plans/YYYY-MM-DD-short-slug.md
```

Recommended template:

```markdown
# Title

Status: draft | in_progress | completed | superseded
Date: YYYY-MM-DD

## Background

What problem is being solved, and which existing behavior matters?

## Goals

What must be true when this work is done?

## Non-Goals

What is intentionally out of scope?

## Existing Architecture Evidence

- Relevant files:
- Relevant commands:
- Relevant data/config:

## Implementation Plan

1. ...
2. ...
3. ...

## Verification Plan

- Type check:
- Unit tests:
- Integration/E2E checks:
- Manual checks:

## Risks And Rollback

- Risk:
- Mitigation:
- Rollback:

## Documentation Sync

- README:
- docs:
- CHANGELOG:

## Execution Notes

Record material deviations from the plan and final verification evidence here.
```
