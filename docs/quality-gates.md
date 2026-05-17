# MiniClaw Quality Gates

> MiniClaw uses layered gates: `L*` verifies behavior, `G*` blocks unsafe commits and pushes, and `D*` prevents documentation drift. Real Discord E2E exists, but routine gates prefer deterministic fake/fixture paths. Real network and real LLM paths remain manual or scheduled.

## Current Baseline

`package.json` exposes the main gate entrypoints:

- `quality:g0`
- `quality:g0:staged`
- `quality:secrets`
- `quality:secrets:staged`
- `quality:changelog`
- `quality:docs`
- `quality:docs:drift`
- `quality:docs-i18n`
- `quality:website-docs`
- `quality:deps`
- `quality:coverage`
- `quality:commit`
- `quality:push`
- `e2e:cron`
- `e2e:discord`

`scripts/git-hooks/pre-commit` calls `pnpm run quality:commit`. `scripts/git-hooks/pre-push` calls `pnpm run quality:push`. CI runs the same families through `.github/workflows/quality.yml`.

## Naming Rules

- `L*` means test layer: does behavior work?
- `G*` means quality gate: may this commit, push, or CI job pass?
- `D*` means docs gate: do long-lived docs still match implementation reality?

Do not mix the concepts. For example, `pnpm test` is an `L1` test suite; it becomes part of a `G1` gate only when a commit/push/CI entrypoint invokes it.

## G0: Repository Safety

Purpose: block high-damage mistakes before they enter Git.

Checks include:

- Node version compatibility with `package.json#engines`
- package and lockfile consistency
- staged or tree files do not include `.env`, SQLite DBs, coverage HTML, large binaries, token dumps, or local runtime artifacts
- public docs/examples do not include local absolute paths or raw Discord snowflake IDs
- `docs/private/` stays outside public docs and public website exposure
- `docs/zh/` is allowed as public docs, but it is still scanned for local paths, raw Discord IDs, and secrets

Run locations:

- pre-commit
- CI
- local tree verification through `pnpm run quality:g0`

## G1: Static Correctness

Purpose: verify the code compiles, builds, and follows static rules without contacting real external systems.

Commands:

```bash
pnpm run typecheck
pnpm run build
pnpm run lint
```

Project-specific lint expectations:

- runtime source should use `src/lib/log.ts` instead of direct `console.*`
- floating promises must be explicit and justified
- logs must not contain secrets, full prompts, raw email bodies, or token-like fields

Run locations:

- pre-commit: lint and typecheck
- pre-push: build and lint
- CI: typecheck, lint, and build

## L1: Fast Unit And Component Tests

Purpose: deterministic, local, no network, no real Discord, no real LLM.

Coverage focus:

- cron loader, state, template, retry, and scheduler pure logic
- routing intent, confirmation token, and context handling
- Discord formatter, chunking, embeds, and attachment conversion
- provider parser, formatter, redaction, health, dry run, and fixtures
- prompt snapshot behavior
- task helper, session, usage, and status summary logic

Command:

```bash
pnpm test
```

Run locations:

- pre-commit
- CI

## Coverage Ratchet

Purpose: keep high-value implementation files from silently losing focused test coverage during refactors.

`pnpm run quality:coverage` reads `coverage/coverage-summary.json` after `pnpm run test:cov` and checks file-specific thresholds in `scripts/quality-coverage-ratchet.ts`.

Current ratcheted stock report targets live under `src/stock/reports`, not provider compatibility facades. This keeps the gate attached to the owned report logic after the stock provider data-layer migration.

## L2: Internal Integration Tests

Purpose: connect MiniClaw modules while replacing external systems with fakes or fixtures.

Examples:

- fake Discord channel/thread for task intake
- temporary SQLite DB for task state transitions
- fixture cron directory for scheduler and retry behavior
- fake slash interactions for command handlers
- fake pre-provider output injected into task prompts
- fake logger sink for start/end/error assertions

Run locations:

- pre-push
- CI

## L3: Real Discord E2E With Fake Agent

Purpose: verify real Discord Gateway, real channels, real threads, and real message output without calling Claude or Codex.

Rules:

- use a dedicated Discord test application
- use a dedicated test guild/channel
- never use production bot secrets
- keep fake agent deterministic
- run manually or on a schedule, not in every commit

Command:

```bash
pnpm run e2e:discord
```

