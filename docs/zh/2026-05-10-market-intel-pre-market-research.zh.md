# 盘前市场情报研究自动化

状态：`draft`
日期：2026-05-10

## 背景

MiniClaw 目前已经有一组股票相关定时任务，覆盖美股和 A 股 / 港股的盘前、盘后、盘中异动扫描以及每日资产汇总。现有盘前任务已经能用，但核心形态仍然是 `stock-portfolio` 加一段很大的自然语言 prompt。这样做的问题是：LLM 每天需要同时完成事实采集和市场推理，导致报告更难审计、更难复现，也更容易受到过期网页信息或不一致搜索结果的影响。

目标是把盘前任务升级成一条长期可运行的 market intelligence pipeline：

```text
cron
  -> 市场日历 guard
  -> provider 确定性采集数据
  -> 结构化 evidence JSON
  -> 多角色 LLM 分析
  -> Forecast Editor 汇总
  -> Discord 报告
  -> 盘后评估与校准
```

核心原则是：**provider 负责采集和时间戳标注证据，LLM 负责基于证据做推理，并且每个重要结论必须能追溯到 evidence id**。Token 应该花在综合判断、情景分析、风险推演和冲突整合上，而不是每天重复搜索基础市场事实。

这条流水线只用于分析和风险监控。它不能下单、不能解锁交易、不能保存交易密码、不能生成自动交易指令，也不能调用任何交易 endpoint。

## 目标

1. 在每个有效交易日中国 / 香港市场开盘前，生成一份深入的 CN/A/H 盘前报告。
2. 在每个有效交易日美股 regular session 开盘前，生成一份深入的 US 盘前报告。
3. 新增结构化 `market-intel` pre-provider，让 LLM 收到带时间戳的 evidence，而不是临时网页搜索结果。
4. 复用现有 `stock-portfolio`，保留用户持仓和 ETF 暴露上下文。
5. 把市场方向、行业机会、事件催化和风险判断拆成明确的分析角色。
6. 增加 Forecast Editor 层，把多个角色观点汇总成概率、触发条件和风险监控点。
7. 持久化 forecast 和盘后 evaluation，长期衡量准确性。
8. 当关键数据源缺失、过期或互相矛盾时，明确 fail closed 或降级输出。
9. 除非已有 provider 完成安全脱敏，否则不要把账号、券商、token、cookie、session 等信息暴露给 Discord 或 LLM。

## 非目标

- 不构建自动交易系统。
- 不向 LLM 暴露买入、卖出、下单、撤单、解锁交易等工具。
- 不承诺每天市场预测一定准确。
- 不依赖手动导出券商数据。
- 不要求用户每天运行前手动复制数据。
- 如果有官方或稳定只读 API 路径，不优先抓取 authenticated 网站页面。
- 除非现有边界阻塞本任务，否则不替换 `stock-portfolio`、`stock-pulse`、Futu 或 Eastmoney provider。
- 不把精确私有资产总额发到公开股票频道。
- 不做个人财务适当性判断；报告是市场研究和风险监控，不是个性化投资建议。

## 现有架构证据

相关 cron / runtime 文件：

- `src/cron/types.ts`
  - `CronJobTask` 已支持 `pre_provider` 和 `pre_provider_config`。
  - task 可以在调用 LLM 前注入 provider 输出。
- `src/cron/loader.ts`
  - 校验 `~/.miniclaw/cron` 下的 cron YAML。
  - 通过 `isPreProviderName` 拒绝未知 provider。
- `src/cron/runner-task.ts`
  - 运行 `pre_provider`，把 provider 文本 prepend 到 task prompt，再调用 `executeTask`。
  - 支持 provider attachments 和 provider-side skip。
- `src/cron/scheduler.ts`
  - 调度 job、防止同名任务重叠运行、记录运行状态、失败重试并发送失败告警。
- `src/providers/index.ts`
  - provider 注册中心，后续需要把 `market-intel` 加到这里。

现有股票 provider：

- `src/providers/stock-portfolio/*`
  - 聚合只读券商 / provider 数据。
  - 计算 CNY 口径 summary、Top gainers 和 Top losers。
  - 所有 source 都失败时可以 fail closed。
- `src/providers/stock-pulse/*`
  - 基于 5m bars 做确定性盘中异动检测。
  - 已经采用“provider 负责检测，LLM 负责解释”的正确模式。
- `src/providers/futu-stock/*`
  - 现有只读 Futu 路径。
- `src/providers/eastmoney-jywg-readonly/*`
  - 现有 Eastmoney 只读路径。

当前用户级 cron jobs：

- `~/.miniclaw/cron/us-stock-pre-market.yaml`
  - 工作日 `09:00 America/New_York` 运行。
  - 当前使用 `pre_provider: stock-portfolio`。
- `~/.miniclaw/cron/cn-stock-pre-market.yaml`
  - 工作日 `09:00 Asia/Shanghai` 运行。
  - 当前使用 `pre_provider: stock-portfolio`。
- `~/.miniclaw/cron/us-stock-hourly-pulse.yaml`
  - 美股交易时段使用 `stock-pulse`。
- `~/.miniclaw/cron/cn-stock-hourly-pulse.yaml`
  - A/H 交易时段使用 `stock-pulse`。

相关命令：

```bash
pnpm cron:list
pnpm cron:test us-stock-pre-market
pnpm cron:test cn-stock-pre-market
pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse
pnpm build
```

## 市场时间要求

### 美股

- NYSE / Nasdaq regular session 通常是美东时间 09:30-16:00。
- 建议盘前报告触发时间：`08:45 America/New_York`。
- provider 必须处理美股假期、提前收盘和 daylight saving time。
- 如果当天是休市或提前收盘，报告必须跳过或明确标注特殊交易日。

参考来源：

- NYSE hours and calendars: https://www.nyse.com/markets/hours-calendars
- Nasdaq market activity and trading hours references: https://www.nasdaq.com/market-activity

### A 股 / 港股

