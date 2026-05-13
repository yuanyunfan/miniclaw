# MiniClaw Stock Pulse Provider

> 结论：`stock-pulse` 是股票盘中异动扫描 `pre_provider`。它不让 LLM 自己判断行情异常，而是在 provider 层先完成交易时段 guard、候选股票采集、5m bar 频率异常、60m 涨跌幅、日内涨跌幅和 rolling z-score 计算，再把结构化 `alerts` 交给 LLM 解释原因并推送 Discord。

## 目标

本 provider 覆盖四层能力：

- P0：扫描我的持仓和 watchlist。
- P1：只在市场交易时段和北京时间个人活动窗口内执行有效扫描。
- P2：用历史 intraday baseline 判断“涨跌频率超过预期”，不是只看固定涨跌幅。
- P3：可选支持 universe source，先从市场 top movers 或券商自选股拉候选，再对候选跑同一套 bar 级异常检测；默认按用户配置开启或关闭，避免把非持仓股票误当作账户持仓。

## 运行链路

```text
cron task
  -> pre_provider: stock-pulse
    -> 判断 active_window + market sessions
    -> 调 stock-portfolio 采集持仓候选
    -> 合并手工 watchlist；仅在 include_sources=true 时合并 universe sources
    -> Yahoo chart 5m/60d bars
    -> deterministic anomaly scoring
    -> positions[] 当前盘中持仓快照
  -> LLM 输出 positions[] 快照，只把 alerts[] 当异常列表解释
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

美股 hourly cron 使用两条北京时间表达式覆盖同一个 job：

```yaml
schedule:
  - "30 21-23 * * 1-5" # 周一至周五晚间，对应美股常规交易早盘/午盘
  - "30 0 * * 2-6"     # 周二至周六 00:30，对应前一美股交易日
```

这样保留北京时间周六 00:30 的周五美股扫描，同时避免北京时间周六晚间在美股闭市时触发无意义的 skip 消息。

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
- `universe.include_sources`: 是否启用 P3 市场候选源，默认 `false`。
- `universe.sources`: P3 候选源，例如 Yahoo predefined screener、Eastmoney clist、Futu 自选股或 Eastmoney myfavor 自选股；只有 `include_sources=true` 才会生效。
- `quote`: 当前实现使用 Yahoo chart API 拉 5m bars。
- `thresholds`: 按 `stock`、`etf`、`leveraged_etf` 分开设置阈值。

## 异常判定

每只股票会计算：

- `positions[]`: 所有成功报价的扫描股票，包含 provider 内部分析使用的当前价/价格币种、60m/日内涨跌幅，以及 portfolio 提供的 CNY 盈亏字段；常规持仓快照展示不输出当前价/价格币种。
- `position_groups`: 按 `portfolio.daily_pnl_cny` 分成 `profitable`、`losing`、`flat_or_unknown`；盈利组按日内盈亏从高到低，亏损组按日内亏损从大到小。
- `position_premium_summary`: 从嵌套 `stock-portfolio` payload 透传的 Eastmoney 全持仓溢价字段快照。`stock-pulse` 不判断海外/跨境 ETF；盘中 CN prompt 只从这里筛选海外/跨境 ETF 展示溢价/折价率，且不能联网补查缺失值。
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

P3 不是直接让 LLM 全市场搜索。开启 `universe.include_sources=true` 后，provider 会先用受控源生成候选，再对候选拉 5m bar 进行同一套异常检测：

- US：Yahoo predefined `day_gainers` / `day_losers`。
- CN/HK：Eastmoney `clist` 候选。
- Futu：`futu_watchlist` 通过本机 OpenD + 官方 SDK 读取自选股分组。
- Eastmoney：`eastmoney_myfavor_watchlist` 通过 `myfavor.eastmoney.com` 只读 endpoint 读取东方财富自选股分组。

这适合做“市场异动雷达”和“我的观察池异动”，但不能混入 `stock-portfolio`，也不能被 prompt 解释成真实持仓。`universe.max_symbols` 限制每次最多扫描的 symbol 数。

Universe source 类型：

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
    - type: eastmoney_myfavor_watchlist
      name: eastmoney-cn-watchlist
      market: cn-a
      profile: default
      groups: ["自选股"]
      limit: 80
    - type: yahoo_screener
      name: us-day-gainers
      market: us
      scr_id: day_gainers
      limit: 50
    - type: eastmoney_clist
      name: cn-top-movers
      market: cn-a
      fs: m:0+t:6,m:1+t:2
      limit: 50
```

`futu_watchlist` 和 `eastmoney_myfavor_watchlist` 的共同规则：

- `market` 决定本 source 只接收哪个市场的证券。
- `groups` 可选；未配置时读取所有分组。
- `limit` 限制该 source 返回的最大证券数量。
- 返回值统一写入 `universe_source_symbols`，只作为观察池候选，不带账户资产、盈亏或持仓数量。

Eastmoney myfavor 的特殊规则：

- 它使用 `myfavor.eastmoney.com`，不使用 `jywg.18.cn` 交易后台。
- session vault、endpoint allowlist 和配置文件均独立于 `eastmoney-jywg-readonly`。
- 只读 group/list securities，不实现新增、删除、移动自选股等写操作。

## 输出约束

LLM 只能把 `alerts[]` 当作异常列表。若 `run_context.skipped=true`，只输出跳过原因；若 `alerts=[]`，仍应输出 `position_groups` 中当前盘中持仓快照，说明每只股票涨跌幅和 CNY 盈亏，不展示当前价或价格币种，但不要编造异常原因。

所有报告都是分析用途，不生成自动交易指令，不接触交易 endpoint。

## 验证

```bash
pnpm vitest run src/providers/stock-pulse
pnpm build
pnpm cron:list
```
