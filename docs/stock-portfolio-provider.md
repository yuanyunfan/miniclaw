# MiniClaw 股票账户聚合 Provider

> 结论：`stock-portfolio` 是股票日报的聚合 `pre_provider`，用于在 LLM 执行前统一拉取多个只读券商 provider 的脱敏账户上下文。当前支持聚合 `futu-stock` 和 `eastmoney-jywg-readonly`，不会直接接触交易密码，也不会暴露任何交易工具。

## 目标

股票日报不应该绑定某一个券商 provider。`stock-portfolio` 的职责是：

- 调用多个已实现的只读 provider。
- 保留每个 provider 的脱敏 JSON 输出。
- 如果某个非必需来源失败，保留其他来源并写入 warning。
- 所有来源都失败时 fail closed。
- 把统一聚合 JSON 拼到 cron task prompt 顶部。

## 配置

```yaml
# ~/.miniclaw/providers/stock-portfolio/daily-stock-market.yaml
continue_on_error: true
fail_if_all_sources_fail: true
sources:
  - provider: futu-stock
    config: daily-stock-market
    label: Futu
    required: false
  - provider: eastmoney-jywg-readonly
    config: daily-stock-market
    label: Eastmoney
    required: false
```

股票日报 cron 使用：

```yaml
pre_provider: stock-portfolio
pre_provider_config: daily-stock-market
```

## 输出结构

```json
{
  "generated_at": "2026-05-08T01:15:00.000Z",
  "source": "stock-portfolio",
  "profile": "daily-stock-market",
  "ok_count": 2,
  "failed_count": 0,
  "sources": [
    {
      "provider": "futu-stock",
      "config": "daily-stock-market",
      "label": "Futu",
      "status": "ok",
      "payload": {}
    },
    {
      "provider": "eastmoney-jywg-readonly",
      "config": "daily-stock-market",
      "label": "Eastmoney",
      "status": "ok",
      "payload": {}
    }
  ],
  "warnings": []
}
```

`payload` 是各 provider 已经脱敏后的输出。聚合层会再次对 error 和嵌套字符串做 token/cookie/account 类字段脱敏。

## 故障策略

- `continue_on_error: true`：某个非必需来源失败时，保留其他来源继续生成日报。
- `required: true`：该来源失败会让整个 provider 失败。
- `fail_if_all_sources_fail: true`：所有来源失败时不调用 LLM，避免生成无数据日报。

## 本地状态

当前本机两个股票日报已切换为：

- `~/.miniclaw/cron/stock-market-premarket.yaml`
- `~/.miniclaw/cron/a-share-hk-postmarket.yaml`

两个任务都使用：

```yaml
pre_provider: stock-portfolio
pre_provider_config: daily-stock-market
```

## 验证

```bash
pnpm vitest run src/providers/stock-portfolio
pnpm build
pnpm test
```