- A 股连续交易通常是北京时间 09:30-11:30、13:00-15:00。
- 港股 securities market 包含 09:00-09:30 左右的 pre-opening，以及 09:30-12:00、13:00-16:00 的 continuous trading。
- 建议盘前报告触发时间：`08:45 Asia/Shanghai`。
- provider 必须分别处理 A 股和港股假期，因为中国内地与香港假期经常不一致。
- 如果 A 股和港股只有一边开市，报告仍可运行，但必须清楚标注 open / closed market split。

参考来源：

- HKEX trading hours: https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market
- SSE / SZSE 规则和节假日公告在实现时应作为中国市场侧的 authoritative references。

## 目标分析角色

日报使用五个分析视角加一个总编。第一阶段先作为 prompt-level roles 实现；只有当后续实现证明有必要时，才拆成 MiniClaw subagent 文件。

### 1. Global Macro, Policy & Liquidity Analyst

职责：

- 美股：Fed、Treasury yields、美元、通胀、就业数据、FOMC calendar、财政和地缘冲击。
- 中国：PBOC 流动性、政策新闻、NBS 宏观发布、人民币中间价、CNH 波动。
- 判断当天宏观和流动性环境对风险偏好是 risk-on、neutral 还是 risk-off。

必须引用的证据：

- 经济事件日历。
- 利率 / 收益率变化。
- FX 变化。
- 央行或政策新闻。

### 2. Flow, Positioning & Technical Analyst

职责：

- 美股：指数期货、VIX、sector ETF 盘前方向、breadth、主要 ETF gap、volatility regime。
- A/H：A50、恒指期货、恒生科技、CNH/CNY、可用时的北向 / 南向线索、ADR/H-share 映射、指数关键技术位。
- 技术分析必须服务于 flow 和 positioning；单独画支撑阻力不够。

必须引用的证据：

- 指数、期货、ETF 快照。
- 波动率快照。
- 可用时的市场宽度或 top mover 快照。
- 如果没有实时数据，必须输出 stale / missing data warning。

### 3. Cross-Market Sector & Theme Strategist

职责：

- 识别当天 risk/reward 最好的 sector 或 theme。
- 把 US theme 映射到 CN/A/H 暴露，例如 AI semiconductors、energy、banks、consumer、healthcare、real estate chain、gold、defense、new energy。
- 区分“观察型机会”和“已经确认的 momentum”。

必须引用的证据：

- sector ETF 或行业指数变化。
- 新闻 / catalyst 支持。
- 如果用户有相关持仓，说明 portfolio exposure impact。

### 4. Earnings, Valuation & Catalyst Analyst

职责：

- 跟踪 earnings、guidance、analyst revisions、buybacks、重大公告、高指数权重公司事件。
- 对中国 / 香港市场，跟踪业绩预告、交易所公告、监管通知、政策敏感公司新闻和隔夜 ADR。
- 区分事件会影响指数、行业，还是只影响单一股票。

必须引用的证据：

- Earnings calendar 或 filing / announcement 数据。
- 公司新闻或 SEC / 交易所 filing 链接。
- 可用时引用指数权重或行业暴露。

### 5. Risk, Scenario & Devil's Advocate Lead

职责：

- 挑战 base case。
- 列出预测最可能失效的路径。
- 识别 crowded trades、hidden macro risk、policy headline risk、liquidity event、data-release risk 和 tail risks。
- 每个高置信度判断都必须有 invalidation trigger。

必须引用的证据：

- provider 给出的 risk flags。
- missing / stale data warnings。
- 宏观 / 事件日历风险。
- 波动率或流动性 stress signals。

### 6. Forecast Editor

职责：

- 汇总五个角色的观点。
- 明确处理冲突。
- 把报告转成概率和监控点。
- 防止没有证据支持的 claims 进入最终结论。

输出要求：

- 主要指数方向概率：
  - `up`
  - `range_bound`
  - `down`
- 当证据不一致时，开盘方向和全天收盘方向分开判断。
- 输出 top sector opportunities，并附 confidence 和 triggers。
- 输出 risk watchlist 和 invalidation points。
- 输出 data quality summary。

## 最终报告结构

每份盘前报告使用以下结构：

```markdown
# US/CN Pre-Market Report - YYYY-MM-DD

## Executive View

- Index probability:
- Risk regime:
- Highest-conviction sector/theme:
- Biggest downside risk:
- Data quality:

## Portfolio Impact First

- Holdings or ETFs most exposed today:
- Positive catalysts:
- Negative catalysts:
- Watch triggers:

## Analyst Panels

### Macro, Policy & Liquidity
### Flow, Positioning & Technical
### Sector & Theme Strategy
### Earnings, Valuation & Catalyst
### Risk & Devil's Advocate

## Forecast Editor Synthesis

- Base case:
- Upside case:
- Downside case:
- Invalidation triggers:

## Sector Opportunities

For each opportunity:
- Theme:
- Evidence:
- Trigger:
- Risk:
- Confidence:

## Risk Alerts

For each alert:
- Risk:
- Evidence:
- Trigger:
- Impact:
- What would reduce the risk:

## Data Quality And Sources

- Fresh sources:
- Stale sources:
- Missing sources:
- Provider warnings:
```

报告默认不能说“买入”“卖出”“必须交易”，除非用户明确要求交易指令。默认表述应该偏 watchlist 和 risk-control：

- “重点观察”
- “若 X 发生，则 Y 风险上升”
- “若 X 被证伪，则降低该判断权重”
- “不建议仅凭该信号行动”

## Provider 设计

新增 provider：

```text
src/providers/market-intel/
  index.ts
  config.ts
  types.ts
  calendar.ts
  scoring.ts
  format.ts
  collectors/
    portfolio.ts
    quotes.ts
    macro.ts
    news.ts
    earnings.ts
    filings.ts
    sector.ts
  __tests__/
    config.test.ts
    calendar.test.ts
    format.test.ts
    scoring.test.ts
    index.test.ts
```

注册位置：

```text
src/providers/index.ts
```

