# MiniClaw 东方财富 MyFavor 自选股只读源

> Migration note: Eastmoney docs are now grouped under [`docs/providers/stock/eastmoney.md`](../providers/stock/eastmoney.md). This legacy feature doc keeps the detailed MyFavor watchlist implementation notes for one migration cycle.

> 结论：`eastmoney-myfavor` 是东方财富自选股观察池读取层，只服务 `stock-pulse.universe.sources`。它使用 `myfavor.eastmoney.com` 的只读分组和证券列表 endpoint，不和 `jywg.18.cn` 持仓 provider 混用，也不进入 `stock-portfolio`。

## 目标

用户希望 `stock-pulse` 的 A 股 / 港股盘中异动扫描能覆盖东方财富自选股里的海外 ETF 和其他观察标的，但这些标的不是账户持仓，不能被资产日报当作持仓处理。

本能力的目标：

- 读取东方财富自选股分组。
- 读取指定分组里的证券列表。
- 按市场映射到 `us`、`hk`、`cn-a`。
- 把结果作为 `stock-pulse` 的 universe source 候选。

非目标：

- 不读取 `jywg.18.cn` 持仓、资金或交易数据。
- 不写入、删除、移动或编辑自选股。
- 不接入 `stock-portfolio`。
- 不联网补查 ETF 溢价率；溢价率仍只来自 Eastmoney JYWG 持仓层返回的字段。

## 当前实现状态

已落地代码：

```text
src/mcp/eastmoney-myfavor/
  client.ts         # 只读 HTTP client，读取 group/list securities JSONP
  config.ts         # 读取 ~/.miniclaw/providers/eastmoney-myfavor/config.yaml
  safety.ts         # base_url 和 endpoint allowlist
  session-vault.ts  # 0600 cookie session 读取/保存
  types.ts          # 类型定义

scripts/eastmoney-myfavor-login.ts
  # 可见浏览器 bootstrap，保存 myfavor/eastmoney cookie，随后做 group list 只读 health check
```

已提供命令：

```bash
pnpm eastmoney-myfavor:login
```

## 安全边界

允许访问的 endpoint：

```text
/v4/webouter/ggdefstkindexinfos
/v4/webouter/gstkinfos
```

禁止边界：

- 不访问 `jywg.18.cn`。
- 不保存东方财富账号密码。
- 不保存交易密码。
- 不复用日常 Chrome profile 的全量 cookie。
- 不调用新增分组、删除分组、新增证券、删除证券、移动证券等写 endpoint。

session 文件只保存 `myfavor.eastmoney.com`、`.myfavor.eastmoney.com`、`eastmoney.com`、`.eastmoney.com` 相关 cookie，权限必须是 `0600`。

## 配置

全局 profile 配置：

```yaml
# ~/.miniclaw/providers/eastmoney-myfavor/config.yaml
profiles:
  default:
    account_alias: "Eastmoney MyFavor"
    base_url: "https://myfavor.eastmoney.com"
    appkey: "" # 也可通过 MINICLAW_EASTMONEY_MYFAVOR_APPKEY 注入
    session_secret_path: "~/.miniclaw/secrets/eastmoney-myfavor-session.json"
    browser_profile_dir: "~/.miniclaw/browser-profiles/eastmoney-myfavor"
    timeout_ms: 8000
```

`appkey` 可以在 YAML 中留空，以便 disabled source 不阻塞配置解析；真正发请求时必须提供 appkey，否则 fail closed。

`stock-pulse` 接入示例：

```yaml
universe:
  include_sources: true
  sources:
    - type: eastmoney_myfavor_watchlist
      name: eastmoney-cn-watchlist
      market: cn-a
      profile: default
      groups: ["自选股"]
      limit: 80
    - type: eastmoney_myfavor_watchlist
      name: eastmoney-hk-watchlist
      market: hk
      profile: default
      groups: ["港股"]
      limit: 80
```

## 运行时流程

```text
stock-pulse
  -> universe.include_sources=true
  -> eastmoney_myfavor_watchlist source
  -> load ~/.miniclaw/providers/eastmoney-myfavor/config.yaml
  -> load 0600 session secret
  -> GET myfavor group list
  -> GET selected group securities
  -> map by market flag
  -> return universe_source_symbols
```

市场映射：

- `105` / `106` -> `us`
- `116` -> `hk`
- `0` / `1` -> `cn-a`

这些返回值只用于观察池异动扫描。LLM prompt 必须按 `source=universe:*` 识别为观察池，不得输出为账户持仓。

## Bootstrap

首次使用或 session 失效时运行：

```bash
pnpm eastmoney-myfavor:login
```

流程：

1. MiniClaw 打开独立可见浏览器 profile。
2. 用户完成东方财富登录。
3. MiniClaw 周期性用当前 cookie 访问只读 group list。
4. group list 成功后，只保存 Eastmoney myfavor 相关 cookie 到 session vault。

这是一次性登录态 bootstrap，不是手动导出 watchlist；后续 cron 读取自选股应走自动化只读请求。

## 验证

实现覆盖了：

- JSONP payload 解析。
- group list 和 securities list 只读请求。
- appkey 缺失时 fail closed。
- session vault `0600` 权限检查。
- myfavor/eastmoney cookie 过滤。
- Futu / Eastmoney watchlist 到 `stock-pulse` universe symbol 的映射。

验证命令：

```bash
pnpm vitest run src/mcp/eastmoney-myfavor src/providers/stock-pulse/__tests__/watchlist-sources.test.ts
pnpm run quality:docs
pnpm typecheck
```
