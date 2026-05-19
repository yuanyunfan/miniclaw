---
doc_id: stock-operations-and-security
lang: zh
translation_of: docs/providers/stock/operations-and-security.md
translation_status: current
source_sha256: b615ed416b51916ef927ee1866d98df9bfbc67b355b1495f185ea5247ea977bb
---
# Stock Operations And Security

> 结论：stock operations 应保持 account sessions 隔离，只通过显式命令刷新登录态，遇到 login challenges 必须 fail closed，并且把交易行为排除在 MiniClaw provider surface 之外。

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

自动化场景使用 `pnpm auth:refresh -- --provider eastmoney-jywg --json`。当上游站点要求 QR、captcha、SMS、device confirmation 或完整登录时，`manual_required` 是安全结果。

## Session Boundaries

Futu:

- MiniClaw 通过 official SDK bridge 使用本地 OpenD。
- OpenD 应只监听 `127.0.0.1`。
- MiniClaw 不得保存 Futu account passwords、trading passwords、raw SDK session data、phone numbers 或 full account IDs。

Eastmoney JYWG:

- Session file: `~/.miniclaw/secrets/eastmoney-jywg-session.json`。
- Browser profile: `~/.miniclaw/browser-profiles/eastmoney-jywg`。
- Cookie scope: `jywg.18.cn` / `.18.cn`。
- Refresh command: `pnpm auth:refresh -- --provider eastmoney-jywg`。
- Refresh 读取 `/Trade/Buy`，把 `em_validatekey` 作为 liveness proof，合并 response cookies，推进 `last_verified_at`，并 atomic rewrite `0600` session secret。
- Refresh 不得查询 holdings、orders、deals、totals 或 trading endpoints。

Eastmoney MyFavor:

- Session file: `~/.miniclaw/secrets/eastmoney-myfavor-session.json`。
- Browser profile: `~/.miniclaw/browser-profiles/eastmoney-myfavor`。
- Cookie scope: 仅 MyFavor 和 Eastmoney watchlist domains。
- MyFavor sessions 不能满足 JYWG account behavior，JYWG sessions 也不能满足 MyFavor watchlist behavior。

## Fail-Closed Rules

敏感 stock integrations 必须在以下情况下 fail closed：

- expired sessions
- login redirects
- QR、captcha、SMS 或 device-control challenges
- unexpected page shapes
- unexpected JSON response shapes
- redaction failures
- host 或 endpoint mismatches

Failing closed 表示返回 provider failure、controlled skip 或 `manual_required` action。它不表示绕过 authentication、扩大 cookie scope 或复用 daily browser profile。

## Forbidden Behavior

任何 stock source、provider、report 或 cron task 都不能：

- unlock trading
- place orders
- modify 或 cancel orders
- move funds
- store account passwords 或 trade passwords
- bypass captcha、SMS、QR 或 device confirmation
- expose cookies、tokens、`validatekey`、customer IDs、shareholder IDs、phone numbers 或 full account IDs 到 logs、Discord 或 LLM prompts
- render watchlist symbols as holdings
- use public ETF premium data as proof of account ownership

## Troubleshooting

`manual_required`:

- Cause: upstream site 需要 human-controlled login step。
- Action: 运行对应 source 的 visible login command。
- Safe interpretation: automation 拒绝绕过 authentication。

`market_closed` or skipped pulse:

- Cause: active-window 或 market calendar guard 阻止 collection。
- Action: 改 source code 前先确认相关 provider config 和 cron schedule。

`no_data`:

- Cause: source 没有返回 eligible rows。
- Action: 检查 source 是否 optional、market 是否 closed、configured universe 是否为空。

`partial_data`:

- Cause: optional source 失败，但 product 可以继续。
- Action: 把 warning 保留在 report 中，除非缺失 required source。

`format_drift`:

- Cause: upstream response shape 变化或 parser expectations 过期。
- Action: 增加或更新 fixture，然后修 mapper/parser 并重跑 targeted tests。

`fallback_source`:

- Cause: product 使用了 Yahoo 或其他 fallback source，而不是 preferred source。
- Action: 保持 data-quality downgrade 可见；不要把 fallback calibration 当作强证据。

## Operational Checks

修改 stock workflow 前：

- 识别修改层级：source、standard data、signal、data product 或 cron composition。
- 更新本目录下匹配的 docs。
- 保持 account/watchlist separation。
- 运行 targeted provider tests 和 `pnpm run quality:docs`。
- 对 session changes，还要在 commit 前运行 `pnpm run quality:secrets` 或相关 staged secret scan。