用户级配置：

```text
~/.miniclaw/providers/market-intel/us-pre-market.yaml
~/.miniclaw/providers/market-intel/cn-pre-market.yaml
```

### Provider 输入配置

建议配置形态：

```yaml
market_scope: us # us | cn
session: pre_market
timezone: America/New_York
portfolio_provider_config: us-stock

calendar:
  provider: static_plus_remote
  holidays:
    - "2026-01-01"
  early_closes: []
  fail_on_unknown_trade_date: false

sources:
  quotes:
    us_primary: futu_opend
    hk_primary: futu_opend
    cn_a_primary: eastmoney_public_fallback
    fallback:
      - yahoo_chart_unofficial
    optional_paid:
      - polygon
  macro:
    federal_reserve: official_html_rss
    treasury: official_xml_or_fiscaldata
    bls: official_public_api
    fred: optional_api_key_or_graph_csv
  news:
    provider: official_first_web_fallback
    max_items: 40
  earnings:
    provider: sec_edgar
    max_items: 40
  sectors:
    provider: yahoo_or_polygon

watchlists:
  indices:
    - SPY
    - QQQ
    - IWM
  sectors:
    - XLK
    - XLF
    - XLE
    - XLV
  macro:
    - DXY
    - VIX
    - US10Y
    - WTI
    - GOLD

quality:
  max_stale_minutes:
    quote: 20
    news: 720
    macro: 10080
  fail_if_all_quotes_fail: true
  allow_partial_news: true
```

CN/A/H 配置使用市场特定 symbols 和 sources：

```yaml
market_scope: cn
session: pre_market
timezone: Asia/Shanghai
portfolio_provider_config: cn-stock

watchlists:
  indices:
    - "000001.SS" # SSE Composite，实际 provider symbol 可能不同
    - "399001.SZ" # SZSE Component，实际 provider symbol 可能不同
    - "^HSI"
    - "^HSTECH"
  cross_market:
    - "A50"
    - "CNH"
    - "HSI_FUTURES"
  sectors:
    - semiconductor
    - ai
    - broker
    - real_estate
    - consumer
    - healthcare
    - new_energy
```

### Provider 输出 Schema

Provider 应返回带 source IDs 的 JSON。LLM prompt 必须要求每个结论引用 evidence IDs。

```ts
export interface MarketIntelPayload {
  generated_at: string;
  source: "market-intel";
  profile: string;
  market_scope: "us" | "cn";
  run_context: {
    trade_date: string;
    timezone: string;
    session: "pre_market";
    calendar_status: "open" | "closed" | "partial" | "unknown";
    open_markets: string[];
    closed_markets: string[];
    skip_reason?: string;
  };
  portfolio?: unknown;
  market_snapshot: {
    indices: MarketDataPoint[];
    futures: MarketDataPoint[];
    sector_etfs_or_indices: MarketDataPoint[];
    rates: MarketDataPoint[];
    fx: MarketDataPoint[];
    commodities: MarketDataPoint[];
    volatility: MarketDataPoint[];
  };
  macro_calendar: EvidenceItem[];
  policy_and_liquidity: EvidenceItem[];
  news: EvidenceItem[];
  earnings_and_catalysts: EvidenceItem[];
  sector_signals: SectorSignal[];
  risk_flags: RiskFlag[];
  scores: {
    risk_regime: "risk_on" | "neutral" | "risk_off" | "mixed";
    macro_score: number;
    flow_score: number;
    sector_breadth_score: number;
    volatility_score: number;
    data_quality_score: number;
  };
  data_quality: {
    fresh: string[];
    stale: string[];
    missing: string[];
    warnings: string[];
  };
  usage_notes: string[];
}
```

基础类型：

```ts
export interface MarketDataPoint {
  id: string;
  symbol: string;
  name?: string;
  value?: number;
  change_pct?: number;
  change_abs?: number;
  currency?: string;
  captured_at: string;
  source: string;
  stale: boolean;
}

export interface EvidenceItem {
  id: string;
  title: string;
  summary: string;
  captured_at: string;
  published_at?: string;
  source: string;
  url?: string;
  symbols?: string[];
  sectors?: string[];
  importance: "low" | "medium" | "high";
  freshness: "fresh" | "stale" | "unknown";
}

export interface SectorSignal {
  id: string;
  sector: string;
  direction: "positive" | "neutral" | "negative" | "mixed";
  evidence_ids: string[];
  confidence: number;
}

export interface RiskFlag {
  id: string;
  risk: string;
  severity: "notice" | "alert" | "urgent";
  evidence_ids: string[];
  invalidation?: string;
}
```

## 数据源策略

### 验证摘要

本轮验证在 2026-05-10 实施，包含两层：先确认官方文档或官方入口是否支持对应指标，再从本机做最小 endpoint probe。验证结果改变了后续实现策略：

- 默认只使用官方源或本机已认证的只读源。
- 需要 API key 或付费权限的 source 只作为 optional accelerator，不作为 baseline dependency。
- 没有官方文档的 public endpoint 即使当前可访问，也只能作为 fallback。
- Generic web search 不能作为结构化 market-data source，只能用于补充新闻发现，并且必须做 source dedupe。
- 任何关键结论都不能只依赖未验证、无官方文档或未标注 caveat 的 source。

本机 live probe 结果：

