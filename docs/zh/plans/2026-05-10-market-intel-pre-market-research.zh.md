---
doc_id: market-intel-pre-market-research-plan
lang: zh
translation_of: docs/plans/2026-05-10-market-intel-pre-market-research.md
translation_status: current
source_sha256: 6214c0d5ffcc0b29e9b1eee886eb4869ccced16137b5ea4c693884fe528af9f9
---
# 市场情报预市场研究自动化

现况:草案
日期: 2026-05-10

## 背景

MiniClaw已经为美国和CN/A/H市场安排了与股票相关的工作,包括上市前、上市后、日内脉冲和日常资产汇总工作。 现在的市场前工作是有用的,但是他们的设计仍然是`stock-portfolio`加上一个巨大的自然语言提示。 这意味着LLM必须在同一步骤中同时收集有关这些事实和理由,这使得报告更难审计,更难复制,更易受到僵化或不一致的网络证据.

目标是将市场前的工作流程升级为持久的市场情报渠道:

```text
cron
  -> market calendar guard
  -> deterministic provider data collection
  -> structured evidence JSON
  -> multi-role LLM analysis
  -> forecast editor synthesis
  -> Discord report
  -> post-market evaluation and calibration
```

关键原则是:Provider代码收集和时间戳证据;证据的LLM理由,必须说明哪些证据支持每个结论。 预算应当用于综合、情景分析和风险评估,而不是用于反复重新发现基本市场事实。

这是只分析的自动化。 它不得发布订单,解锁交易,储存交易密码,生成自动交易指令,或调用任何交易端点.

## 目标

1. 在中国/香港市场每有效交易日开放之前,制作一份深层CN/A/H市场前报告。
2. 在每一有效贸易日,在美国常会开幕前,编写一份深入的美国市场前报告。
3. 采用结构化`market-intel`因此LLM收到时间标记的证据而不是临时的搜索结果。
4. 通过重用保留用户现有组合上下文`stock-portfolio`数据。
5. 将市场方向、branch机会、催化剂和风险观点分为明确的分析角色。
6. 增加最后预测编辑层,将角色输出转换为校准概率和可操作监测点.
7. 储存预测和市场后评价,以便随着时间的推移衡量准确性。
8. 当关键数据来源缺失、陈旧或不一致时,显然没有关闭或降级。
9. 在Discord和LLM可见输出中保留所有账户、经纪人、token、cookie和会话数据,除非现有Provider已经安全编辑。

## 非目标

- 不要建立自动交易系统。
- 不向LLMS披露买卖/订购/解锁工具。
- 不要commit确定性的每日市场预测准确性。
- 不依赖人工输出经纪人数据。
- 不要求用户在每次运行前手动复制数据。
- 当官方或稳定的只读 API 路径存在时,不要刮掉认证的网站。
- 不替换现有`stock-portfolio`, `stock-pulse`、 Futu 或 Eastmoney Provider,除非其目前的边界阻碍这项工作。
- 不将确切的私人资产总额送交公共股票渠道。
- 不评估个人财务适宜性;报告是市场研究和风险监测,而不是个性化投资建议。

## 现有架构证据

相关的 crunon/Runtime文件 :

- `src/cron/types.ts`
  - `CronJobTask`支持`pre_provider`和`pre_provider_config`.
- 一个任务可以在 LLM 提示前注入Provider输出.
- `src/cron/loader.ts`
- 验证 YAML 文件`~/.miniclaw/cron`.
- 拒绝未知Provider通过`isPreProviderName`.
- `src/cron/runner-task.ts`
- 运行`pre_provider`,然后调用`executeTask`.
- 支持Provider附件和Provider 侧跳语义。
- `src/cron/scheduler.ts`
- 安排工作,防止迭代,记录运行状态,重复失败,并发出失败警报。
- `src/providers/index.ts`
- 中央Provider登记处。`market-intel`应在此添加。

现有股票Provider文件 :

- `src/providers/stock-portfolio/*`
- 汇总只读经纪人/Provider数据。
- 计算CNY摘要和最高收益/亏损者。
- 当所有来源都失败时,就可能关闭。
- `src/providers/stock-pulse/*`
- 从5米栏进行日内异常检测
- 将提供方-侧异常检测与LLM解释分离.
- `src/providers/futu-stock/*`
- 现有的只读经纪人路径。
- `src/providers/eastmoney-jywg-readonly/*`
——现有东钱只读路径.

当前用户级 cron 任务 :

- `~/.miniclaw/cron/us-stock-pre-market.yaml`
- 运行在`09:00 America/New_York`工作日时
- 用途`pre_provider: stock-portfolio`.
- `~/.miniclaw/cron/cn-stock-pre-market.yaml`
- 运行在`09:00 Asia/Shanghai`工作日时
- 用途`pre_provider: stock-portfolio`.
- `~/.miniclaw/cron/us-stock-hourly-pulse.yaml`
- 用途`stock-pulse`在美国贸易时间。
- `~/.miniclaw/cron/cn-stock-hourly-pulse.yaml`
- 用途`stock-pulse`CN/HK交易时间。

