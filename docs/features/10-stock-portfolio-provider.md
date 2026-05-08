# MiniClaw 股票账户聚合 Provider

> 结论：`stock-portfolio` 是股票日报的聚合 `pre_provider`，用于在 LLM 执行前统一拉取多个只读券商 provider 的脱敏账户上下文，并在 provider 层计算统一人民币口径盈亏。当前支持聚合 `futu-stock` 和 `eastmoney-jywg-readonly`，不会直接接触交易密码，也不会暴露任何交易工具。

## 目标

股票日报不应该绑定某一个券商 provider。`stock-portfolio` 的职责是：

- 调用多个已实现的只读 provider。
- 保留每个 provider 的脱敏 JSON 输出。
- 基于配置汇率生成 `cny_summary`，包含人民币口径总盈利、总亏损、净盈亏、分币种汇总和 Top gainers/losers。
- 可选生成 `asset_summary`，用于 private channel 中输出精确总资产、现金、持仓市值和资产分类汇总。
- 保留持仓/ETF 的 `instrument_type`，用于报告里区分个股和 ETF。
- 如果某个非必需来源失败，保留其他来源并写入 warning。
- 所有来源都失败时 fail closed。
- 把统一聚合 JSON 拼到 cron task prompt 顶部。

## 配置

配置文件放在用户目录，不进入 git。当前推荐按市场拆分为 `us-stock.yaml` 和 `cn-stock.yaml`。

```yaml
# ~/.miniclaw/providers/stock-portfolio/us-stock.yaml
continue_on_error: true
fail_if_all_sources_fail: true
market_scope: us
base_currency: CNY
fx_rates:
  CNY: 1
  USD: 7.10
  HKD: 0.91
fx_rates_as_of: "YYYY-MM-DD"
fx_rates_source: manual-public-fx-snapshot
top_movers_limit: 5
include_cny_summary: true
sources:
  - provider: futu-stock
    config: us-stock
    label: Futu US
    required: false
```

```yaml
# ~/.miniclaw/providers/stock-portfolio/cn-stock.yaml
continue_on_error: true
fail_if_all_sources_fail: true
market_scope: cn
base_currency: CNY
fx_rates:
  CNY: 1
  USD: 7.10
  HKD: 0.91
fx_rates_as_of: "YYYY-MM-DD"
fx_rates_source: manual-public-fx-snapshot
top_movers_limit: 5
include_cny_summary: true
sources:
  - provider: eastmoney-jywg-readonly
    config: cn-stock
    label: Eastmoney CN
    required: false
  - provider: futu-stock
    config: cn-stock
    label: Futu HK
    required: false
```

字段说明：

- `market_scope`: 报告市场范围，当前支持 `all`、`us`、`cn`。
- `base_currency`: 聚合口径，当前股票日报使用 `CNY`。
- `fx_rates`: 一单位源币种折算为 `base_currency` 的汇率，由本机配置显式维护。
- `fx_rates_as_of` / `fx_rates_source`: 报告中必须注明的汇率日期和来源。
- `top_movers_limit`: `cny_summary.top_gainers` / `top_losers` 的最大条数。
- `include_cny_summary`: 关闭后只保留各券商原始脱敏 payload，不生成统一人民币口径汇总。
- `include_asset_summary`: 仅用于可信 private channel。开启后聚合各券商 provider 的 exact `asset_summary`，生成人民币口径总资产、证券市值、现金和分类持仓金额。
- `sources[].include_asset_totals`: 默认为 `true`。设为 `false` 时，该 source 只贡献持仓分类和 Top movers，不贡献账户总资产、证券市值或现金，用于避免同一个券商账户被多个市场 profile 重复计入。
- `sources[].asset_account_label`: 账户汇总行显示名。用于把 `Futu US` 这种主 profile 的账户资产展示为 `Futu` 或 `Futu 合并账户`。

股票日报 cron 使用：

```yaml
pre_provider: stock-portfolio
pre_provider_config: us-stock
```

或：

```yaml
pre_provider: stock-portfolio
pre_provider_config: cn-stock
```

## 输出结构