- SEC EDGAR submissions 和 companyfacts JSON：AAPL probe 可访问，字段有效。
- BLS Public Data API v2：无需 key 的小规模 CPI 请求可访问。
- U.S. Treasury daily yield XML：可访问，并包含 10Y yield 字段。
- FRED 官方 API 无 key：被拒绝。FRED graph CSV 的 `DGS10` 可访问。
- Federal Reserve press RSS 和 FOMC calendar page：可访问。
- Cboe VIX history CSV：可访问。它是 daily historical VIX，不是实时 VIX quote source。
- PBOC 公开市场操作页面：可访问。
- NBS English latest releases 页面：可访问。
- SSE English trading calendar：可访问。
- SZSE English calendar page 在 Node fetch 下不稳定，但官方 `szse.cn/api/report/exchange/onepersistenthour/monthList` JSON endpoint 返回了 2026-05 交易日 flags。
- HKEX trading-hours page：可访问。
- Futu OpenD health：`127.0.0.1:11111` 可达；Python `futu-api` / `moomoo` package 可用。
- Futu quote snapshot probe：US / HK 行情 snapshot 成功；A 股 snapshot 因本机没有 A 股行情权限失败。
- Yahoo chart endpoint：AAPL probe 可访问，但它是 unofficial / undocumented。
- Eastmoney `push2` clist endpoint：可访问，但它是 unofficial / undocumented。
- 本机 `FRED_API_KEY`、`POLYGON_API_KEY`、`TUSHARE_TOKEN`、`FINNHUB_API_KEY`、`ALPHAVANTAGE_API_KEY`：验证时均未配置。
- 本机 `akshare` 和 `tushare` Python packages：验证时未安装。

### 数据源质量分层

#### Tier A：默认来源

这些 source 足够稳定，可以进入第一版 provider 默认实现。

- Federal Reserve official pages / RSS：
  - 指标：FOMC calendar、policy statements、press releases、speeches。
  - 访问方式：HTML / RSS parsing。
  - caveat：权威但不是干净 JSON API；需要 parser tests 和页面结构监控。
- U.S. Treasury official feeds / Fiscal Data：
  - 指标：Treasury yield curve 和 daily rates。
  - 访问方式：XML feed 或可用时的 Fiscal Data API endpoint。
  - 作为 US yields 的主源，优先级高于 FRED。
- BLS Public Data API：
  - 指标：CPI、PPI、unemployment rate、payrolls、wages 和其他已知 BLS series IDs。
  - 访问方式：JSON API。小规模 public requests 无需 key；key 可以提高 limit。
- SEC EDGAR official APIs：
  - 指标：recent filings、8-K / 10-Q / 10-K / 20-F / 6-K、tracked companies 的 XBRL company facts。
  - 访问方式：`data.sec.gov` JSON APIs；必须发送明确 User-Agent。
- Cboe official VIX history：
  - 指标：daily historical VIX open / high / low / close。
  - 访问方式：official CSV。
  - caveat：不能作为实时盘前 VIX 的唯一来源；当前 VIX-like snapshot 需要配合 Futu / Polygon / Yahoo quote。
- PBOC official open market operations pages：
  - 指标：OMO announcements、reverse repo amount / rate、policy / liquidity headlines。
  - 访问方式：官方 HTML 页面。
  - caveat：不是 JSON API，parser 必须保守。
- NBS official latest releases：
  - 指标：CPI、PPI、PMI、industrial production、retail sales、fixed asset investment headlines / releases。
  - 访问方式：官方 HTML release pages。
  - caveat：用于 release monitoring 和最新官方值；不要假设有稳定 English JSON API。
- SSE official trading calendar：
  - 指标：上海市场开闭市日期。
  - 访问方式：official English trading schedule page 加 static override cache。
- SZSE official trading-day JSON：
  - 指标：深圳市场按月交易日 flags。
  - 访问方式：`szse.cn/api/report/exchange/onepersistenthour/monthList?month=YYYY-MM`。
  - caveat：English page probe 不稳定，因此需要 fixture tests 和 static fallback calendar。
- HKEX official trading hours / market calendar references：
  - 指标：香港 securities trading sessions、half-day rules、holiday / session rules。
  - 访问方式：official pages 加 static override cache。
- Futu OpenD：
  - 指标：US / HK quote snapshots、本地 account / portfolio context，以及在本地权限允许时的 candles。
  - 访问方式：local OpenD + Python API。
  - 验证结果：US / HK snapshot 可用；本机 A 股行情权限不可用，所以不能把 Futu 作为默认 CN-A quote source。

#### Tier B：可选高质量来源

只有明确配置 credentials 或本地 package 后才使用。

- Polygon：
  - 指标：US stock / ETF snapshots、aggregates、market status、ticker news。
  - 质量：API shape 清晰，属于商业 market-data source。
  - 当前状态：未配置 `POLYGON_API_KEY`，不能作为 baseline dependency。
- FRED：
  - 指标：广泛 macro time series。
  - 质量：Federal Reserve Bank of St. Louis 官方高质量来源。
  - 当前状态：官方 API 需要 API key；本机缺少 `FRED_API_KEY`。Public graph CSV 可作为少量非关键历史序列 fallback。
- Tushare Pro：
  - 指标：CN trading calendar、daily market data、fundamentals、daily basics。
  - 质量：结构化 API，但 token / points gated。
  - 当前状态：无 `TUSHARE_TOKEN`，package 未安装。只能 optional。

#### Tier C：仅 fallback 来源

这些 source 可以补洞，但绝不能作为高置信度结论的唯一依据。

- Yahoo chart endpoint：
  - 验证结果：AAPL chart endpoint 可用。
  - 问题：unofficial / undocumented，rate-limit 和 cookie 行为可能变化。
  - 允许用途：低频 fallback quotes / candles，必须标记为 `unofficial`。
- Eastmoney public `push2` endpoints：
  - 验证结果：A-share clist endpoint 可用。
  - 问题：undocumented public endpoint，没有官方稳定性保证。
  - 允许用途：在更好 source 配好之前，用作 CN-A quotes / sector / top movers fallback；关键结论尽量交叉验证。
- AKShare：
  - 问题：community wrapper，底层是多种异构 public sources；本机 package 未安装。
  - 允许用途：开发辅助或显式配置 fallback，不作为 production default。
- Stooq：
  - 问题：没有官方 API，主要适合 historical / EOD backfill。
  - 决策：从 pre-market default source list 移除，只用于 backtests 或 fixtures。
- Generic web search：
  - 问题：排名不稳定、重复转载多、source quality 变化大。
  - 允许用途：补充新闻发现；每条新闻必须 source-dedupe，并标注 freshness / importance。

