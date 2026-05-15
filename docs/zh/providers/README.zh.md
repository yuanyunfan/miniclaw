---
doc_id: providers-index
lang: zh
translation_of: docs/providers/README.md
translation_status: current
---

# MiniClaw Providers

> 结论：provider docs 是外部数据采集、pre-provider context、provider safety boundary、health/dry-run 行为和 provider output contract 的 source-of-truth 层。它们和 runtime docs 分离，因为 provider 负责 data trust 和 privacy boundary，不负责 Discord 或 Agent 执行行为。

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

- [`../../providers/provider-framework.md`](../../providers/provider-framework.md): provider manifest、health check、dry-run、structured output、fixture coverage 和 compatibility adapter 规则。

## Stock Providers

- [`../../providers/stock/README.md`](../../providers/stock/README.md): stock-provider family map、Futu readonly provider boundary 和 stock data-flow summary。
- [`../../providers/stock/eastmoney.md`](../../providers/stock/eastmoney.md): Eastmoney provider family，合并 JYWG readonly holdings 和 MyFavor watchlist 边界。
- [`../../providers/stock/research.md`](../../providers/stock/research.md): 串联 portfolio、pulse、market-intel 和 watchlist research 的 stock research pipeline。

Stock legacy compatibility stubs:

- [`../../features/06-futu-stock.md`](../../features/06-futu-stock.md): moved into [`../../providers/stock/README.md`](../../providers/stock/README.md#futu-stock-provider).
- [`../../features/10-stock-portfolio-provider.md`](../../features/10-stock-portfolio-provider.md): merged into [`../../providers/stock/research.md`](../../providers/stock/research.md#stock-portfolio).
- [`../../features/11-stock-pulse-provider.md`](../../features/11-stock-pulse-provider.md): merged into [`../../providers/stock/research.md`](../../providers/stock/research.md#stock-pulse).
- [`../../features/14-market-intel-provider.md`](../../features/14-market-intel-provider.md): merged into [`../../providers/stock/research.md`](../../providers/stock/research.md#market-intel).
- [`../../features/18-stock-watchlist-research-provider.md`](../../features/18-stock-watchlist-research-provider.md): merged into [`../../providers/stock/research.md`](../../providers/stock/research.md#stock-watchlist-research).

## Content Providers

- [`../../providers/content.md`](../../providers/content.md): content ingestion provider family，当前是 WeChat MP metadata provider 和 dedupe/data-flow boundary。

Content legacy compatibility stub:

- [`../../features/02-wechat-mp-provider.md`](../../features/02-wechat-mp-provider.md): merged into [`../../providers/content.md`](../../providers/content.md#wechat-mp-provider).

## Email Providers

- [`../../providers/email.md`](../../providers/email.md): Email provider family，合并 shared read-only Email capability、generic `email-query` 和 CMB credit-card email parser 边界。

Email legacy compatibility stubs:

- [`../../features/07-email-capability.md`](../../features/07-email-capability.md): merged into [`../../providers/email.md`](../../providers/email.md#shared-read-only-email-capability).
- [`../../features/08-cmb-credit-card-email-provider.md`](../../features/08-cmb-credit-card-email-provider.md): merged into [`../../providers/email.md`](../../providers/email.md#cmb-credit-card-email-provider).

## Maintenance Rules

- Provider docs 应声明 trusted source、privacy boundary、owner code paths、output schema 和 state/session commit semantics。
- Account/session/cookie 细节保留在 `docs/private/**`；public provider docs 只描述安全边界。
- Website pages 可以总结 provider capabilities，但实现事实必须通过 `source_docs` 回链到 canonical docs。
