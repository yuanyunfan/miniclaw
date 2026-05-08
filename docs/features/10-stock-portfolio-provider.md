# MiniClaw 股票账户聚合 Provider

> 结论：`stock-portfolio` 是股票日报的聚合 `pre_provider`，用于在 LLM 执行前统一拉取多个只读券商 provider 的脱敏账户上下文，并在 provider 层计算统一人民币口径盈亏。当前支持聚合 `futu-stock` 和 `eastmoney-jywg-readonly`，不会直接接触交易密码，也不会暴露任何交易工具。

## 目标

股票日报不应该绑定某一个券商 provider。`stock-portfolio` 的职责是：

- 调用多个已实现的只读 provider。
- 保留每个 provider 的脱敏 JSON 输出。
- 基于配置汇率生成 `cny_summary`，包含人民币口径总盈利、总亏损、净盈亏、分币种汇总和 Top gainers/losers。
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

`payload` 是各 provider 已经脱敏后的输出。聚合层会再次对 error 和嵌套字符串做 token/cookie/account 类字段脱敏。Provider 层不会输出完整资金账号、手机号、cookie、validatekey、token、交易密码、完整总资产、持仓数量或持仓市值。

`cny_summary` 的盈亏来自各 provider 的 `positions_summary.pnl_summary` 和 `top_gainers/top_losers`，在 LLM 调用前完成折算。LLM 报告应优先使用该字段，不应自行编造或重算缺失字段。

## 故障策略

- `continue_on_error: true`：某个非必需来源失败时，保留其他来源继续生成日报。
- `required: true`：该来源失败会让整个 provider 失败。
- `fail_if_all_sources_fail: true`：所有来源失败时不调用 LLM，避免生成无数据日报。
- 缺少某个币种的汇率时，该币种会从人民币汇总中排除，并在 `warnings` 中提示。

## 本地状态

当前本机股票日报已拆分为四个任务：

- `~/.miniclaw/cron/us-stock-pre-market.yaml`
- `~/.miniclaw/cron/us-stock-post-market.yaml`
- `~/.miniclaw/cron/cn-stock-pre-market.yaml`
- `~/.miniclaw/cron/cn-stock-post-market.yaml`

旧任务已保留但 disabled：

- `~/.miniclaw/cron/stock-market-premarket.yaml`
- `~/.miniclaw/cron/a-share-hk-postmarket.yaml`

四个新任务都使用：

```yaml
pre_provider: stock-portfolio
```

美股任务使用 `pre_provider_config: us-stock`，A/H 任务使用 `pre_provider_config: cn-stock`。

Discord 输出约定：

- 盘前报告：标题后先展示“我的持仓 / ETF 盘前观察清单”，再展示市场温度、新闻和今日关注点。
- 盘后报告：标题后先展示“我的账户盈亏统计”，再展示 Top5 盈利/亏损、基本面和新闻复盘、今日关注点。

## 验证

```bash
pnpm vitest run src/providers/futu-stock src/providers/eastmoney-jywg-readonly src/providers/stock-portfolio
pnpm build
pnpm test
```
