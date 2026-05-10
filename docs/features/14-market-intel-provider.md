# MiniClaw Market Intel Provider

> 结论：`market-intel` 把美股和 A/H 盘前报告从“LLM 自己找事实”升级为“provider 先收集结构化证据，LLM 只做多角色推理和 Forecast Editor 综合”。配套的 forecast persistence、post-market evaluation 和 calibration CLI 让每天的预测可以被盘后评分、按周复盘，而不是只依赖主观感觉。

## 目标边界

本能力只做市场研究和风险监控，不做自动交易：

- 不调用下单、解锁、改单、撤单或交易密码相关 endpoint。
- 不把账户号、手机号、cookie、validatekey、token、交易密码或 broker session 暴露给 Discord 或 LLM。
- 不承诺确定性预测准确率；所有概率都是可校准的研究输出。

## 运行链路

```text
cron task
  -> pre_provider: market-intel
    -> market calendar guard
    -> stock-portfolio redacted context
    -> quote snapshot
    -> official macro / policy / filings evidence
    -> deterministic scores + data_quality
  -> 5 analyst roles
  -> Forecast Editor compact JSON
  -> market_forecasts / market_forecast_items
  -> Discord pre-market report
  -> post-market market-forecast-evaluation
  -> market_forecast_evaluations
  -> weekly market-calibration report
```

`market-intel` 的职责是提供可审计事实：每条 evidence 都应有 `id`、`source`、`source_tier`、`captured_at` 和 freshness 信息。LLM 的职责是引用 evidence IDs、提出情景推理、输出概率、触发条件和风险。

## Provider 配置

用户级配置放在：

```text
~/.miniclaw/providers/market-intel/us-pre-market.yaml
~/.miniclaw/providers/market-intel/cn-pre-market.yaml
```

盘前 cron 使用：

```yaml
pre_provider: market-intel
pre_provider_config: us-pre-market
```

或：

```yaml
pre_provider: market-intel
pre_provider_config: cn-pre-market
```

关键配置口径：

- `market_scope`: `us` 或 `cn`。
- `portfolio_provider_config`: 复用 `stock-portfolio` 的 `us-stock` / `cn-stock`。
- `calendar`: 每个市场的 holidays、early closes 和 closed-market skip 策略。
- `watchlists`: indices、sectors、macro、cross_market、symbols。
- `sources`: quote、macro、news、earnings、sector 的 source tier 和 fallback。
- `quality`: stale minutes、quote fail-closed、news partial downgrade。

## 数据源质量

默认采用高稳定性 source；低质量或未配置 source 不进入默认路径：

- Primary / default：SEC、BLS、Treasury、Federal Reserve、Cboe history、PBOC、NBS、SSE、SZSE、HKEX、Futu OpenD。
- Optional：FRED API、Polygon、Tushare，只有本机配置 credentials 后才启用。
- Fallback-only：Yahoo chart、Eastmoney public endpoints，因 unofficial / undocumented，只能用于降级路径并在 `data_quality` 标注。
- Excluded from default：Stooq、AKShare。

当前本机 Futu OpenD 可用于 US / HK quotes；在 A 股 quote permission 可用前，不把 Futu 作为默认 CN-A quote source。

## Analyst Protocol

盘前报告使用五个 analyst role 加一个 Forecast Editor：

- Global Macro, Policy & Liquidity Analyst
- Flow, Positioning & Technical Analyst
- Cross-Market Sector & Theme Strategist
- Earnings, Valuation & Catalyst Analyst
- Risk, Scenario & Devil's Advocate Lead
- Forecast Editor

每个 analyst section 必须输出 conclusion、evidence IDs、confidence 和 what would change its view。Forecast Editor 必须输出 final probabilities、sector opportunities、risk alerts、data quality summary 和 compact JSON：

```text
<market_forecast_json>
{...}
</market_forecast_json>
```

该 JSON 被 `src/cron/runner-task.ts` 提取后写入 `market_forecast_items`，供盘后校准使用。

## Forecast Persistence

DB schema v7 增加三张表：

- `market_forecasts`: 保存 provider payload、最终报告文本和运行上下文。
- `market_forecast_items`: 保存 provider deterministic scores 和 LLM compact JSON 中的 index probabilities、sector calls、risk alerts。
- `market_forecast_evaluations`: 保存盘后 benchmark outcome、hit/miss、Brier score 和 calibration note。

只读查看最近 forecast：

```bash
pnpm market-forecasts -- --limit 10
```

## Post-Market Evaluation

盘后 cron 使用 `market-forecast-evaluation` provider：

```yaml
pre_provider: market-forecast-evaluation
pre_provider_config: us-post-market
```

该 provider 会读取当天同 market scope/session 的最新盘前 forecast，优先用 `llm_report` 的 `index_probability`，如果没有则回退到 provider score；再拉 benchmark latest / previous close 快照，计算：

- actual bucket: `up` / `range_bound` / `down` / `unknown`
- predicted bucket
- hit / miss
- Brier score
- calibration note

如果评价 quote 来自 fallback source，盘后报告必须明确标注 provisional calibration。

## Calibration Loop

Phase 8 的第一版是只读 CLI，不自动改 prompt 或权重：

```bash
pnpm market-calibration
pnpm market-calibration -- --days 14 --market-scope us
pnpm market-calibration -- --format json
```

输出内容：

- totals：forecast 数、已评价 forecast 数、hit/miss、unknown、hit rate、avg Brier。
- by market scope：US 与 CN 分开看。
- by data quality：观察 `ok` / `partial` / `blocked` 与准确率的相关性。
- by forecast source：区分 `llm_report` 与 `provider_score`。
- proposed source reliability weights：样本不足时保持 `1.0`，样本足够后才建议轻微上调或下调。
- weak spots：缺少盘后评价、缺少概率 JSON、缺少 evidence IDs、fallback quote、high Brier。
- recommendations：下一轮该收紧 prompt、等待数据、还是优先补 primary close data。

这一步的原则是先让弱点可见，再根据真实一周样本调整 scoring weights 和 prompt rules。

## 验证

```bash
pnpm vitest run src/providers/market-intel src/providers/market-forecast-evaluation src/store/__tests__/market-forecasts.test.ts
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm cron:list
pnpm market-calibration
```