## L4: Real Provider Or Real LLM Smoke

Purpose: prove selected external integrations still work.

Examples:

- real Claude/Codex task smoke
- provider login/session refresh smoke
- real email/stock/content provider health check
- real Discord plus real LLM route

Rules:

- manual or scheduled only
- use dedicated test channels/accounts
- redact traces
- never block normal local pre-commit work on volatile networks

## D1: Docs Drift

Purpose: prevent source changes from landing without updating durable docs.

`pnpm run quality:docs:drift` checks:

- DB schema version in code equals the version documented in `docs/architecture.md`
- `smart_router_decisions` documented fields include `TEXT reason`, `TEXT matched_signals`, `TEXT risk_flags`, `TEXT capabilities_json`, `INTEGER classifier_elapsed_ms`, `TEXT classifier_error_type`, `TEXT classifier_error_message`, `TEXT user_choice`, `TEXT final_route`, `TEXT task_final_status`, `TEXT correction_type`, `TEXT correction_note`, and `TEXT resolved_at`
- source docs under `docs/runtime/`, `docs/providers/`, and `docs/experiments/` are indexed from `docs/README.md`
- changed source paths map to required docs through `src/quality/docs-drift.ts`

The changed-path map is intentionally conservative. If source behavior changes, the patch must include the relevant docs update.

## D2: Bilingual Docs Parity

Purpose: keep `docs/` and `docs/zh/` aligned with English as canonical source.

`pnpm run quality:docs-i18n` checks:

- every tracked canonical doc outside `docs/zh/**`, `docs/archive/**`, and `docs/private/**` appears in `docs/documentation-migration-map.md`
- every required source doc has a tracked Chinese mirror
- Chinese mirror frontmatter includes `doc_id`, `lang: zh`, `translation_of`, `translation_status`, and `source_sha256`
- `translation_status: pending` is not allowed for required docs
- current Chinese mirrors carry a `source_sha256` matching the English source
- English canonical prose does not contain CJK text outside fenced code blocks
- Chinese mirror prose contains CJK text outside fenced code blocks
- tracked Chinese docs are paired in the migration map
- heading level shape matches the English source

Archive and private docs are intentionally excluded from required bilingual parity unless the migration map marks them otherwise.

## D3: Website Docs Drift

Purpose: keep GitHub Pages presentation content tied to canonical repo docs.

`pnpm run quality:website-docs` checks website frontmatter and source references. Website pages are presentation-only; they do not replace `docs/` as the implementation source of truth.

Website updates are public-impact updates, not routine implementation bookkeeping. Small fixes should update code, focused tests, canonical docs, and changelog entries without editing `website/**` unless the public summary becomes inaccurate. Update website pages only when a public capability, install/config workflow, user-visible behavior, or existing website claim changes.

Website pages may declare two source classes:

- `source_docs`: public-impact sources. Changes to these sources block until the website page is updated or explicitly acknowledged as unaffected.
- `trace_docs`: trace-only sources. Changes to these sources are reported for review but do not block the gate.

If a `source_docs` change does not affect public website copy, record that decision through `.website-docs-drift-ack.md` instead of editing website frontmatter or adding implementation details to the page body.

## G2: Secrets And Dependencies

Purpose: block secrets, unsafe local files, and dependency issues.

Commands:

```bash
pnpm run quality:secrets
pnpm run quality:deps
```

CI also runs gitleaks.

## Changelog Drift

Purpose: prevent release-visible changes from landing without `CHANGELOG.md`.

`pnpm run quality:changelog` fails when release-visible paths change without a same-patch `CHANGELOG.md` update. Release-visible paths include `src/**`, `scripts/**`, `.github/workflows/**`, `docs/**`, `website/**`, `prompts/**`, `package.json`, `config.example.yaml`, and public README files. Archive/private docs, tests, fixtures, coverage, and generated website output are ignored.

This gate does not generate release notes automatically. It makes the missing changelog update blocking so the changelog stays part of the development workflow.

## Default Gate Entry Points

Pre-commit:

```bash
pnpm run quality:commit
```

Pre-push:

```bash
pnpm run quality:push
```

Targeted docs verification:

```bash
pnpm run quality:docs
```

Targeted i18n verification:

```bash
pnpm run quality:docs-i18n
```

Targeted changelog verification:

```bash
pnpm run quality:changelog
```
