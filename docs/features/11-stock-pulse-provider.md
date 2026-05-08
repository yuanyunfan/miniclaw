# MiniClaw Stock Pulse Provider

> 结论：`stock-pulse` 是股票盘中异动扫描 `pre_provider`。它不让 LLM 自己判断行情异常，而是在 provider 层先完成交易时段 guard、候选股票采集、5m bar 频率异常、60m 涨跌幅、日内涨跌幅和 rolling z-score 计算，再把结构化 `alerts` 交给 LLM 解释原因并推送 Discord。

## 目标

本 provider 覆盖四层能力：

- P0：扫描我的持仓和 watchlist。
- P1：只在市场交易时段和北京时间个人活动窗口内执行有效扫描。
- P2：用历史 intraday baseline 判断“涨跌频率超过预期”，不是只看固定涨跌幅。
- P3：支持可配置的 universe source，先从市场 top movers 拉候选，再对候选跑同一套 bar 级异常检测。

## 运行链路

```text
cron task
  -> pre_provider: stock-pulse
    -> 判断 active_window + market sessions
    -> 调 stock-portfolio 采集持仓候选
    -> 合并 watchlist 和 universe sources
    -> Yahoo chart 5m/60d bars
    -> deterministic anomaly scoring
  -> LLM 只解释 alerts[]
  -> Discord #daily-us-stock / #daily-cn-stock
```

`stock-pulse` 默认复用现有 `stock-portfolio`：

```yaml
pre_provider: stock-pulse
pre_provider_config: us-hourly
```

本机已添加两个 hourly cron：

- `~/.miniclaw/cron/us-stock-hourly-pulse.yaml` -> `#daily-us-stock`
- `~/.miniclaw/cron/cn-stock-hourly-pulse.yaml` -> `#daily-cn-stock`

## 配置

用户级配置放在：

```text
~/.miniclaw/providers/stock-pulse/us-hourly.yaml
~/.miniclaw/providers/stock-pulse/cn-hourly.yaml
```

关键字段：

- `market_scope`: `us` 或 `cn`。
- `portfolio_provider_config`: 复用 `stock-portfolio` 的 `us-stock` / `cn-stock`。
- `active_window`: 用户个人活动窗口，当前为北京时间 `09:30` 到次日 `01:00`。
- `markets`: 每个市场的 timezone、交易 session 和可选 `holidays`。
- `universe.include_portfolio`: 是否扫描持仓候选。
- `universe.symbols`: 手动 watchlist。
- `universe.sources`: P3 市场候选源，例如 Yahoo predefined screener 或 Eastmoney clist。
- `quote`: 当前实现使用 Yahoo chart API 拉 5m bars。
- `thresholds`: 按 `stock`、`etf`、`leveraged_etf` 分开设置阈值。

## 异常判定

每只股票会计算：

- `hour_return_pct`: 最近约 60 分钟涨跌幅。
- `day_return_pct`: 当日涨跌幅。
- `abnormal_bar_count`: 最近 60 分钟内异常 5m bar 数量。
- `abnormal_bar_count_expected_p95`: 历史 rolling 60m 窗口异常 bar 数量 p95 后再加保护下限。
- `same_direction_bars`: 最近 60 分钟同方向 5m bar 数。
- `z_score`: 当前 60m 涨跌幅相对历史 60m 波动的 z-score。

默认阈值：

- 普通股票：60m `2%`、日内 `4%`、5m bar `0.6%`、z-score `2`。
- ETF：60m `1%`、日内 `2%`、5m bar `0.35%`、z-score `2`。
- 杠杆 ETF：60m `2%`、日内 `4%`、5m bar `0.8%`、z-score `2.5`。

触发项：

- `hour_move`
- `day_move`
- `abnormal_frequency`
- `one_way_bars`
- `z_score`

严重级别：

- `notice`: 命中一个轻量触发项。
- `alert`: 命中两个及以上触发项。
- `urgent`: z-score 达 urgent 阈值、日内涨跌幅达到普通阈值两倍，或异常 5m bar 数显著超过 expected p95。

## P3 Universe Scan

P3 不是直接让 LLM 全市场搜索。当前实现先用市场 top movers 生成候选，再对候选拉 5m bar 进行同一套异常检测：

- US：Yahoo predefined `day_gainers` / `day_losers`。
- CN/HK：Eastmoney `clist` 候选。

这样可以控制成本和噪音。`universe.max_symbols` 限制每次最多扫描的 symbol 数，默认本机配置为 80。

## 输出约束

LLM 只能分析 `alerts[]` 中的股票。若 `run_context.skipped=true`，只输出跳过原因；若 `alerts=[]`，只输出无异常的简短状态，避免每小时制造长噪音。

所有报告都是分析用途，不生成自动交易指令，不接触交易 endpoint。

## 验证

```bash
pnpm vitest run src/providers/stock-pulse
pnpm build
pnpm cron:list
```
