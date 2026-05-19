# MiniClaw Docs Index

> Conclusion: `docs/` is MiniClaw's implementation source of truth for LLMs and maintainers. `website/` is the human-facing GitHub Pages presentation layer. The root `docs/` tree is the English canonical tree, while `docs/zh/` is the tracked Chinese mirror. Pairing status is recorded in `documentation-migration-map.md`.

## Core Design

- [`architecture.md`](architecture.md): System architecture, runtime boundaries, data flow, storage model, and the user-level `~/.miniclaw/` layout.
- [`bot-routing.md`](bot-routing.md): Discord Gateway event routing, message paths, slash commands, button dispatch, and thread continuation.
- [`chat-router-current-logic.md`](chat-router-current-logic.md): Current chat/task routing logic, Smart Router capability mapping, confirmation buttons, and known misroute boundaries.
- [`install-distribution-strategy.md`](install-distribution-strategy.md): Installation, configuration wizard, release artifacts, and local deployment strategy for external technical users.
- [`prompts.md`](prompts.md): Framework-level prompt assets and prompt loader rules.
- [`quality-gates.md`](quality-gates.md): Test layers, quality gates, docs drift gates, bilingual docs gates, and Discord E2E policy.
- [`documentation-migration-map.md`](documentation-migration-map.md): Machine-readable map for docs migration, bilingual pairing, website exposure, and private/archive boundaries.

## Runtime

- [`runtime/README.md`](runtime/README.md): Runtime source of truth for Discord intake, routing, chat/task/cron runtime, memory/context, and operations.

Runtime compatibility stubs have been removed after their content was merged into `runtime/README.md` and the top-level routing docs.

## Providers

- [`providers/README.md`](providers/README.md): Provider docs index and maintenance rules.
- [`providers/provider-framework.md`](providers/provider-framework.md): Provider framework source of truth for manifests, health checks, dry runs, structured output, fixtures, and failure taxonomy.
- [`providers/content.md`](providers/content.md): Content provider family, currently covering WeChat MP ingestion and dedupe boundaries.
- [`providers/email.md`](providers/email.md): Email provider family, separating the read-only email capability from business parsers.
- [`providers/stock/README.md`](providers/stock/README.md): Stock data-system overview and runtime layering.
- [`providers/stock/data-and-sources.md`](providers/stock/data-and-sources.md): Stock source inventory, trust boundaries, and normalized data semantics.
- [`providers/stock/workflows.md`](providers/stock/workflows.md): Stock data products and cron workflow composition.
- [`providers/stock/operations-and-security.md`](providers/stock/operations-and-security.md): Stock operations, session refresh, troubleshooting, and account safety rules.

Provider compatibility stubs have been removed after their content was merged into the provider-family docs above.

## Experiments

- [`experiments/README.md`](experiments/README.md): Experimental control-plane index.

Experiment compatibility stubs have been removed after Stage and Ralph content was merged into `experiments/README.md` and the Ralph docs.

## Plans

- [`plans/README.md`](plans/README.md): Plan document rules for non-trivial development work.
- [`plans/2026-05-15-documentation-strategy.md`](plans/2026-05-15-documentation-strategy.md): Completed documentation strategy; `docs/` is the docs-driven source of truth, while GitHub Pages is the human portal.
- `plans/YYYY-MM-DD-*.md`: Completed or in-progress implementation plans.

## Chinese Docs

- [`zh/README.md`](zh/README.md): Chinese mirror of this index.
- `docs/zh/**`: Chinese mirrors of English canonical docs. Each tracked Chinese mirror must contain `doc_id`, `lang: zh`, `translation_of`, `translation_status`, and `source_sha256` frontmatter.

Chinese docs are no longer local review copies. They are a first-class language layer for repo docs. Any required mirror must stay `translation_status: current` and must carry a `source_sha256` that matches the English source.

## Website

- `../website/en/`: English GitHub Pages source.
- `../website/zh/`: Chinese GitHub Pages source.
- `../website/llms.txt`: LLM-facing website note.

Website pages must stay presentation-only and declare language-aware `source_docs` frontmatter. Website pages do not satisfy code-to-docs drift requirements; canonical implementation facts still belong in `docs/`.

## Archive

- [`archive/2026-05-11-continuous-improvement-report.md`](archive/2026-05-11-continuous-improvement-report.md): Historical architecture audit and continuous-improvement report; not a current source of truth.

## Runbooks

- [`runbooks/install.md`](runbooks/install.md): MiniClaw 1.0 installation, configuration, and troubleshooting flow for technical users.
- [`runbooks/local-deploy.md`](runbooks/local-deploy.md): Safe deploy, safe restart, rollback, and verification flow for the local PM2 runtime.

## Private

- `private/eastmoney/`: Private Eastmoney research and sensitive design boundaries. This tree is intentionally excluded from public website exposure and bilingual parity gates.

## Placement Rules

- Global architecture, routing, engineering governance, and framework-level prompt docs live at the top level of `docs/`.
- Runtime docs live in `docs/runtime/`, provider and data-system docs live in `docs/providers/`, and experimental control-plane docs live in `docs/experiments/`.
- Do not add new feature-level compatibility stubs. Current source-of-truth docs should live in the runtime, provider, or experiment family docs.
- Implementation plans live only in `docs/plans/`; do not mix plans with current design docs.
- Obsolete audits, historical retrospectives, and retired global roadmaps live in `docs/archive/`; they cannot replace current source-of-truth docs.
- Executable operational procedures live in `docs/runbooks/`.
- Private research containing account, cookie, trading-console, or other sensitive details lives in `docs/private/`.
- Chinese docs live in `docs/zh/`, mirror the English relative path, and use the `.zh.md` suffix except for mirrored `README.md` files.
- Update `docs/documentation-migration-map.md` before moving, merging, archiving, or exposing docs through the website.
- Website content lives in `website/`. Do not publish `docs/plans/**`, `docs/archive/**`, or `docs/private/**` directly as current public documentation.
