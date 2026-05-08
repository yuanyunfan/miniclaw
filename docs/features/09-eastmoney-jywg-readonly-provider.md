# MiniClaw 东方财富 JYWG 只读查询方案

> 结论：MiniClaw 已实现 `eastmoney-jywg-readonly` provider 和 `eastmoney-jywg` MCP server，用于通过 `jywg.18.cn` 的只读查询接口获取东方财富账户资金和持仓快照。实现只保存最小 cookie jar，不保存账号密码或交易密码，不实现任何下单、撤单、申购或批量交易 endpoint。

## 当前实现状态

已落地代码：

```text
src/mcp/eastmoney-jywg/
  client.ts         # 只读 HTTP client：Trade/Buy 解析 validatekey + 查询资金/持仓
  config.ts         # 读取 ~/.miniclaw/providers/eastmoney-jywg-readonly/config.yaml
  mapper.ts         # 东方财富字段 -> 统一账户快照
  redact.ts         # Discord/LLM 输出脱敏
  safety.ts         # 只读 tool 名称、endpoint allowlist、forbidden endpoint 约束
  session-vault.ts  # 读取/保存 0600 cookie session
  server.ts         # stdio MCP server，只注册只读 tools
  types.ts          # 类型定义

src/providers/eastmoney-jywg-readonly/
  index.ts          # cron pre_provider 入口
  config.ts         # 读取 ~/.miniclaw/providers/eastmoney-jywg-readonly/<name>.yaml
  format.ts         # 将 snapshot 格式化为 LLM/Discord 安全上下文
  types.ts          # provider 配置与输出类型

scripts/eastmoney-jywg-login.ts
  # 可见浏览器 bootstrap，用户手动登录后保存 jywg.18.cn cookie
```

已提供命令：

```bash
pnpm eastmoney-jywg:login
pnpm mcp:eastmoney-jywg
```

## 安全边界

默认禁止：

- 保存东方财富账号密码。
- 保存交易密码。
- OCR 自动识别验证码。
- 自动绕过短信、验证码、设备校验或安全控件。
- 使用日常 Chrome profile 的全部 cookie。
- 调用下单、撤单、批量下单、新股申购、可转债申购等交易 endpoint。
- 在日志、Discord、LLM prompt 中输出 cookie、`validatekey`、完整账号、客户号、股东代码。

默认允许：

- 用户通过可见浏览器手动登录 `jywg.18.cn`。
- MiniClaw 只保存 `jywg.18.cn` / `.18.cn` 相关 cookie。
- 每次运行时访问 `/Trade/Buy`，从页面隐藏字段重新解析 `em_validatekey`。
- 调用资金和持仓只读 endpoint。
- 输出脱敏后的账户快照和持仓贡献摘要。

## 配置

全局 profile 配置：

```yaml
# ~/.miniclaw/providers/eastmoney-jywg-readonly/config.yaml
profiles:
  default:
    account_alias: "Eastmoney A"
    base_url: "https://jywg.18.cn"
    session_secret_path: "~/.miniclaw/secrets/eastmoney-jywg-session.json"
    browser_profile_dir: "~/.miniclaw/browser-profiles/eastmoney-jywg"
    snapshot_dir: "~/.miniclaw/providers/eastmoney-jywg-readonly/snapshots"
    redaction: "summary"
    top_positions_limit: 8
    include_orders: false
    include_deals: false
    allow_non_jywg_host: false
    fail_on_login_challenge: true
    show_total_assets: false
```

cron provider 配置：

```yaml
# ~/.miniclaw/providers/eastmoney-jywg-readonly/daily-stock-market.yaml
profile: default
account_alias: "Eastmoney A"
redaction: summary
top_positions_limit: 8
include_account_snapshot: true
include_daily_report: true
include_positions_summary: true
market_session_by_job:
  stock-market-premarket: premarket_0915
  a-share-hk-postmarket: a_hk_postmarket_1515
```

cron 接入：

```yaml
pre_provider: eastmoney-jywg-readonly
pre_provider_config: daily-stock-market
```

股票日报的推荐接入方式是通过 `stock-portfolio` 聚合 provider，同时合并富途和东方财富：

```yaml
pre_provider: stock-portfolio
pre_provider_config: daily-stock-market
```

## 登录态 Bootstrap

首次使用或 session 失效时运行：

```bash
pnpm eastmoney-jywg:login
```

流程：

1. MiniClaw 打开可见浏览器。
2. 用户手动登录 `jywg.18.cn`。
3. MiniClaw 周期性做只读 health check。
4. health check 成功后，只保存目标域名 cookie 到：

```text
~/.miniclaw/secrets/eastmoney-jywg-session.json
```

session 文件权限必须是：

```text
0600 (-rw-------)
```

这表示只有当前系统用户可读写该 cookie 文件。它不是加密，但能避免同机其他用户直接读取。

## 运行时流程

```text
cron task
  -> pre_provider: eastmoney-jywg-readonly
    -> 读取 0600 session secret
    -> GET https://jywg.18.cn/Trade/Buy
    -> 解析 em_validatekey
    -> POST /Com/queryAssetAndPositionV1
    -> POST /Search/GetStockList
    -> 映射为统一 snapshot
    -> 输出脱敏 JSON 给 LLM prompt
```

如果 session 过期、页面跳回登录、遇到验证码/短信/安全控件或 response 结构异常，provider 会 fail closed，cron 会发送 pre_provider 失败提示，不会尝试自动登录。

## 验证

实现覆盖了：

- session vault `0600` 权限检查。
- endpoint allowlist。
- forbidden endpoint 源码扫描。
- `Status=-2` 会话过期处理。
- 登录页 / challenge 识别。
- mock 资金和持仓字段映射。
- 输出脱敏。
- cron pre_provider 注入执行。

验证命令：

```bash
pnpm vitest run src/mcp/eastmoney-jywg src/providers/eastmoney-jywg-readonly
pnpm build
pnpm test
```