### 美股数据源

默认 source plan：

- Calendar 和 session：
  - NYSE / Nasdaq 官方页面加 static holiday / early-close cache。
- Rates：
  - U.S. Treasury official XML / API 优先。
  - FRED 只用于额外 historical macro series，或少量 graph CSV fallback。
- Inflation / labor：
  - BLS Public Data API，使用已知 CPI / PPI / employment / wage series IDs。
- Fed policy：
  - Federal Reserve FOMC calendar、press releases 和 RSS feeds。
- Filings 和 company catalysts：
  - 对 tracked tickers 做 CIK mapping 后，使用 SEC EDGAR submissions / companyfacts APIs。
- Volatility：
  - Cboe official VIX history 用于 daily context。
  - 当前 VIX-like snapshot 使用 Futu / Polygon / Yahoo quote source，并带 source quality label。
- US stock / ETF / index quotes：
  - 如果本地权限覆盖对应 instrument，Futu OpenD 是 local primary。
  - 配置 `POLYGON_API_KEY` 后可使用 Polygon。
  - Yahoo chart 只作为 fallback。

实现优先级：

1. Market calendar 和 quote snapshot。
2. Volatility、rates、FX、commodities。
3. Economic calendar 和关键 macro releases。
4. Earnings 和 company catalyst collector。
5. Sector ETF 或 industry index movement。
6. News search fallback，并做 source deduplication。

### CN/A/H 数据源

默认 source plan：

- Calendar 和 session：
  - SSE official trading schedule 用于上海市场。
  - SZSE official `monthList` JSON 用于深圳市场。
  - HKEX official pages 加 static holiday / half-day override cache 用于香港市场。
- China policy / liquidity：
  - PBOC official OMO / policy pages。
- China macro：
  - NBS official latest releases，用于 CPI / PPI / PMI / industrial production / retail / FAI。
- HK / US-linked cross-market signals：
  - 本地权限允许时，用 Futu OpenD 获取 HK 和 US quotes。
  - HKEX official references 用于 HK trading sessions 和 special-session rules。
- CN-A quotes 和 sector / top movers：
  - 本机 Futu A 股 quote permission 不可用。
  - Eastmoney public endpoints 只能作为 fallback，并标记 `unofficial`。
  - 如果后续配置 Tushare Pro token / package，可优先使用 Tushare。
- Account / portfolio context：
  - 继续使用 `stock-portfolio`，它已经聚合 redacted Futu 和 Eastmoney read-only account data。

实现优先级：

1. CN/HK calendar guard。
2. A 股 / 港股指数和跨市场快照。
3. RMB / CNH 和 offshore risk signals。
4. PBOC / NBS / 政策新闻。
5. Sector / theme movement。
6. 公司公告和业绩预告。

### 默认实现中排除的来源

以下 source 不进入第一版默认实现：

- Stooq：不用于 pre-market live decisions。
- AKShare：不作为 production default。
- Tushare：除非配置 `TUSHARE_TOKEN` 且测试覆盖所需 endpoint。
- Polygon：除非配置 `POLYGON_API_KEY`。
- FRED 官方 API：除非配置 `FRED_API_KEY`；少量 graph CSV 可用于非关键 historical context。
- Nasdaq webpages：不作为结构化数据源，只能作为补充参考。

## Scoring 与 Forecasting

Provider 应计算确定性 scores。LLM 负责解释，不负责凭空创造这些数值。

建议 score 范围：`-2` 到 `+2`。

市场维度：

- `macro_score`
  - rates、FX、policy、economic data surprises。
- `flow_score`
  - index futures、cross-market leads、ETF movement、breadth、可用时的北向 / 南向线索。
- `volatility_score`
  - VIX 或本地 volatility proxies。
- `sector_breadth_score`
  - 正向 / 负向 sector 的数量和强度。
- `earnings_catalyst_score`
  - 重大 earnings / catalysts 的净影响。
- `data_quality_score`
  - 对关键 source stale 或 missing 做惩罚。

Forecast Editor 把证据和角色观点转成概率：

```text
up_probability + range_probability + down_probability = 100%
```

规则：

- 除非至少三个独立 evidence groups 同向，否则单个 index probability 不应超过 70%。
- quote data stale 时，confidence 必须 cap。
- 开盘前或开盘后不久有重大数据发布时，confidence 必须降低。
- Sector opportunity 至少需要两个 evidence groups，例如 `price/flow + catalyst`、`macro + earnings` 或 `portfolio exposure + sector momentum`。
- 每个高置信度 sector opportunity 都必须有 invalidation trigger。

## Forecast 持久化与评估

第一版 provider / report 稳定后，再增加 forecast persistence。

建议 tables：

```sql
CREATE TABLE market_forecasts (
  id TEXT PRIMARY KEY,
  market_scope TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  session TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  calendar_status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  report_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE market_forecast_items (
  id TEXT PRIMARY KEY,
  forecast_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  target TEXT NOT NULL,
  direction TEXT NOT NULL,
  probability REAL,
  confidence REAL,
  evidence_ids_json TEXT,
  invalidation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (forecast_id) REFERENCES market_forecasts(id)
);

CREATE TABLE market_forecast_evaluations (
  id TEXT PRIMARY KEY,
  forecast_id TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  outcome_json TEXT NOT NULL,
  score_json TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (forecast_id) REFERENCES market_forecasts(id)
);
```

Evaluation metrics：

- Direction hit rate：
  - dominant probability bucket 是否匹配最终指数方向。
- Open gap hit：
  - 是否正确预判开盘方向。
- Full-day close hit：
  - 是否正确预判收盘方向。
- Brier score：
  - 衡量概率校准，而不只是对 / 错。
- Sector hit rate：
  - 选出的 sector / theme 是否跑赢相关 benchmark。
- Risk trigger quality：
  - 风险提示是否发生。
  - False positives 是否过多。
- Data quality correlation：
  - 对比低 confidence / 数据质量差的报告与实际 miss rate。

