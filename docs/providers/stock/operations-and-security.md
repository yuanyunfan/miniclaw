# Stock Operations And Security

> Conclusion: stock operations should keep account sessions isolated, refresh only through explicit commands, fail closed on login challenges, and keep trading actions outside MiniClaw's provider surface.

## Common Commands

Provider and docs verification:

```bash
pnpm run quality:docs
pnpm run typecheck
pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse src/providers/market-intel src/providers/market-context src/providers/market-forecast-evaluation src/providers/stock-watchlist-research
pnpm vitest run src/mcp/futu-stock src/mcp/eastmoney-jywg src/mcp/eastmoney-myfavor src/providers/futu-stock src/providers/eastmoney-jywg-readonly src/providers/eastmoney-etf-premium
```

Account and session tools:

```bash
pnpm mcp:futu-stock
pnpm eastmoney-jywg:login
pnpm eastmoney-myfavor:login
pnpm auth:refresh -- --provider eastmoney-jywg
```

Cron and calibration tools:

```bash
pnpm cron:list
pnpm market-calibration
```

Use `pnpm auth:refresh -- --provider eastmoney-jywg --json` for automation. A `manual_required` result is a safe outcome when the upstream site requires QR, captcha, SMS, device confirmation, or a full login.

## Session Boundaries

Futu:

- MiniClaw uses local OpenD through the official SDK bridge.
- OpenD should listen only on `127.0.0.1`.
- MiniClaw must not store Futu account passwords, trading passwords, raw SDK session data, phone numbers, or full account IDs.

Eastmoney JYWG:

- Session file: `~/.miniclaw/secrets/eastmoney-jywg-session.json`.
- Browser profile: `~/.miniclaw/browser-profiles/eastmoney-jywg`.
- Cookie scope: `jywg.18.cn` / `.18.cn`.
- Refresh command: `pnpm auth:refresh -- --provider eastmoney-jywg`.
- Refresh reads `/Trade/Buy`, parses `em_validatekey` as liveness proof, merges response cookies, advances `last_verified_at`, and atomically rewrites the `0600` session secret.
- Refresh must not query holdings, orders, deals, totals, or trading endpoints.

Eastmoney MyFavor:

- Session file: `~/.miniclaw/secrets/eastmoney-myfavor-session.json`.
- Browser profile: `~/.miniclaw/browser-profiles/eastmoney-myfavor`.
- Cookie scope: MyFavor and Eastmoney watchlist domains only.
- MyFavor sessions must not satisfy JYWG account behavior, and JYWG sessions must not satisfy MyFavor watchlist behavior.

## Fail-Closed Rules

Sensitive stock integrations must fail closed on:

- expired sessions
- login redirects
- QR, captcha, SMS, or device-control challenges
- unexpected page shapes
- unexpected JSON response shapes
- redaction failures
- host or endpoint mismatches

Failing closed means returning a provider failure, controlled skip, or `manual_required` action. It does not mean bypassing authentication, broadening cookie scope, or reusing a daily browser profile.

## Forbidden Behavior

No stock source, provider, report, or cron task may:

- unlock trading
- place orders
- modify or cancel orders
- move funds
- store account passwords or trade passwords
- bypass captcha, SMS, QR, or device confirmation
- expose cookies, tokens, `validatekey`, customer IDs, shareholder IDs, phone numbers, or full account IDs to logs, Discord, or LLM prompts
- render watchlist symbols as holdings
- use public ETF premium data as proof of account ownership

## Troubleshooting

`manual_required`:

- Cause: the upstream site requires a human-controlled login step.
- Action: run the visible login command for that source.
- Safe interpretation: automation refused to bypass authentication.

`market_closed` or skipped pulse:

- Cause: active-window or market calendar guard blocked collection.
- Action: confirm the relevant provider config and cron schedule before changing source code.

`no_data`:

- Cause: source returned no eligible rows.
- Action: check whether the source is optional, whether the market is closed, and whether the configured universe is empty.

`partial_data`:

- Cause: optional source failed but the product can continue.
- Action: keep the warning in the report unless a required source is missing.

`format_drift`:

- Cause: upstream response shape changed or parser expectations are stale.
- Action: add or update a fixture, then fix the mapper/parser and rerun targeted tests.

`fallback_source`:

- Cause: a product used Yahoo or another fallback source instead of a preferred source.
- Action: keep data-quality downgrade visible; do not treat fallback calibration as strong evidence.

## Operational Checks

Before changing a stock workflow:

- Identify the layer being changed: source, standard data, signal, data product, or cron composition.
- Update the matching docs in this directory.
- Preserve account/watchlist separation.
- Run targeted provider tests and `pnpm run quality:docs`.
- For session changes, also run `pnpm run quality:secrets` or the relevant staged secret scan before committing.