相关命令 :

```bash
pnpm cron:list
pnpm cron:test us-stock-pre-market
pnpm cron:test cn-stock-pre-market
pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse
pnpm build
```

## 市场时间要求

美国市场:

- NYSE/纳斯达克定期会议通常为东经09:30-16:00 时间
- 建议的市场前报告触发:`08:45 America/New_York`.
- Provider必须应付美国市场节假日、早关和日间休息时间。
- 如果当天是市场假日或提早结束,报告应跳过特别会议或明确标明特别会议名称。

CN/A/H市场:

- A股持续交易窗口一般为09:30-11:30和11:00-15:00 亚洲/上海.
- HKEX证券市场包括9:00-09:30前后的预开业和持续交易9:30-12:00和11:00-16:00 亚洲/香港.
- 建议的报告触发:`08:45 Asia/Shanghai`.
- Provider必须独立支持A股和香港市场假日。 中国和香港的节日日历经常出现分歧.
如果只有A股或HK股开张,报告仍应运行,但明确标注关闭市场。

执行期间核实时间安排和日历的参考来源:

- NYSE时间和日历:https://www.nyse.com/markets/hours-calendars
- Nasdaq市场活动和交易时间参考:https://www.nasdaq.com/market-activity
- HKEX交易时间:https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market
- SSE / SZSE规则和节假日通知在有中国方面的权威参考文献时,应作为中国方面的权威参考.

## 目标分析员

每日报告应使用5个分析家观点和1个编辑。 这些应首先发挥prompt 角色。 它们不需要成为MiniClaw子代理文档,除非后来的执行显示出真正的好处.

### 1. 全球宏观、政策和流动性分析员

职责:

- 美国:美联储、财政部、美元、通货膨胀、劳工数据、FOMC日历、财政/地缘政治冲击。
——中国:PBOC流动性,政策头条,NBS宏观发布,人民币固定和境外人民币移动.
- 产出宏观条件和流动性条件是否为当前风险、中性或风险。

所需证据:

- 经济活动日历。
- 率/产率变动。
- FX运动
- 中央银行或政策头条证据。

### 2. 流动、定位和技术分析员

职责:

- 美国:指数期货,VIX,branchETF前市场方向,广度,重大ETF差距,波动制度.
- CN/A/H:A50,杭生期货,杭生TECH,CNH/CNY,现有南北向/南向线索,ADR/H-share映射,索引技术水平.
- 技术分析必须是流动和定位的次要分析。 仅靠支持/抵抗是不够的。

所需证据:

- 指数/未来/ETF快照。
- 挥霍性快照
- 市场宽度或移动器顶部的快照。
- 如果无法提供实时数据,则中断/丢失数据警告。

### 3. 跨市场branch和主题战略家

职责:

- 确定风险/奖励最高的branch或主题。
- 酌情将美国的主题与CN/A/H的接触相映射,如AI半导体、能源、银行、消费者、保健、房地产链、黄金、国防和新能源。
——将"观察名单机会"与"已经确认的势头"分开.

所需证据:

- branchETF或行业指数移动。
- 新闻/分析支持。
- 如果用户持有相关资产,投资组合暴露影响。

### 4. 盈利、估值和催化分析

职责:

- 跟踪收益、指导、分析员修订、回购、主要公告和高指数加权公司活动。
- 对中国和香港来说,追踪收入预览、交易公告、监管通知、政策敏感公司新闻以及一夜之间ADR运动。
- 解释哪些催化剂可以影响指数,而不是只影响单一名称。

所需证据:

- 收入日历或存档/通知数据。
- 公司新闻或证监会/交换文件链接。
- 指数权重或branch接触。

### 5. 风险、假设和反方观点领导

职责:

- 挑战基案
- 列出预测最可能失败的方式。
- 查明拥挤的贸易、隐藏的宏观风险、政策头条风险、流动性事件、数据释放风险和尾巴风险。
- 要求每个高定罪电话的触发器无效。

所需证据:

- Provider的冒险旗
- 数据警告缺失或陈旧。
- 宏观/活动日历风险。
- 波动或流动性压力信号。

### 6. 预测redactor

职责:

- 合并五个角色视图。
- 明确解决矛盾。
- 将报告转换为概率和监测点。
- 防止无根据的索赔进入最后结论。

产出需求:

- 主要指数的方向概率:
  - `up`
  - `range_bound`
  - `down`
- 在证据不同时将开放方向和全天近距离分开。
- 具有信心和触发力的顶级branch机会。
- 有无效点的风险监视列表。
- 数据质量摘要。