盘后 job 可以评估早上的 forecast，并在 Discord 盘后报告中附一段简短 calibration note：

```text
Today forecast:
- Index direction: miss/hit
- Sector calls: 2/4 hit
- Biggest missed factor:
- Data issue:
- Prompt/scoring adjustment candidate:
```

## Cron 配置计划

更新现有 jobs，不重复创建新任务。

### 美股

```yaml
name: us-stock-pre-market
schedule: "45 8 * * 1-5"
timezone: America/New_York
enabled: true
type: task
channel: "DISCORD_US_STOCK_CHANNEL_ID"
pre_provider: market-intel
pre_provider_config: us-pre-market
prompt: |
  你是我的美股盘前市场研究总编。上方 JSON 来自 `market-intel` provider，
  包含市场日历、行情快照、宏观/政策/财报/新闻/行业/风险证据，以及我的持仓脱敏上下文。
  必须基于 evidence id 输出分析，禁止编造 provider 没有给出的实时数据。
  ...
```

### CN/A/H

```yaml
name: cn-stock-pre-market
schedule: "45 8 * * 1-5"
timezone: Asia/Shanghai
enabled: true
type: task
channel: "DISCORD_CN_STOCK_CHANNEL_ID"
pre_provider: market-intel
pre_provider_config: cn-pre-market
prompt: |
  你是我的 A 股/港股盘前市场研究总编。上方 JSON 来自 `market-intel` provider，
  包含 A/H 市场日历、跨市场行情、政策/宏观/公告/行业/风险证据，以及我的持仓脱敏上下文。
  必须基于 evidence id 输出分析，禁止编造 provider 没有给出的实时数据。
  ...
```

Calendar behavior：

- 如果相关市场全部休市，provider 返回 `skipTask`，可选择静默跳过。
- 如果只有部分市场休市，provider 继续运行并标注 open / closed market split。
- 如果关键 quote collection 失败，除非配置允许，否则 provider fail closed。
- 如果 news / earnings collection 失败，provider 可以继续运行，但必须输出 warnings。

## Prompt Protocol

Cron prompt 应强制执行以下协议：

1. 先读取 `data_quality`。
2. 如果 `run_context.calendar_status=closed`，除非 provider 明确要求继续，否则只输出短状态。
3. 按顺序输出角色分析：
   - Macro, Policy & Liquidity
   - Flow, Positioning & Technical
   - Cross-Market Sector & Theme
   - Earnings, Valuation & Catalyst
   - Risk, Scenario & Devil's Advocate
4. 每个角色必须列出：
   - conclusion
   - evidence IDs
   - confidence
   - what would change its view
5. Forecast Editor 必须输出最终概率。
6. 没有证据支持的 statement 必须标成 hypothesis，不能当作事实。
7. 严禁输出 account IDs、raw broker payloads、tokens、cookies、validatekey、phone numbers 或 session data。
8. 不提供自动交易建议。

## 实施计划

### Phase 0：计划与 Fixture 设计

1. 增加本计划文档。
2. 在写 provider 代码前验证 source quality 和 live endpoint availability。
3. 定义 `MarketIntelPayload` 和 US / CN fixture 示例。
4. 决定第一版可在本机 zero-touch 运行的数据源列表。
5. 确认哪些 quote source 可以无人工登录覆盖 US / CN / HK。

退出标准：

- 计划进入 `docs/plans` 和 `docs/zh`。
- 初版 schema 已 review。
- source choice 清楚写在文档里，而不是藏在 prompt 中。
- 低质量或未配置 source 已从 defaults 排除，或标记为 fallback / optional。

### Phase 1：Provider Skeleton

1. 创建 `src/providers/market-intel/`。
2. 增加 config loader 和 validation。
3. 增加 calendar guard。
4. 增加 placeholder collectors，返回接近 fixture 的结构化 sections。
5. 在 `src/providers/index.ts` 注册 provider。
6. 增加 config、calendar、formatting tests。

退出标准：

- `pnpm vitest run src/providers/market-intel` 通过。
- provider 可以通过 cron test fixture 调用。
- 缺少 config 时输出清晰错误。

### Phase 2：Portfolio Integration

1. 当 `portfolio_provider_config` 存在时，在 `market-intel` 内部调用 `stock-portfolio`。
2. 保留 `stock-portfolio` warnings 和 data quality。
3. 确保 CNY summary 位于 provider 输出靠前位置，避免上下文截断时丢失关键口径。
4. 增加 redaction test，防止 broker secrets 或 account identifiers 泄漏。

退出标准：

- US 和 CN market-intel configs 可以包含 portfolio context。
- 如果 portfolio 部分失败，且配置允许，报告可以继续。
- 如果所有 required portfolio sources 失败，provider fail closed。

### Phase 3：Market Snapshot Collectors

1. 实现 quote snapshot collector。
2. 增加 US index / futures / ETF / volatility / rate / FX / commodity watchlist 支持。
3. 增加 CN/A/H index / cross-market / sector watchlist 支持。
4. 按 collector type 增加 stale data detection。
5. 增加 deterministic score calculation。

退出标准：

- Provider 输出 `market_snapshot` 和 `scores`。
- `data_quality` 中能看到 stale / missing data。
- Tests 覆盖 partial quote failures 和 stale data。

### Phase 4：Macro、Policy、News、Earnings 与 Filings

1. 增加 US 官方 macro collector：
   - Federal Reserve / FOMC references。
   - Treasury rates。
   - 如果 API key 或 public endpoint 可用，接 FRED / BLS。
   - 对 tracked symbols 接 SEC EDGAR company / filing collector。
2. 增加 CN/HK 官方或稳定 collector：
   - PBOC policy / liquidity headlines。
   - NBS release headlines / data。
   - 可行时接 SSE / SZSE / HKEX announcements。
3. 增加 fallback web/news collector，做 source dedupe 和 max item caps。
4. 增加 importance scoring 和 evidence IDs。

退出标准：

