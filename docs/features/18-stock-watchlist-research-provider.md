# MiniClaw Stock Watchlist Research Provider

> 结论：`stock-watchlist-research` 是券商自选股的深度研究 provider。它读取 `stock-pulse.universe.sources` 中启用的 Futu / Eastmoney MyFavor 自选股源，并用关联的 `stock-portfolio` 配置排除已持仓标的；对应 cron 应推送到独立的 `#daily-watchlist-stock`。

## 目标

用户希望对两个券商账户的 watchlist stock 做“盘前 + 每日”研究，CN 和 US 分开运行。报告需要结合公司基本面、财报/公告、新闻、大盘环境和价格时点，最后给出是否适合当前买入的判断。

本 provider 的目标：

- 从 `stock-pulse` 的 broker watchlist universe source 读取观察池。
- 使用 `stock-pulse` 关联的 `stock-portfolio` 配置做持仓排除，只保留“自选但未买入”的观察标的。
- 为每只股票补充 quote、profile、financials、news evidence。
- 嵌入 `market-intel` 的大盘、宏观、公告和新闻上下文，但强制移除 `portfolio_provider_config`。
- 下游 prompt 使用固定买入时点标签：`worth_small_starter`、`wait_for_pullback`、`not_buyable_now`、`watch_only`。

非目标：

- 不输出持仓数量、账户资产、盈亏、成本价或 broker raw payload。
- 不调用交易 endpoint，不自动下单。
- 不把 watchlist 接到 `stock-portfolio`。
- 不把 Eastmoney MyFavor 和 `jywg.18.cn` 持仓 provider 混用。
- 不把已排除的持仓代码输出给下游报告；持仓集合只用于过滤。

## 运行链路

```text
cron task
  -> pre_provider: stock-watchlist-research
    -> load ~/.miniclaw/providers/stock-watchlist-research/<profile>.yaml
    -> load stock-pulse config
    -> only enabled futu_watchlist / eastmoney_myfavor_watchlist sources
    -> build watchlist-only scan universe
    -> load linked stock-portfolio config and exclude held symbols
    -> Yahoo chart quote snapshot
    -> Yahoo search profile/news
    -> Yahoo fundamentals timeseries
    -> optional market-intel context without portfolio provider
  -> LLM 输出买入时点研究
  -> Discord #daily-watchlist-stock
```

`stock-watchlist-research` 的数据源边界和 `stock-pulse` 一致：

- `futu_watchlist` 通过本机 Futu OpenD + 官方 SDK 读取自选股。
- `eastmoney_myfavor_watchlist` 通过 `myfavor.eastmoney.com` 只读分组和证券列表读取自选股。
- 仅处理 `enabled !== false` 的 broker watchlist source。
- `yahoo_screener`、`eastmoney_clist` 等公开候选源不参与本 provider，避免把市场热榜当成账户 watchlist。

## 输出结构

provider 输出 JSON 的核心字段：

- `run_context.watchlist_only=true`：提示下游报告这是观察池，不是持仓。
- `watchlist_source`：列出启用 broker source 数、拉取数量、扫描数量和 warning。
- `watchlist_source.portfolio_filter`：列出持仓过滤状态、关联 `stock-portfolio` 配置名、持仓符号数和排除数量；不包含被排除的持仓代码。
- `symbols[]`：每只 watchlist 股票的 quote/profile/financials/news。
- `market_context`：来自 `market-intel` 的大盘、宏观、官方新闻、财报/公告上下文。
- `evidence[]`：每只股票 quote/profile/financials/news 的 evidence id。
- `usage_notes[]`：安全边界和买入时点标签约束。

下游报告必须按 evidence id 写事实判断。无 evidence 的结论只能标为低置信观察，不得写成确定性买点。

## Runtime 配置

用户级 provider 配置放在：

```text
~/.miniclaw/providers/stock-watchlist-research/us-pre-market.yaml
~/.miniclaw/providers/stock-watchlist-research/us-daily.yaml
~/.miniclaw/providers/stock-watchlist-research/cn-pre-market.yaml
~/.miniclaw/providers/stock-watchlist-research/cn-daily.yaml
```

示例：

```yaml
market_scope: us
run_type: pre_market
timezone: America/New_York
stock_pulse_config: us-hourly
market_intel_config: us-pre-market
max_symbols: 25

quote:
  interval: 5m
  range: 60d
  include_prepost: true
  timeout_ms: 8000
  concurrency: 4

research:
  enabled: true
  news_count_per_symbol: 3
  timeout_ms: 8000
  concurrency: 3
```

对应 cron 应使用独立频道：

```yaml
channel: "<daily-watchlist-stock channel id>"
pre_provider: stock-watchlist-research
pre_provider_config: us-pre-market
pre_provider_preflight: health
```

## Discord Channel

`scripts/setup-miniclaw-channels.ts` 会确保 `💹 STOCK` 分类下存在 `daily-watchlist-stock`。脚本写入 `~/.miniclaw/channel-map.json` 时会先读取现有映射，再合并新增频道，避免覆盖用户级已有 channel id。

## Prompt 约束

watchlist 研究报告应按 CN / US 分开：

- 盘前报告强调当日交易计划、财报/新闻催化、大盘环境和买入时点。
- 每日报告强调当天变化、基本面/估值边际变化、新闻和是否进入可买区间。
- 每只股票必须输出：业务与基本面、最近财报/公告、新闻催化、大盘背景、价格/技术位置、风险、买入时点结论。
- 买入时点只能使用：值得小仓试探、等回调、暂不适合买、仅观察。
- 这是研究和风险监控，不是交易指令。

## 验证

```bash
pnpm vitest run src/providers/stock-watchlist-research src/providers/__tests__/index.test.ts
pnpm typecheck
pnpm run quality:docs
pnpm provider:health -- --provider stock-watchlist-research --config us-pre-market
pnpm cron:list
```
