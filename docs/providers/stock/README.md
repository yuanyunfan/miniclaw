# Stock Provider Family

> Conclusion: stock provider docs describe readonly brokerage/account sources, watchlist sources, market evidence, and research workflows. Account-specific sessions and private brokerage details stay outside public website pages.

## Data Flow

```mermaid
flowchart LR
  Futu[Futu OpenD readonly account / watchlist] --> FutuProvider[futu-stock]
  EastmoneyJYWG[Eastmoney JYWG holdings] --> Eastmoney[Eastmoney family]
  EastmoneyMyFavor[Eastmoney MyFavor watchlist] --> Eastmoney
  FutuProvider --> Portfolio[stock-portfolio]
  Eastmoney --> Portfolio
  FutuProvider --> Pulse[stock-pulse universe]
  Eastmoney --> Pulse
  Portfolio --> Research[stock research pipeline]
  Pulse --> Research
  MarketIntel[market-intel] --> Research
  Research --> Discord[Discord stock channels]
```

## Canonical Docs

- [`eastmoney.md`](eastmoney.md): Eastmoney family boundary for JYWG holdings and MyFavor watchlist.
- [`research.md`](research.md): stock research provider pipeline across portfolio, pulse, market-intel, and watchlist research.

## Futu Stock Provider

Runtime names:

- MCP server: `futu-stock`.
- Cron pre-provider: `futu-stock`.
- Stock-pulse universe source: `futu_watchlist`.

Owner code paths:

```text
src/mcp/futu-stock/
  server.ts        # stdio MCP server with readonly tools
  config.ts        # ~/.miniclaw/providers/futu-stock/config.yaml
  futu-client.ts   # Python bridge to official futu-api / moomoo package
  mapper.ts        # Futu fields -> unified account snapshot
  redact.ts        # prompt/Discord-safe redaction
  safety.ts        # readonly tool and forbidden API checks
  state.ts
  types.ts

src/providers/futu-stock/
  index.ts         # cron pre_provider entry
  config.ts        # ~/.miniclaw/providers/futu-stock/<name>.yaml
  format.ts        # safe context formatter
```

Trusted source:

- Futu / moomoo official OpenAPI through local OpenD.
- OpenD should listen only on `127.0.0.1`.
- MiniClaw talks to OpenD through the official Python SDK bridge; it does not store Futu account password or trading password.

Command:

```bash
pnpm mcp:futu-stock
```

Readonly tools:

- `futu_health_check`
- `futu_get_account_snapshot`
- `futu_get_positions_summary`
- `futu_get_daily_pnl_report`

Forbidden behavior:

- `unlock_trade`
- `place_order`
- `modify_order`
- automatic trading, strategy trading, fund transfer, or any trade-password workflow
- exposing account IDs, phone numbers, tokens, raw SDK session data, or OpenD credentials to logs/Discord/LLM prompts

Provider usage:

```yaml
pre_provider: futu-stock
pre_provider_config: us-stock
```

Stock-pulse universe source usage:

```yaml
universe:
  include_sources: true
  sources:
    - type: futu_watchlist
      name: futu-us-watchlist
      market: us
      profile: us
      groups: ["Favorites"]
      limit: 80
```

Futu watchlist rows are observation-universe symbols. They must not be rendered as account holdings unless they also arrive through a portfolio/account provider payload.

## Provider Boundaries

- Holdings and watchlists are different source types.
- Account providers may feed `stock-portfolio`; watchlist sources may feed `stock-pulse` and watchlist research.
- Provider code should compute deterministic evidence before LLM interpretation.
- Public website pages may summarize stock capabilities, but implementation facts should link back to this directory through `source_docs`.

## Legacy Cleanup

The previous Futu feature stub has been removed after migration. Stock research topics are documented in [`research.md`](research.md).

Verification owner:

```bash
pnpm vitest run src/mcp/futu-stock src/providers/futu-stock
pnpm run quality:docs
pnpm run typecheck
```