```json
{
  "generated_at": "2026-05-08T01:15:00.000Z",
  "source": "stock-portfolio",
  "profile": "cn-stock",
  "market_scope": "cn",
  "ok_count": 2,
  "failed_count": 0,
  "cny_summary": {
    "base_currency": "CNY",
    "fx_rates": {
      "CNY": 1,
      "USD": 7.10,
      "HKD": 0.91
    },
    "fx_rates_as_of": "YYYY-MM-DD",
    "fx_rates_source": "manual-public-fx-snapshot",
    "gross_profit_cny": 1234.56,
    "gross_loss_cny": -345.67,
    "net_pnl_cny": 888.89,
    "winners_count": 6,
    "losers_count": 3,
    "flat_count": 1,
    "positions_with_pnl_count": 10,
    "by_currency": [],
    "top_gainers": [],
    "top_losers": [],
    "warnings": []
  },
  "sources": [
    {
      "provider": "futu-stock",
      "config": "cn-stock",
      "label": "Futu HK",
      "status": "ok",
      "payload": {
        "positions_summary": {
          "positions_count": 8,
          "pnl_summary": {},
          "top_positions": [],
          "top_gainers": [],
          "top_losers": []
        }
      }
    },
    {
      "provider": "eastmoney-jywg-readonly",
      "config": "cn-stock",
      "label": "Eastmoney CN",
      "status": "ok",
      "payload": {
        "positions_summary": {
          "positions_count": 8,
          "pnl_summary": {},
          "top_positions": [],
          "top_gainers": [],
          "top_losers": []
        }
      }
    }
  ],
  "warnings": []
}
```

`payload` 是各 provider 输出的结构化上下文。默认 `summary` 配置会隐藏完整总资产和持仓市值；仅 private 汇总任务使用 `exact` 配置采集精确总资产、现金和持仓市值。无论 `summary` 还是 `exact`，聚合层都会再次对 error 和嵌套字符串做 token/cookie/account 类字段脱敏，provider 不应输出完整资金账号、手机号、cookie、validatekey、token、交易密码、客户号或股东号。

`cny_summary` 的盈亏来自各 provider 的 `positions_summary.pnl_summary` 和 `top_gainers/top_losers`，在 LLM 调用前完成折算。该字段只保留可报告的人民币金额字段，例如 `gross_profit_cny`、`gross_loss_cny`、`net_pnl_cny`、`pnl_cny`。`source_currency` 和 `fx_rate_to_cny` 仅用于审计汇率来源，不应作为报告金额单位输出。LLM 报告应优先使用该字段，不应自行编造或重算缺失字段。`pnl_source` 标识盈亏来源：`positions_daily_pnl` 表示可按持仓拆分今日盈亏；`aggregate_pnl_fallback` 表示只拿到账户级今日盈亏，不能生成该账户的持仓级 Top5 今日盈亏。

`asset_summary` 只应在 private channel 的 exact 配置中启用。该字段会在 LLM 调用前按持仓市值和现金余额生成汇总，并且可报告金额全部是人民币字段，例如 `total_assets_cny`、`market_value_cny`、`cash_cny`。聚合输出不会把 source provider 的原币种 `total_assets`、`market_value`、`cash`、`pnl` 等金额字段继续传给 LLM；`sources[].payload` 在资产汇总模式下只保留账户别名、来源币种、汇率和 CNY 后的账户级 P&L 摘要。

同一个券商账户可能需要通过多个市场 profile 查询持仓。例如 Futu HK 和 Futu US 可以拿到不同市场持仓，但 `accinfo_query` 的账户资产可能是同一个综合账户按不同币种折算后的结果。此时只能选择一个 source 贡献账户总资产/现金，其他 source 应设置 `include_asset_totals: false`，否则 `total_assets_cny` 和 `cash_cny` 会重复计算。

资产分类分两层：

- `by_category`：provider 的确定性规则初筛，保留用于回归和粗略校验，跨市场 ETF / 港股 / 美股分类可能不完全符合人工投资分类。
- `holdings_for_classification`：给最终日报 LLM 使用的 CNY 扁平持仓清单，不包含现金，不包含 provider 的初筛类别。