- Provider 可以输出 macro / news / earnings evidence，不依赖 LLM 做第一轮 discovery。
- 每个 evidence item 都有 `id`、`source`、`captured_at` 和 freshness。
- Tests 覆盖 source failure 和 dedupe。

### Phase 5：Cron Prompt Upgrade

1. 更新 `~/.miniclaw/cron/us-stock-pre-market.yaml`。
2. 更新 `~/.miniclaw/cron/cn-stock-pre-market.yaml`。
3. 用角色协议和 Forecast Editor contract 替换单一分析师 prompt。
4. 输出聚焦 guidance、triggers、risk 和 data quality。
5. 本阶段不改 post-market 或 hourly pulse jobs。

退出标准：

- `pnpm cron:list` 能加载两个 jobs。
- `pnpm cron:test us-stock-pre-market` 在受控测试中成功发到 Discord。
- `pnpm cron:test cn-stock-pre-market` 在受控测试中成功发到 Discord。

### Phase 6：Forecast Persistence

1. 在 provider 输出稳定后增加 `market_forecasts` tables。
2. 持久化 provider payload 和最终 report text。
3. 从 LLM output 提取 structured forecast items，或要求 LLM 在结尾输出 compact JSON block。
4. 增加只读命令或 script 查看最近 forecasts。

退出标准：

- 每份盘前报告都有 durable forecast record。
- Stored forecast 包含 index probabilities、sector calls 和 risk calls。
- 不存储超过现有 redacted provider data 边界的私有 broker secrets。

### Phase 7：Post-Market Evaluation

1. 扩展 post-market jobs，或增加 evaluation provider。
2. 获取 close / open benchmark data。
3. 评估 index direction、sector calls 和 risk triggers。
4. 写入 evaluation rows。
5. 在盘后 Discord 输出中加入短 calibration note。

退出标准：

- 市场收盘后 forecast 能被评分。
- Weekly review 可以展示 hit rate、Brier score、常见 miss reasons 和 data quality correlation。

### Phase 8：Calibration Loop

1. 审查一周 forecast / evaluation 数据。
2. 调整 scoring weights。
3. 收紧 prompt rules，减少 unsupported claims。
4. 增加 source-specific reliability weights。
5. 文档化已知弱点。

退出标准：

- 报告质量通过可衡量校准提升，而不是靠 prompt 猜测。
- 常见 false positives / false negatives 可见且可行动。

## 验证计划

静态检查：

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Unit tests：

```bash
pnpm vitest run src/providers/market-intel
pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse
```

Cron checks：

```bash
pnpm cron:list
pnpm cron:test us-stock-pre-market
pnpm cron:test cn-stock-pre-market
```

Commit / push 前 quality gates：

```bash
pnpm run quality:commit
pnpm run quality:push
```

人工检查：

- 确认 Discord 输出进入正确的 US / CN 股票频道。
- 确认报告开头是 portfolio impact。
- 确认 analyst sections 引用 evidence IDs。
- 确认没有 raw account IDs、token、cookie、validatekey、phone number 或 broker session 泄漏。
- 确认休市日会跳过或明确标注。
- 确认 stale data warnings 可见。
- 确认最终 forecast probabilities 合计为 100%。

Fixture scenarios：

- 正常美股交易日。
- 正常 CN/HK 交易日。
- 美股假期。
- 中国内地休市但香港开市。
- 香港休市但 A 股开市。
- 美股提前收盘。
- Daylight saving transition week。
- Quote source partial outage。
- News source outage。
- Portfolio provider partial failure。
- 所有 required data sources fail。
- 重大 macro event day。
- Earnings-heavy day。

## 风险与缓解

### 风险：LLM 编造市场数据

缓解：

- 事实性 claims 必须引用 evidence IDs。
- 关键 numeric data 放在 provider JSON。
- Unsupported statements 明确标成 hypothesis。
- 对编造 symbol、price 或 provider 未给出的 catalyst 的输出进行测试和 prompt 约束。

### 风险：数据过期或延迟

缓解：

- 每个 data point 必须有 `captured_at` 和 `stale`。
- 关键数据 stale 时 cap confidence。
- 每份报告必须显示 data quality summary。

### 风险：数据源故障

缓解：

- Tiered source fallback。
- Critical quote / calendar failure 时 fail closed。
- Non-critical news / earnings failure 时继续运行并输出 warnings。

### 风险：假期日历错误

缓解：

- 使用明确 calendar fixtures。
- 市场特定 calendar config 放在用户级 provider config。
- 增加 CN/HK 假期差异和 US early close tests。

### 风险：私有数据泄漏

缓解：

- 复用现有 redacted stock providers。
- 给 `market-intel` 增加 redaction tests。
- 不直接输出 raw source payloads。
- exact asset summary 只允许 private channel。

### 风险：预测过度自信

缓解：

- 根据 evidence alignment 设置 probability caps。
- Forecast Editor 必须包含 downside case 和 invalidation triggers。
- 盘后用 Brier score 跟踪 calibration。

### 风险：开盘前运行太慢

缓解：

- 触发时间从 09:00 提前到 08:45。
- Collectors 并发运行，并为每个 source 设置 timeout。
- 限制 news 和 filings item 数量。
- 对慢速官方引用做合理 cache。

## 回滚计划

1. 保持当前 `stock-portfolio` provider 不变。
2. 保留旧 cron prompt 文本在 git history 或 backup note 中。
3. 如果 `market-intel` 生产运行失败：
   - 把 `pre_provider` 改回 `stock-portfolio`。
   - 把 `pre_provider_config` 改回 `us-stock` 或 `cn-stock`。
   - 恢复较简单的 prompt。
4. 如果 runtime 受影响：
   - 只禁用两个 pre-market cron jobs。
   - 保持 hourly pulse 和 post-market jobs 运行。
5. 如果某个 source 泄漏敏感数据：
   - 立即禁用该 collector。
   - 增加 redaction fixture。
   - 重新运行 provider tests 后再启用。

## 文档同步

实现过程中需要更新：

