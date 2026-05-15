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

- [`stock/README.md`](stock/README.md): stock-provider family map, Futu readonly provider boundary, and stock data-flow summary.
- [`stock/eastmoney.md`](stock/eastmoney.md): Eastmoney provider family, merging JYWG readonly holdings and MyFavor watchlist boundaries.
- [`stock/research.md`](stock/research.md): stock research pipeline across portfolio, pulse, market-intel, and watchlist research.

Stock legacy compatibility stubs:

- [`../archive/features/06-futu-stock.md`](../archive/features/06-futu-stock.md): moved into [`stock/README.md`](stock/README.md#futu-stock-provider).
- [`../archive/features/10-stock-portfolio-provider.md`](../archive/features/10-stock-portfolio-provider.md): merged into [`stock/research.md`](stock/research.md#stock-portfolio).
- [`../archive/features/11-stock-pulse-provider.md`](../archive/features/11-stock-pulse-provider.md): merged into [`stock/research.md`](stock/research.md#stock-pulse).
- [`../archive/features/14-market-intel-provider.md`](../archive/features/14-market-intel-provider.md): merged into [`stock/research.md`](stock/research.md#market-intel).
- [`../archive/features/18-stock-watchlist-research-provider.md`](../archive/features/18-stock-watchlist-research-provider.md): merged into [`stock/research.md`](stock/research.md#stock-watchlist-research).

## Content Providers

- [`content.md`](content.md): content ingestion provider family, currently the WeChat MP metadata provider and dedupe/data-flow boundary.

Content legacy compatibility stub:

- [`../archive/features/02-wechat-mp-provider.md`](../archive/features/02-wechat-mp-provider.md): merged into [`content.md`](content.md#wechat-mp-provider).

## Email Providers

- [`email.md`](email.md): Email provider family, merging the shared read-only Email capability, generic `email-query`, and CMB credit-card email parser boundaries.

Email legacy compatibility stubs:

- [`../archive/features/07-email-capability.md`](../archive/features/07-email-capability.md): merged into [`email.md`](email.md#shared-read-only-email-capability).
- [`../archive/features/08-cmb-credit-card-email-provider.md`](../archive/features/08-cmb-credit-card-email-provider.md): merged into [`email.md`](email.md#cmb-credit-card-email-provider).

## Maintenance Rules

- Provider docs should state the trusted source, privacy boundary, owner code paths, output schema, and state/session commit semantics.
- Account/session/cookie details stay in `docs/private/**`; public provider docs only describe safe boundaries.
- Website pages may summarize provider capabilities, but implementation facts must link back through `source_docs`.