每日资产汇总报告应优先使用 `asset_summary.holdings_for_classification` 和 `asset_summary.classification_guidance` 由 LLM 重新归类，目标类别为：

- `domestic_index`: 国内指数
- `foreign_stock`: 国外个股
- `foreign_index`: 国外指数
- `domestic_stock`: 国内个股
- `bond`: 债券
- `gold`: 黄金

现金不进入上述六类投资分类，应单独展示为现金。

每日资产汇总中的“持仓金额分类”展示规则：

- 大类必须按重新归类后的持仓金额倒序排列，而不是按固定类别顺序排列。
- 每个大类内部必须把每个 ETF / 股票作为单独一行展示，并按该持仓的金额倒序排列。
- 空大类可以省略；现金仍然单独列示，不参与六类投资分类排序。
- 东方财富 `queryAssetAndPositionV1` 可能存在账户参考市值大于可展开逐仓明细市值的情况。MiniClaw 会把这个差额作为 `instrument_type=unclassified_asset_gap` 的“未展开证券市值”对账行输出；日报应单独列示它，不要强行归入六类投资分类。

东方财富字段口径：

- `Search/GetStockList` 的逐仓字段在当前实测中只有 `Ljyk` 等累计/浮动盈亏字段，没有持仓级 `Dryk` 当日盈亏字段。
- `Com/queryAssetAndPositionV1` 返回的账户行内嵌 `positions` 字段，逐仓包含 `Dryk` / `Drykbl`，可用于 Top5 今日盈利/亏损。
- 账户级 `Dryk` 仍作为 fallback；只有逐仓 `Dryk` 缺失时才回退到账户级今日盈亏。

## 故障策略

- `continue_on_error: true`：某个非必需来源失败时，保留其他来源继续生成日报。
- `required: true`：该来源失败会让整个 provider 失败。
- `fail_if_all_sources_fail: true`：所有来源失败时不调用 LLM，避免生成无数据日报。
- 缺少某个币种的汇率时，该币种会从人民币汇总中排除，并在 `warnings` 中提示。

## 本地状态

当前本机股票日报已拆分为六个任务：

- `~/.miniclaw/cron/us-stock-pre-market.yaml`
- `~/.miniclaw/cron/us-stock-post-market.yaml`
- `~/.miniclaw/cron/cn-stock-pre-market.yaml`
- `~/.miniclaw/cron/cn-stock-ing-market.yaml`
- `~/.miniclaw/cron/cn-stock-post-market.yaml`
- `~/.miniclaw/cron/daily-stock-summary.yaml`

所有股票任务都使用：

```yaml
pre_provider: stock-portfolio
```

美股任务使用 `pre_provider_config: us-stock`，A/H 盘前、盘中、盘后任务使用 `pre_provider_config: cn-stock`。

`daily-stock-summary` 使用 `pre_provider_config: daily-stock-summary`，会聚合：

- `futu-stock/daily-stock-summary-hk`
- `futu-stock/daily-stock-summary-us`
- `eastmoney-jywg-readonly/daily-stock-summary`

这些 source config 使用 `redaction: exact` 和 `include_asset_allocation: true`，只应发送到 private Discord channel `#daily-stock-summary`。当前 Futu HK source 是 positions-only，不贡献账户总资产/现金；Futu US source 作为 Futu 合并账户资产口径，避免同一 Futu 账户重复计入。

Discord 输出约定：

- 盘前报告：标题后先展示“我的持仓 / ETF 盘前观察清单”，再展示市场温度、新闻和今日关注点。
- 盘后报告：标题后先展示“我的账户盈亏统计”，再展示 Top5 盈利/亏损、基本面和新闻复盘、今日关注点。
- 每日资产汇总：发送到 private `#daily-stock-summary`，允许展示总资产、现金、证券市值、具体持仓金额和分类占比，但所有金额单位统一使用 CNY/人民币；仍禁止输出账号 ID、手机号、cookie、validatekey、token、交易密码、客户号或股东号。

## 验证

```bash
pnpm vitest run src/providers/futu-stock src/providers/eastmoney-jywg-readonly src/providers/stock-portfolio
pnpm build
pnpm test
```