- `docs/features/10-stock-portfolio-provider.md`
  - 只有 `stock-portfolio` contract 变化时才更新。
- `docs/features/11-stock-pulse-provider.md`
  - 除非抽出共享 market utilities，否则预计无需修改。
- 新增文档：
  - `docs/features/14-market-intel-provider.md`
- `docs/README.md`
  - 实现后增加 feature index entry。
- `CHANGELOG.md`
  - provider 和 cron upgrade 验证完成后增加 entry。

用户级配置文档应包含：

- `~/.miniclaw/providers/market-intel/us-pre-market.yaml` 示例。
- `~/.miniclaw/providers/market-intel/cn-pre-market.yaml` 示例。
- 数据源 setup notes。
- 哪些 source 需要 API keys。
- 哪些 source 只是 public fallback。

## Definition Of Done

只有满足以下条件才算完成：

1. `market-intel` provider 已实现并注册。
2. 本地存在 US 和 CN/A/H configs；如果包含私有配置，不提交到 git。
3. 两个 pre-market cron jobs 都使用 `market-intel`。
4. Provider 输出包含 structured evidence、scores、data quality 和 portfolio context。
5. Discord 最终报告使用 5-role + Forecast Editor protocol。
6. 关键 claims 引用 evidence IDs。
7. Closed-market 和 stale-data 路径有测试。
8. 没有 broker / account / session secrets 泄漏。
9. `pnpm cron:list`、provider tests、typecheck 和 build 通过。
10. 至少一次受控 `pnpm cron:test` 对每个市场成功。
11. Forecast persistence 和 post-market evaluation 已实现，或作为明确 follow-up plan 跟踪。

## 执行备注

2026-05-10 初始规划证据：

- 现有 cron 系统已经支持 `pre_provider`。
- 现有股票 jobs 已覆盖 US/CN pre-market、post-market、intraday pulse 和 daily summary。
- 现有 `stock-portfolio` 是合适的 portfolio context base。
- 现有 `stock-pulse` 是“provider 确定性分析 + LLM 解释”的正确范式。
- 当前 pre-market reports 应该升级，而不是重复创建。
- Provider 实现前已完成数据源验证：
  - SEC、BLS、Treasury、Federal Reserve、Cboe history、PBOC、NBS、SSE、SZSE、HKEX 和 Futu OpenD 在指标覆盖匹配时可作为 primary / default sources。
  - 本机 Futu OpenD 可用于 US / HK quotes；在 A 股 quote permission 可用前，不作为默认 CN-A quote source。
  - FRED API、Polygon、Tushare 因本机未配置必要 credentials，只能 optional。
  - Yahoo chart 和 Eastmoney public endpoints 因 unofficial / undocumented，只能 fallback。
  - Stooq 和 AKShare 已从默认 pre-market source plan 中移除。

实现过程中如果发生偏离，应把 material deviations 和最终验证证据追加到这里。

实施备注：

- Phase 6 已交付 forecast persistence：
  - DB schema v7 增加 `market_forecasts`、`market_forecast_items` 和 `market_forecast_evaluations`。
  - `src/cron/runner-task.ts` 会持久化 `market-intel` payload，并从最终报告提取 compact `<market_forecast_json>`。
  - `pnpm market-forecasts` 提供只读查看。
- Phase 7 已交付 `market-forecast-evaluation`：
  - 盘后 jobs 可以把当天盘前 forecast 和 benchmark snapshot 做方向评分。
  - provider 在 `commit()` 中写入 evaluation rows，并把 calibration note 注入盘后报告上下文。
  - 当前 benchmark close data 使用 fallback quote path；当 fallback 被使用时，报告必须标注 calibration 是 provisional。
- Phase 8 第一版已交付只读 calibration loop：
  - `pnpm market-calibration` 汇总最近 hit rate、Brier score、data-quality correlation、source-level reliability weights、weak spots 和 recommendations。
  - 第一版不自动改 prompt 或 source weights；样本量足够前只做可观测和保守建议。

2026-05-10 追加实现备注：

- Phase 4 缺口补齐：
  - CN official filings 现在包含 SSE、SZSE 和 HKEX public announcement search，前提是对应公开 endpoint 可访问。
  - Generic 低质量 web/news search 仍然不进入默认路径；news 路径使用 official RSS / pages，并在 `data_quality` 中标注 source failure。
  - Risk evidence 现在从 official macro / news / filing evidence 和 source failure signals 中确定性派生，不再返回占位 section。
- Phase 7 缺口补齐：
  - `market-forecast-evaluation` 现在同时评分 index direction、sector opportunities 和 risk alerts。
  - Sector calls 会匹配配置里的 benchmark / proxy label；无法匹配的 sector calls 会记录为 `unknown`，并给出 unmapped warning。
  - Risk alerts 通过 configured benchmarks 是否触发 downside threshold 的 market-risk proxy 做自动评分。
- Phase 8 缺口补齐：
  - `pnpm market-calibration -- --write-config --min-samples 5` 可以把 runtime calibration rules 写入 `~/.miniclaw/providers/market-intel/calibration.yaml`。
  - Runtime `market-intel` 会读取该配置，并对 provider-score 应用 weight / confidence cap；面向 LLM 的 source weights 和 prompt rules 会注入 payload。
  - 如果没有足够 evaluation 样本，命令会有意跳过写入权重变更，不会硬调。
- Runtime prompt / config 更新：
  - 盘前 prompts 现在要求 Forecast Editor 遵守 `calibration.prompt_rules` 和 `calibration.source_weights`。
  - 盘后 prompts 现在要求按 `score_groups` 分别解释 index / sector / risk calibration。
  - US post-market evaluation config 已加入 US sector ETF benchmarks；CN config 已加入可用 CN theme 的 ETF / proxy labels。
- 受控 cron 验收：
  - `pnpm cron:test` 可以通过 `MINICLAW_CRON_TEST_RUN_AT` 指定一个已知交易时段时间戳；这样即使当前是周末或假日，也能跑完整 Discord 验收链路，同时不影响正常 scheduler。
