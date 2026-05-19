# MiniClaw Providers

> Conclusion: provider docs are the source-of-truth layer for external data collection, pre-provider context, provider safety boundaries, health/dry-run behavior, and provider output contracts. They are separate from runtime docs because providers own data trust and privacy boundaries, not Discord or Agent execution behavior.

## Provider Map

```mermaid
flowchart LR
  Cron[Cron task] --> PreProvider[Pre-provider]
  Task[Manual task] --> ProviderContext[Provider context]
  PreProvider --> Framework[Provider framework]
  ProviderContext --> Framework
  Framework --> Stock[Stock providers]
  Framework --> Content[Content providers]
  Framework --> Email[Email providers]
  Framework --> Output[Structured JSON payload]
  Output --> Agent[Agent runtime prompt]
  Output --> Fixtures[Replay / no-data / format-drift fixtures]
```

## Framework

- [`provider-framework.md`](provider-framework.md): provider manifest, health check, dry-run, structured output, fixture coverage, and compatibility adapter rules.

## Stock Providers

- [`stock/README.md`](stock/README.md): stock data-system overview and runtime layering.
- [`stock/data-and-sources.md`](stock/data-and-sources.md): trusted data sources, account/watchlist boundaries, and normalized stock data semantics.
- [`stock/workflows.md`](stock/workflows.md): stock data products and cron workflow composition.
- [`stock/operations-and-security.md`](stock/operations-and-security.md): stock operations, session refresh, troubleshooting, and safety rules.

Stock provider feature stubs have been merged and removed. Use the stock data-system docs above as the current stock source docs.

## Content Providers

- [`content.md`](content.md): content ingestion provider family, currently the WeChat MP metadata provider and dedupe/data-flow boundary.

Content provider feature stubs have been merged and removed; use `content.md` as the current content source doc.

## Email Providers

- [`email.md`](email.md): Email provider family, merging the shared read-only Email capability, generic `email-query`, and CMB credit-card email parser boundaries.

Email provider feature stubs have been merged and removed; use `email.md` as the current email source doc.

## Maintenance Rules

- Provider docs should state the trusted source, privacy boundary, owner code paths, output schema, and state/session commit semantics.
- Account/session/cookie details stay in `docs/private/**`; public provider docs only describe safe boundaries.
- Website pages may summarize provider capabilities, but implementation facts must link back through `source_docs`.