## 最后报告合同

每一份市场前报告应使用这一结构:

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

报告不应注明"买","卖",或"必须交易",除非用户明确要求交易指示. 默认措辞应当以监视列表和风险控制为导向:

- 专注于观察。
- "如果X发生,Y的风险上升。"
- "如果X是伪证, 降低判断的重量。"
- "不建议单独对信号采取行动"

## Provider设计

添加新Provider :

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

登记在:

```text
src/providers/index.ts
```

用户级配置 :

```text
~/.miniclaw/providers/market-intel/us-pre-market.yaml
~/.miniclaw/providers/market-intel/cn-pre-market.yaml
```

### Provider输入配置

建议配置形状 :

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

CN/A/H配置应使用特定市场的符号和来源:

```yaml
market_scope: cn
session: pre_market
timezone: Asia/Shanghai
portfolio_provider_config: cn-stock

watchlists:
  indices:
    - "000001.SS" # SSE Composite, exact provider symbol may differ
    - "399001.SZ" # SZSE Component, exact provider symbol may differ
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

Provider应携带源代码返回JSON。 LLM提示必须需要证据身份证明才能得出结论.

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

推荐原始类型 :

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

## 数据源战略

### 审定摘要

2026-05-10实施前运行验证. 鉴定将官方文献审查与来自这台机器的活端点探测器相结合. 结果改变了执行政策:

- 使用官方或本地认证的只读源作为默认值。
- 将付费/API键源视为可选加速器,而不是基线依赖。
- 仅将无证公共终点视为倒计时,即使它们目前工作。
- 不使用通用的网络搜索作为结构化的市场数据源;只用它来补充从源解调器中发现的新闻。
- 除非有成功的探测器、官方文件或明确的fallback/掩埋物,否则不得使用重要索赔来源。

这台机器的现场探测器

- SEC EDGAR提交材料和公司事实JSON:AAPL可达到和实地验证。
- BLS Public Data API v2:没有小的CPI请求的密钥可达.
- 美国财政部每日收益XML:可达到,包含10Y收益场。
- FRED官方API没有钥匙:被拒绝. FRED 图表 CSV 用于`DGS10`:可达.
- 联邦储备局按RSS和FOMC日历页:可达。
- Cboe VIX历史 CSV:可达. 这是每日历史VIX,不是实时VIX引文来源.
——BBOC开放市场运营页面:可达.
- NBS英语最新版页:可达.
- SSE英语交易日历:可达.
- SZSE的英文日历页不可靠 从节点获取,但官方`szse.cn/api/report/exchange/onepersistenthour/monthList`JSON端点回归2026-05交易日旗.
- HKEX交易时数页面:可达.
- 未来开放健康:可实现`127.0.0.1:11111`; 蟒蛇`futu-api` / `moomoo`软件包可用。
- Futu引文快照探测器:美港快照成功;A-share快照因本机缺少A-share市场数据许可而失败.
- 雅虎图终点:AAPL可以达到,但无证/非官方。
- 东钱`push2`clist end point:可达,但无证/非官方.
- 当地`FRED_API_KEY`, `POLYGON_API_KEY`, `TUSHARE_TOKEN`, `FINNHUB_API_KEY`,以及`ALPHAVANTAGE_API_KEY`: 在验证时未配置 。
- 当地`akshare`和`tushare`Python 包:在验证时未安装.

### 源质量等级

#### A级:默认来源

这些都是足够稳定的一流Provider支持。

- 联邦储备局官方网页/RSS:
- 计量:FOMC日历、政策声明、新闻稿、演讲。
- 访问模式: HTML/RSS 解析。
- Caveat:权威但非干净的JSON API;需要解析器测试和页面形状监测。
- 美国财政部官方信息/财政数据:
- 计量:国库收益曲线和日费率。
- 访问模式:在有数据集终点的地方提供XML种子或财政数据API。
- 尽可能将美国产量而不是FRED作为主要来源。
- BLS 公共数据 API:
- 计量:CPI、PPI、失业率、工资、工资、其他已知的BLS系列身份证。
- 进入模式:JSON API。 小规模的公众要求没有密钥的工作;密钥可以增加限制.
- 证交会EDGAR官方APIs:
- 计量:最近提交的文件,8-K/10-Q/10-K/20-F/6-K,被跟踪公司的XBRL公司事实。
- 访问模式: JSON APIs under`data.sec.gov`; 总是发送已声明的用户代理.
- Cboe官方VIX历史:
- 计量:每日历史VIX关闭/开放/高/低。
- 访问模式:官方CSV.
- Caveat:不要作为现场市场前VIX的唯一来源;如果有的话,与Futu/Polygon/Yahoo引文对应。
- PBOC官方公开市场业务网页:
- 计量:OMO公告、反向还款金额/利率、政策/流动性头条。
- 访问模式:正式的HTML页面.
因为这不是JSON API。
- NBS官方最新发布:
——计量:CPI,PPI,PMI,工业生产,零售,固定资产投资头条/发行.
- 访问模式:正式的HTML发布页面.
- Caveat:用于释放监测和最新的官方值;不假设稳定的英语JSON API.
- SSE官方交易日历:
——计量:上海市场开放/闭市日.
- 访问模式:正式的英文交易时间表页加上静态覆盖缓存。
- SZSE官方交易日JSON:
——计量:深圳交易日旗按月公布.
- 访问模式:`szse.cn/api/report/exchange/onepersistenthour/monthList?month=YYYY-MM`.
- Caveat:保持固定测试和fallback的静态日历,因为英文页面探测器不可靠.
- HKEX官方交易时间/市场日历参考:
- 计量:香港证券交易会议、半天规则、假日/会期规则。
- 访问模式:官方网页加上静态覆盖缓存。
- 未来打开D:
- 计量:US/HK引证快照,通过现有的只读Provider进行本地账户/组合上下文,如果本地允许,则可能提供蜡烛。
- 访问模式:本地OpenD + Python API.
- 校验结果:US/HK快照工作;A-share引号权限在此机上不可用,所以不要让Futu成为默认的CN-A引号源.

#### B级:可选高品质来源

仅在明确配置证书或本地包时才使用 。

- 多边形:
- 计量:美国股票/ETF快照、汇总、市场状况、滴答新闻。
- 质量:良好的API形状和商业市场数据来源。
- 现状:无`POLYGON_API_KEY`已配置 。 不要让它成为基线依赖。
- 弗莱德:
——计量:广义宏观时序.
- 质量:高质量的圣路易斯联邦储备银行官方来源.
- 当前状态:官方API需要API密钥;`FRED_API_KEY`缺少。 公共图CSV作品,可用作部分非临界系列的fallback.
- 图沙尔Pro:
- 计量:CN交易日历、每日市场数据、基本情况、每日基本情况。
- 质量:结构化的API,但有标记/点。
- 现状:无`TUSHARE_TOKEN`未安装软件包。 只有选择权。

#### C级: 仅回落源

这些可以填补空白,但绝不能成为得出高度信任结论的唯一基础。

- 雅虎图终点:
- 验证结果:AAPL图表终点有效。
- 问题:非官方/无记录、限制费率和cookie行为可以改变。
- 允许使用:低请求量的倒数引号/引号,始终标注为`unofficial`.
- 东钱公众`push2`结束点 :
- 验证结果:A-Share clist endpoint奏效。
- 问题:没有官方稳定保障的无证公共终点。
- 允许使用:CN-A引号/扇区/顶部fallback,直到有更好的配置来源;关键结论要求尽可能与另一个来源交叉核对。
- AKShare: - 怎么样?
- 问题:社区包装覆盖许多不同的公共来源;地方包装没有安装。
- 允许使用:开发助手或明确配置回落,而不是生产默认。
- 斯图克:
- 问题:没有正式的API;主要用于历史/爆炸物处理回填。
- 决定:从市场前默认来源列表中删除。 它只能用于背试或固定装置.
- 通用网络搜索:
- 问题:排名不一致,重复合成,来源质量可变。
- 允许使用:只发现补充新闻;每件物品必须经过源头调整并指定新鲜度/重要性。

### 美国资料来源

默认源计划 :

- 日历和届会:
- NYSE/纳斯达克官方网页加静态节假日/早期缓存。
- 比率:
- 美国财政部官员XML/API先行.
- FRED只用于配置或选定图 CSV回落时的额外历史宏序列。
- 通货膨胀/实验室:
- 已知CPI/PPI/就业/工资系列ID的BLS公共数据API。
- 联邦政策:
- 联邦储备局财务监测中心日历、新闻稿和RSS资料。
- 文件和公司催化剂:
- SEC EDGAR提交的信息/公司信息,用于向CIKs绘制的跟踪计数器。
- 波动性:
——Cboe官方VIX历史为日常背景.
- Futu/Polygon/Yahoo 引用源用于当前类似VIX的快照,并带有源质量标签.
- 美国股票/ETF/索引引文:
- 如果允许的话, Futu OpenD 作为本地主设备。
- 如果配置了 API 密钥的话, 多边形 。
- 雅虎图只是回落。

执行优先事项:

1. 市场日历和引文简介。
2. 波动、费率、FX、商品。
3. 经济日历和关键宏观发布。
4. 收益和公司催化剂收集器。
5. branchETF或行业指数变动。
6. 新闻搜索与源代码的分解相退缩。

### CN/A/H 股来源

默认源计划 :

- 日历和届会:
- 上海SSE官方交易时间表.
- SZSE官员`monthList`JSON为深圳.
- HKEX官方网页 加上静态节假日/半天 超载缓存 香港。
- 中国政策/流动性:
- PBOC官方OMO/政策页。
- 中国宏观:
- NBS关于CPI/PPI/PMI/工业生产/零售/FAI的官方最新发布。
- 香港/美国连结的跨市场信号:
- 在允许的情况下,
- HKEX正式参考香港贸易会议和特别会议规则。
- CN-A引文和区/顶级移动器:
- Futu A -share 引用权限不能在这个机器上。
- 仅将Eastmony公用终点作为倒计时标记`unofficial`.
- 偏爱图沙尔 只有在后来配置了token/包装时才会成功 。
- 账户/组合背景:
- 继续使用`stock-portfolio`,它已经汇总了已编辑的Futu和Eastmoney只读账户数据。

执行优先事项:

1. CN/HK日历警卫。
2. A股/HK指数和期货/跨市场快照。
3.人民币/CNH和境外风险信号.
4. PBOC/NBS/政策头条。
5. branch/主题运动。
6. 公司公告和收益预览。

### 不包括默认执行

这些来源不应是默认的首次执行的一部分:

- Stooq负责市场前的现场决策
- AK共享作为生产默认。
- 图沙雷,除非`TUSHARE_TOKEN`配置并测试证明所需的准确终点。
- 多边形,除非`POLYGON_API_KEY`已配置。
- FRED官方API,除非`FRED_API_KEY`被配置; 选中的图 CSV 折返可被非关键历史背景所接受。
- Nasdaq网页作为结构化数据来源。 它们可以是补充参考文献,而不是Provider的投入。

## 计算和预测

Provider应计算确定分数。 LLM应该解释它们,而不是发明它们.

建议的得分范围:`-2` to `+2`.

市场层面:

- `macro_score`
——率,FX,政策,经济数据惊喜.
- `flow_score`
——指数期货,跨市场线索,ETF运动,广度,若有南北向线索,则采用南北向线索.
- `volatility_score`
- VIX或局部波动代词。
- `sector_breadth_score`
- 积极/消极branch的数目和实力。
- `earnings_catalyst_score`
- 主要收益/催化剂的净效应。
- `data_quality_score`
- 惩罚陈旧或缺失的关键来源。

预测redactor将证据和分析观点转换为概率 :

```text
up_probability + range_probability + down_probability = 100%
```

规则:

- 指数概率不应超过70%,除非至少有三个独立证据组对齐。
- 如果引文数据停滞,最大置信度会封顶。
- 如果在开放之前或之后不久尚未公布主要数据,就必须降低信心。
- branch机会至少需要两个证据小组,例如:`price/flow + catalyst`, or `macro + earnings`, or `portfolio exposure + sector momentum`.
- 每一个高自信branch的机会都需要一个失效触发器。

## 持久性和评价

在第一个Provider/报告原型工程之后添加预测持久性。

建议的表:

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

评价尺度:

- 方向命中率:
- 占优势的概率桶是否与最终指数运动相符?
- 打开缺口:
- 报告是否正确预测了开放方向?
- 全天近距离攻击:
- 报告是否正确地预测了接近的方向?
-布莱尔得分:
- 衡量概率校准,而不仅仅是是/否正确。
- branch打击率:
- 选定的branch/主题是否超过了相关基准?
- 风险触发质量:
- 冒着危险吗?
- 假阳性过度了吗?
- 数据质量相关性:
- 将低信任度报告与实际误差率相比较。

上市后的工作可以评估晨报,

```text
Today forecast:
- Index direction: miss/hit
- Sector calls: 2/4 hit
- Biggest missed factor:
- Data issue:
- Prompt/scoring adjustment candidate:
```

## Cron 配置计划

更新现有工作,而不是创建重复。

US:

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

CN/A/H:

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

日历行为 :

- 如果所有相关市场关闭,Provider将返回`skipTask`可以选择的安静跳过。
- 如果只关闭部分市场,Provider运行并标注开放/封闭市场拆分。
- 如果批量引用收藏失败, 除非另作配置, Provider无法关闭此任务 。
- 如果新闻/学习收藏失败,Provider可以继续发出警告。

## 快速协议

紧急提示应执行这项协议:

1. 读`data_quality`先说
2. If `run_context.calendar_status=closed`,只输出一个短暂的封闭市场状态,除非Provider明确表示要继续。
3. 利用各角色,以便:
- 宏观、政策和流动性
- 流动、定位和技术
- 跨市场区主题( T)
- 盈利、估值和催化剂
- 风险、情景和魔鬼律师
4. 每个角色必须列出:
- 结论
- 证据身份证明
- 自信吗?
- 是什么会改变它的观点?
5. 预测redactor必须产生最终概率。
6. 任何无根据的索赔都必须标为假设而非事实。
7. 不得输出账户ID、原始代理有效载荷、token、cookie、verification key、电话号码或会话数据。
8. 不建议自动交易。

## 执行计划

### 第 0 阶段：规划和固定设计

1. 增加本计划文件。
2. 在写入Provider代码之前验证源质量和现场端点可用性。
3. 定义`MarketIntelPayload`美国和CN的固定实例。
4. 决定该机上可运行零触动的初始数据源列表.
5. 确认美国/CN/HK在无需人工登录的情况下可获得的报价来源。

退出标准 :

- 计划是`docs/plans`.
- 对初步计划进行审查。
- 源选择是明确的,而不是隐藏在提示中。
- 低质量或未配置的源被排除在默认或标记fallback/可选性之外。

### 第 1 阶段：Provider Skeleton

1. 创建`src/providers/market-intel/`.
2. 增加配置加载器和验证。
3. 增加日历警卫。
4. 增加返回固定式结构化部分的占位器收集器。
5. registryProvider`src/providers/index.ts`.
6. 添加配置、日历和格式化测试。

退出标准 :

- `pnpm vitest run src/providers/market-intel`通过。
- 提供商可以通过Cron测试固定装置援引。
- 缺少配置失败, 有明显的错误 。

### 第 2 阶段：组合整合

1. 打电话`stock-portfolio`内部`market-intel`何时`portfolio_provider_config`已经设定。
2. 保 留`stock-portfolio`警告和数据质量。
3. 确保纽约市摘要在Provider产出中较早出现,以避免截断。
4. 增加脱敏测试,防止broker secret或账户识别信息泄露。

退出标准 :

- 美国和CN市场-英特尔配置可以包括组合上下文。
- 如果组合部分失败, 可以在配置允许时继续报告 。
- 如果所有需要的组合源都失败,则Provider失效。

### 第 3 阶段：市场快照收集器

1. 安装引文快照收集器。
2. 增加美国指数/未来/ETF/波动/速率/FX/商品监视列表支持。
3. 增加CN/A/H指数/跨市场/branch观察清单支持。
4. 增加按采集器类型分类的陈旧数据检测。
5. 增加确定分数计算。

退出标准 :

- Provider生产`market_snapshot`和`scores`.
- 存储/缺失数据可见于`data_quality`.
- 测试涵盖部分引文失败和陈旧数据。

### 第 4 阶段：宏观、政策、新闻、收益和文件

1. 在可行的情况下增加美国官方宏观收集器:
- 联邦储备委员会/联邦渔业监测委员会参考文件。
- 国库利率
- FRED/BLS配置了 API 路径,如果有密钥可用或公用端点工作.
- 证交会EDGAR公司/履带符号的过滤器。
2. 增加CN/HK官方或耐用收集器:
- PBOC政策/流动性头条。
- NBS发布头条/数据。
- 在可行的情况下发布SSE/SZSE/HKEX公告。
3. 添加回落网络/新闻收集器,并加源代码和最大项目封顶。
4. 增加重要评分和证据标识。

退出标准 :

- 提供商可以提供宏观/新闻/学习证据,而无需LLM进行第一通道的发现。
- 每件证据都有`id`, `source`, `captured_at`和新鲜。
- 测试涵盖源故障和除尘。

### 第 5 阶段：快速升级

1. 最新情况`~/.miniclaw/cron/us-stock-pre-market.yaml`.
2. 最新情况`~/.miniclaw/cron/cn-stock-pre-market.yaml`.
3. 用角色协议和预测编辑合同取代单分析提示。
4. 使产出侧重于指导、触发因素、风险和数据质量。
5. 在这一阶段不要改变市场后或小时脉冲工作。

退出标准 :

- `pnpm cron:list`装入两个任务。
- `pnpm cron:test us-stock-pre-market`运行到控制测试中的 Discord。
- `pnpm cron:test cn-stock-pre-market`运行到控制测试中的 Discord。

### 第 6 阶段：预测持久性

1. 添加`market_forecasts`表在Provider输出后稳定。
2. 持久性Provider payload和最后报告文本。
3. 从 LLM 输出中提取结构化预测项目,或要求 LLM 在结尾产生一个紧凑的 JSON 块.
4. 添加只读命令或脚本检查最近的预测.

退出标准 :

- 每份市场前报告都有持久的预测记录。
- 储存预测包含指数概率和branch/风险呼叫。
- 除了现有的已脱敏的Provider数据外,没有私人broker secret。

### 第 7 阶段：市场后评价

1. 扩大市场后工作岗位或增加评价Provider。
2. 获取关闭/开放式基准数据。
3. 分数指数方向、branch呼吁和风险触发因素。
4. 写评价行。
5. 在市场后Discord产出中增加一个简短的校准说明.

退出标准 :

- 预测在市场关闭后得分。
——每周评论可以显示命中率,布赖尔分数,常见错失原因,以及数据质量相关性.

### 第 8 阶段：校准循环

1. 审查一周的预测/评价数据。
2. 调整积分加权。
3. 在出现无根据索赔时,加强prompt 规则。
4. 增加特定来源的可靠性权重。
5. 记录已知弱点。

退出标准 :

- 报告的质量通过测量校准提高,而不是通过快速猜测。
- 频繁的假阳性/假阴性是可见的和可操作的。

## 验证计划

静态检查 :

```bash
pnpm lint
pnpm typecheck
pnpm build
```

单位测试 :

```bash
pnpm vitest run src/providers/market-intel
pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse
```

硬盘检查 :

```bash
pnpm cron:list
pnpm cron:test us-stock-pre-market
pnpm cron:test cn-stock-pre-market
```

commit/push 前的质量门:

```bash
pnpm run quality:commit
pnpm run quality:push
```

手动检查 :

- 确认在美国/CN库存渠道正确的Discord输出区。
- 确认报告从组合影响开始。
- 确认分析branch引用了证据身份证明
- 确认没有出现原始账户 ID、token、cookie、verification key、电话号码或broker session。
- 确认关闭日或标签正确。
- 确认已失效的数据警告是可见的。
- 确认最后预测概率和100%。

固定方案:

- 正常的美国交易日
- 普通CN/HK交易日。
-美国市场节日
- 中国假日,但香港开放。
- 香港假期,但A股营业。
- 我们很早就接近了
- 白天拯救过渡周。
引文来源部分断电.
- 消息源中断了
- 组合Provider部分故障。
- 所有所需数据源都失效。
- 大型大型活动日
- 主要收入沉重的日子。

## 风险和缓解

### 风险:LLM致幻市场数据

缓解:

- 要求提供事实索赔的证据身份证明。
- 在提供商JSON中输入关键数字数据。
- 明确标记无支持的语句作为假设.
- 惩罚在Provider产出中没有发明符号、价格或催化剂的产出。

### 风险: 陈旧或延迟数据

缓解:

- 每个数据点都需要`captured_at`和`stale`.
- 当关键数据停滞时,信任就会被封杀。
- 数据质量摘要必须载入每份报告。

### 风险:来源外流

缓解:

- 层层源回落。
- 关键引号/日历故障未关闭。
- 继续对非关键新闻/学习失败发出警告。

### 风险:假日日历错误

缓解:

- 使用明确的日历固定装置。
- 在用户级Provider配置中保持市场专用日历配置。
- 增加CN/HK差和美国早期关闭的测试。

### 风险:私人数据泄露

缓解:

- 重新使用现有已脱敏的股票Provider。
- 添加脱敏测试`market-intel`.
- 绝不直接输出原始源有效载荷。
- 准确的资产汇总仅限于私人渠道。

### 风险:过度自信的预测

缓解:

- 基于证据一致性的概率上限。
- 预测redactor必须包括下方和无效触发器。
——市场后布赖尔分数轨迹校准.

### 风险:市场开放前太慢

缓解:

- 触发器在08: 45而不是09: 00。
- 运行收集器与每个来源的超时。
- 新闻和文件记录
- 缓存在适当的时候会延缓官方查询。

## 回滚计划

1. 保持现状`stock-portfolio`Provider不变。
2. 在git历史或备份注释中保留旧的cron快速文本。
3. If `market-intel`生产失败 :
- 变化`pre_provider`返回到`stock-portfolio`.
- 变化`pre_provider_config`返回到`us-stock` or `cn-stock`.
- 恢复更简单的提示
4. 如果Runtime受到影响:
- 仅禁用两个市场前工作。
- 保持小时脉冲和市场后的工作。
5. 如果数据来源泄露敏感数据:
- 马上把收集器关掉
- 添加编辑固定。
- 在重新启用前重新进行Provider测试。

## 文档同步

执行期间需要更新的文件:

- `docs/archive/features/10-stock-portfolio-provider.md`
- 只有当`stock-portfolio`合同变更。
- `docs/archive/features/11-stock-pulse-provider.md`
- 除非抽取共享市场公用事业,否则没有预期的变化。
- 新医生:
  - `docs/archive/features/14-market-intel-provider.md`
- `docs/README.md`
- 实施后增加特征索引条目。
- `CHANGELOG.md`
- 在验证Provider和克龙升级后添加条目。

用户级配置文件应包括:

- 实例`~/.miniclaw/providers/market-intel/us-pre-market.yaml`.
- 实例`~/.miniclaw/providers/market-intel/cn-pre-market.yaml`.
- 数据源设置说明。
- 哪些来源需要API密钥.
- 哪个来源是公开的反弹

## 完成的定义

只有在以下情况下工作才能完成:

1. `market-intel`Provider得到实施和登记。
2. 美国和CN/A/H配置在当地存在,如果包含私人配置,则不commit。
3. 两种市场前工作`market-intel`.
4. Provider产出包含结构化证据、分数、数据质量和组合背景。
5. 最终Discord报告采用5-role加预测redactor协议.
6. 关键索赔引用了证据身份证。
7. 对封闭市场和陈旧数据路径进行测试。
8. 没有经纪人/账户/会议秘密泄露。
9. `pnpm cron:list`, Provider测试, 排字检查, 和建立通行证 。
10. 至少一个受控`pnpm cron:test`每个市场运行成功。
11. 预测持久性和市场后评价要么作为具有明确地位的后续计划加以实施,要么加以跟踪。

## 执行记录

2026-05-10采集的初步规划证据:

- 现有cron系统已经支持`pre_provider`.
- 现有股票工作已经涵盖美国/CN市场前、市场后、日内脉冲和每日摘要。
- 现有`stock-portfolio`是正确的组合上下文基础。
- 现有`stock-pulse`是确定提供方-侧分析的正确模式,然后是LLM解释。
现行市场前报告应升级而不是重复。
- 在Provider实施前完成数据源验证:
- 使用SEC、BLS、财政部、联邦储备局、Cboe历史、PBOC、NBS、SSE、SZSE、HKEX,以及Futu OpenD等原始/默认来源,其衡量覆盖范围与之相符。
- 在本机上使用Futu OpenD作为 US/HK 引文;在 A 共享引文权限可用之前,不要将其作为 CN-A 引文的默认.
- 将FRED API、Polygon和Tushare视为可选的,因为所需证书不是本地配置的。
- 将Yahoo图表和Eastmony公共端点视为只回落点,因为它们是非官方的/无记录的。
- 从默认的市场前源计划中删除Stooq和AKShare。

在执行期间,应在此附上与本计划和最后验证证据的重大偏差。

执行说明:

- 第6阶段在DB chema v7中运出预测持久性:
  - `market_forecasts`, `market_forecast_items`,以及`market_forecast_evaluations`.
  - `src/cron/runner-task.ts`持续`market-intel`有效载荷和提取物`<market_forecast_json>`与最后报告的块。
  - `pnpm market-forecasts`提供只读检查。
- 第7阶段装运`market-forecast-evaluation`:
- 市场后的工作可以参照基准快照评价储存的市场前预测。
- Provider写评价行`commit()`并将校准说明输入市场后报告。
- 当前的基准近距离数据在使用回落数据时使用回落引号路径和标记校准作为临时数据。
- 第8阶段第一次切片运出只读校准循环:
  - `pnpm market-calibration`总结近期的命中率,布赖尔得分,数据质量相关性,源级可靠性权重,弱点,以及建议.
- 第一个切片不自动重写即时规则或源重;它等待足够的评价样品后,才建议减重或升重。

2026-05-10的后续执行说明:

- 第四阶段:
- CN正式备案包括SSE、SZSE和HKEX的公告搜索,这些搜索的终点可以到达。
- 通用的低质量网络/新闻搜索仍然被故意排除在默认之外;新闻路径使用正式的RSS/页面,并标记源失败`data_quality`.
- 风险证据现在由官方宏观/新闻/文件证据和源故障信号确定,而不是返回占位符部分。
- 第七阶段:
  - `market-forecast-evaluation`现在给指数方向、branch机会和风险警报打分。
- 区呼叫与配置的基准/代理标签匹配;未配置区呼叫记录为`unknown`并用一个明显的未标记的警告。
- 根据配置的基准下限-门槛结果,通过市场风险代用对风险警报进行评分。
- 第8阶段缺口关闭:
  - `pnpm market-calibration -- --write-config --min-samples 5`可将Runtime校准规则写入`~/.miniclaw/providers/market-intel/calibration.yaml`.
- Runtime`market-intel`装入此配置并应用Provider-分数权重/信心盖; LLM- facing 源重和即时规则注入有效载荷.
- 在零或评估样本不足的情况下,命令故意跳过书写重量变化。
- Runtime prompt/config 更新:
- 市场前的提示 现在需要预测编辑来纪念`calibration.prompt_rules`和`calibration.source_weights`.
- 市场后提示现在要求将指数/branch/风险校准评注与`score_groups`.
- 美国市场后评价配置现在包括美国branchETF基准;CN配置包括针对现有CN主题的明确的ETF/代理标签。
- 控制式圆柱验证:
  - `MINICLAW_CRON_TEST_RUN_AT`可设置为`pnpm cron:test`因此,周末或假日验证可以运行在已知的交易会话时间戳上而不改变调度器.
