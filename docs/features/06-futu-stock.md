# MiniClaw 富途股票账户只读查询 MCP 方案

> 结论：MiniClaw 可以通过富途官方 OpenAPI + OpenD 实现每日股票账户盈亏查询，并推送到 Discord。实现边界应收敛为一个只读 `futu-stock` MCP server：只暴露账户快照、持仓摘要、成交摘要和每日盈亏报告工具，不暴露任何解锁交易、下单、撤单或资金划拨能力。

## 目标

用户希望 MiniClaw 每天定时获取富途牛牛账户的盈亏情况，并推送到 Discord。

本阶段只做富途查询 MCP，不接入其他券商，不做自动交易，不做浏览器自动化登录，不抓包非公开接口。

核心目标：

- 使用富途官方 OpenAPI。
- 通过本机 OpenD 查询账户数据。
- 提供 MiniClaw 可加载的本地 MCP server。
- 只返回脱敏后的账户快照和盈亏摘要。
- 定时任务可基于 MCP 查询结果生成 Discord 日报。

非目标：

- 不实现任何交易能力。
- 不保存交易密码。
- 不在 `.env`、YAML、SQLite、日志或 Discord 中保存敏感登录态。
- 不让 LLM 直接接触富途账号密码、交易密码、token、cookie。
- 不使用 Playwright 控制富途网页或 App。

## 当前实现状态

已落地的代码：

```text
src/mcp/futu-stock/
  server.ts        # stdio MCP server，注册只读 tools
  config.ts        # 读取 ~/.miniclaw/providers/futu-stock/config.yaml
  futu-client.ts   # 通过 Python bridge 调用官方 futu-api/moomoo 包连接 OpenD
  mapper.ts        # Futu 返回字段 -> 统一快照模型
  redact.ts        # Discord/LLM 输出脱敏
  safety.ts        # 只读 tool 名称与 forbidden API 约束
  state.ts         # 本地 snapshot 读写工具
  types.ts         # 类型定义

src/providers/futu-stock/
  index.ts         # cron pre_provider 入口，固定调用只读 Futu 查询并输出脱敏 JSON
  config.ts        # 读取 ~/.miniclaw/providers/futu-stock/<name>.yaml
  format.ts        # 将 snapshot 格式化为 LLM/Discord 安全上下文
  types.ts         # provider 配置与输出类型
```

已提供命令：

```bash
pnpm mcp:futu-stock
```

当前能力：

- MCP server 可启动。
- `futu_health_check` 可检查 OpenD TCP 连接和 Python `futu-api` / `moomoo` 包是否可用。
- `futu_get_account_snapshot` 可返回脱敏账户快照。
- `futu_get_positions_summary` 可返回脱敏持仓贡献摘要。
- `futu_get_daily_pnl_report` 可返回面向 Discord 日报的脱敏文本。
- `futu-stock` cron `pre_provider` 可在 LLM 任务前采集脱敏账户上下文，并把 JSON 拼到 prompt 顶部。

运行前置：

- 本机已启动 Futu OpenD。
- OpenD 只监听 `127.0.0.1`。
- Python 环境安装官方富途 OpenAPI 包：

```bash
python3 -m pip install futu-api
```

如果使用 moomoo 环境，Python bridge 也会尝试 fallback 到 `moomoo` 包。

## 技术路径

### 富途 OpenAPI 与 OpenD

富途 OpenAPI 不是传统 HTTP REST API。官方架构由两部分组成：

- OpenD：本机或服务器上运行的网关进程，负责连接富途服务器、维护会话、处理行情与交易请求。
- API SDK：业务程序通过 SDK 连接 OpenD，再由 OpenD 转发到富途服务器。

推荐链路：

```text
MiniClaw task
  -> MCP client
  -> futu-stock MCP server
  -> Futu SDK
  -> 127.0.0.1:11111 OpenD
  -> 富途服务器
```

OpenD 的作用：

- 维护富途登录态和服务端连接。
- 给本机程序提供统一 TCP API 入口。
- 处理富途后端协议、鉴权、行情推送、交易查询等细节。
- 让 MiniClaw 不需要直接保存富途账号密码。

安全要求：

- OpenD 只监听 `127.0.0.1`。
- 不暴露到 `0.0.0.0`、局域网 IP 或公网。
- MiniClaw 不配置交易密码。
- MCP server 不调用 `unlock_trade`。

官方参考：

- Futu API Introduction: https://openapi.futunn.com/futu-api-doc/en/intro/intro.html
- Futu API Fee: https://openapi.futunn.com/futu-api-doc/en/intro/fee.html
- Futu Trade API Overview: https://openapi.futunn.com/futu-api-doc/en/trade/overview.html
- Futu Get Account Funds: https://openapi.futunn.com/futu-api-doc/en/trade/get-funds.html
- Futu Get Positions: https://openapi.futunn.com/futu-api-doc/en/trade/get-position-list.html

## 费用判断

基于富途官方费用页：

- 行情：面向中国内地客户，港股 LV2 和 A 股 LV1 行情免费；部分品种需要购买行情卡。
- 交易：通过 Futu API 交易没有额外 API 费用，交易费用与 App 相同。

对本需求的影响：

- 每日账户盈亏查询主要依赖账户资金、持仓、成交、现金流，不应该依赖高频行情。
- 如果只做账户日报，通常不需要额外购买实时行情卡。
- 佣金、平台费、交易所费用仍按富途账户原有收费方案计算。

## 查询接口范围

只读 MCP 需要的富途接口：

- `get_acc_list` / `GetAccList`: 获取账户列表。
- `accinfo_query` / `GetFunds`: 查询账户资金。
- `position_list_query` / `GetPositionList`: 查询持仓。
- `deal_list_query` / `GetOrderFillList`: 查询当日成交。
- `history_deal_list_query` / `GetHistoryOrderFillList`: 查询历史成交。
- `Get Cash Flow Summary`: 查询现金流摘要。

账户资金可用字段：

- `total_assets`: 总净资产。
- `securities_assets`: 证券资产。
- `fund_assets`: 基金资产。
- `cash`: 现金。
- `market_val`: 证券市值。
- `unrealized_pl`: 未实现盈亏。
- `realized_pl`: 已实现盈亏。

持仓可用字段：

- `code`: 证券代码。
- `stock_name`: 证券名称。
- `qty`: 持仓数量。
- `market_val`: 持仓市值。
- `pl_ratio`: 盈亏比例。
- `pl_val`: 盈亏金额。
- `today_pl_val`: 今日盈亏。
- `today_trd_val`: 今日交易金额。
- `unrealized_pl`: 未实现盈亏。
- `realized_pl`: 已实现盈亏。
- `currency`: 币种。

## 严禁接口

富途 OpenAPI 同时包含交易能力，所以 MCP server 必须在代码层和测试层禁止交易方法。

严禁实现或调用：

- `unlock_trade`: 解锁交易。
- `place_order`: 下单。
- `modify_order`: 改单或撤单。
- 任何自动交易、策略交易、资金划拨或交易解锁逻辑。

安全判断：

- 只要系统保存交易密码，并允许调用 `unlock_trade`，就存在未经授权交易风险。
- 本方案不保存交易密码，不解锁交易，不暴露交易工具。
- LLM 即使被 prompt injection 诱导，也只能调用 MCP server 暴露的只读查询工具。

## MCP Server 设计

### Server 名称

建议 MCP server 名称：

```text
futu-stock
```

MiniClaw 可通过现有 MCP 配置继承机制加载该 server，并在 allowlist 中显式允许它。

### 工具列表

只暴露以下 tools：

```text
futu_health_check
futu_get_account_snapshot
futu_get_positions_summary
futu_get_daily_pnl_report
```

工具职责：

- `futu_health_check`: 检查 OpenD 是否可连接、SDK 是否可用、是否能查询账户列表。
- `futu_get_account_snapshot`: 返回脱敏账户资金快照。
- `futu_get_positions_summary`: 返回脱敏持仓摘要和主要盈亏贡献。
- `futu_get_daily_pnl_report`: 返回面向 LLM/Discord 的日报输入文本。

不暴露：

- 下单工具。
- 撤单工具。
- 改单工具。
- 解锁交易工具。
- 原始账号查询工具。
- 原始 token/session/cookie 查询工具。

### 输入参数

`futu_get_daily_pnl_report` 建议参数：

```json
{
  "profile": "default",
  "account_alias": "Futu HK",
  "market_session": "hk_close",
  "redaction": "summary",
  "top_positions_limit": 5
}
```

字段说明：

- `profile`: 本地配置 profile 名称，不是账号密码。
- `account_alias`: 展示用账户别名，不是完整资金账号。
- `market_session`: 报告口径，例如 `hk_close`、`us_close`。
- `redaction`: 脱敏级别，默认 `summary`。
- `top_positions_limit`: 输出主要贡献/拖累持仓数量。

### 输出模型

MCP 内部可以构建完整结构化快照，但返回给 LLM 的结果必须脱敏。

内部快照示例：

```json
{
  "broker": "futu",
  "account_alias": "Futu HK",
  "captured_at": "2026-05-07T16:30:00+08:00",
  "currency": "HKD",
  "total_assets": 123456.78,
  "market_value": 100000.00,
  "cash": 23456.78,
  "daily_pnl": 1234.56,
  "daily_pnl_pct": 1.01,
  "realized_pnl": 100.00,
  "unrealized_pnl": 1134.56,
  "positions": []
}
```

返回给 LLM 的文本示例：

```text
账户别名：Futu HK
采集时间：2026-05-07 16:30 Asia/Shanghai
市场口径：港股收盘后
今日盈亏：+1,234.56 HKD (+1.01%)
总资产：已脱敏，可显示区间 100k-150k HKD
主要贡献：
- XXX: +456.78 HKD
- YYY: -123.45 HKD
风险提示：今日盈亏基于富途账户快照和持仓字段生成，若存在出入金、分红、费用或汇率变化，可能与最终结算单略有差异。
```

## 每日盈亏口径

推荐口径优先级：

1. 优先使用富途持仓字段 `today_pl_val` 汇总当日持仓盈亏。
2. 结合 `realized_pl`、`unrealized_pl`、成交和现金流校准。
3. 使用账户总资产较上一快照的变化作为辅助校验，而不是唯一口径。

需要处理的边界：

- 入金、出金、内部资金划拨。
- 多币种汇率变化。
- 港股、美股、A 股交易日不一致。
- 分红、利息、费用、融资融券利息。
- T+0/T+1 成交与结算口径。
- 盘后波动和券商结算延迟。

日报中必须标注口径风险，避免把快照盈亏误当成最终清算结果。

## 本地配置

配置文件建议放在用户目录，不进入 git：

```text
~/.miniclaw/providers/futu-stock/config.yaml
```

示例：

```yaml
profiles:
  default:
    opend_host: "127.0.0.1"
    opend_port: 11111
    account_alias: "Futu HK"
    currency: "HKD"
    redaction: "summary"
    snapshot_dir: "~/.miniclaw/providers/futu-stock/snapshots"
    python_bin: "python3"
    trd_market: "HK"
    security_firm: "FUTUSECURITIES"
    acc_index: 0
```

配置中允许：

- OpenD host/port。
- profile 名称。
- 账户别名。
- 币种偏好。
- snapshot 目录。
- 脱敏级别。
- Python 解释器路径。
- 富途交易市场枚举，例如 `HK`。
- 富途券商枚举，例如 `FUTUSECURITIES`。
- `acc_index`，用于选择账户列表中的第几个账户。

配置中禁止：

- 富途登录密码。
- 交易密码。
- token。
- cookie。
- 完整资金账号。
- 身份证、手机号、验证码。

## MiniClaw 接入方式

### MCP 配置

MiniClaw 当前支持加载 MCP server。实现 `futu-stock` MCP 后，需要把它加入本机 MCP 配置，并在 MiniClaw MCP allowlist 中允许。

示例：

```json
{
  "mcpServers": {
    "futu-stock": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/yuan/ProjectRepo/miniclaw/dist/mcp/futu-stock/server.js"
      ]
    }
  }
}
```

开发态也可以直接用 tsx：

```json
{
  "mcpServers": {
    "futu-stock": {
      "type": "stdio",
      "command": "pnpm",
      "args": [
        "--dir",
        "/Users/yuan/ProjectRepo/miniclaw",
        "mcp:futu-stock"
      ]
    }
  }
}
```

MiniClaw 配置中：

```yaml
mcp:
  allowlist:
    - futu-stock
```

Claude provider 说明：

- MiniClaw 在检测到 `futu-stock` MCP 已加载后，会只把 `futu_health_check`、`futu_get_account_snapshot`、`futu_get_positions_summary`、`futu_get_daily_pnl_report` 加入 Claude task 的 allowed tools。
- 交易相关工具不会被注册，也不会进入 allowed tools。

Codex provider 说明：

- Codex task 是否能看到 `futu-stock` MCP，取决于 Codex CLI 的 MCP 配置继承。
- 如果 MiniClaw 的 Codex 配置使用 `inherit`，需要把 `futu-stock` 同样配置到 `~/.codex/config.toml` 的 MCP servers 中。
- 不要把富途密码、交易密码或账号 token 写入 Codex 配置。

### Cron pre_provider 配置

推荐让 cron task 使用 `pre_provider: futu-stock`，由 MiniClaw 在调用 LLM 前固定执行只读查询。这样比让 LLM 主动调用 MCP 更可控：采集逻辑可测试，输出会统一脱敏，OpenD 不可用时也能在 cron 层明确失败。

Provider 配置文件放在用户目录，不进入 git。当前股票日报推荐按市场拆分：

```text
~/.miniclaw/providers/futu-stock/us-stock.yaml
~/.miniclaw/providers/futu-stock/cn-stock.yaml
```

美股示例：

```yaml
profile: us
account_alias: Futu US
redaction: summary
top_positions_limit: 8
include_account_snapshot: true
include_daily_report: true
include_positions_summary: true
market_session_by_job:
  us-stock-pre-market: us_premarket_0900_et
  us-stock-post-market: us_postmarket_1630_et
```

A/H 示例：

```yaml
profile: default
account_alias: Futu HK
redaction: summary
top_positions_limit: 8
include_account_snapshot: true
include_daily_report: true
include_positions_summary: true
market_session_by_job:
  cn-stock-pre-market: cn_hk_premarket_0900
  cn-stock-post-market: cn_hk_postmarket_1640
```

字段说明：

- `profile`: 引用 `~/.miniclaw/providers/futu-stock/config.yaml` 中的 OpenD profile。
- `account_alias`: 展示用别名，不是资金账号。
- `redaction`: 默认 `summary`，总资产只展示区间。
- `top_positions_limit`: 注入 LLM 的主要贡献/拖累持仓数量上限。
- `include_*`: 控制输出中是否包含账户快照、文本报告、持仓贡献摘要。
- `market_session_by_job`: 同一个 provider 配置可服务多个 cron job，并按 job name 标记采集口径。

输出会是紧凑 JSON，核心字段包括：

```json
{
  "source": "futu-opend-readonly",
  "account_alias": "Futu",
  "market_session": "a_hk_postmarket_1515",
  "report": "...脱敏日报文本...",
  "snapshot": {
    "daily_pnl": 123.45,
    "daily_pnl_pct": 0.12,
    "total_assets_range": "100k-500k HKD",
    "positions_count": 8
  },
  "positions_summary": {
    "positions_count": 8,
    "pnl_summary": {
      "currency": "HKD",
      "gross_profit": 456.78,
      "gross_loss": -123.45,
      "net_pnl": 333.33,
      "winners_count": 1,
      "losers_count": 1
    },
    "top_positions": [],
    "top_gainers": [],
    "top_losers": []
  },
  "warnings": []
}
```

Provider 默认不输出完整资金账号、手机号、token、cookie、交易密码、完整总资产，也不会输出持仓数量或持仓市值等可反推出仓位规模的字段。`positions_summary` 会保留 Top 持仓、Top 盈利、Top 亏损和 gross/net P&L，供 `stock-portfolio` 进一步折算成人民币口径。

### Cron 任务示例

现在推荐直接通过 `stock-portfolio` 聚合 provider 接入 Discord 股票日报，只有在单独调试富途 provider 时才直接使用 `pre_provider: futu-stock`。

单独调试示例：

```yaml
name: daily-futu-stock-pnl
schedule: "30 16 * * 1-5"
timezone: Asia/Shanghai
enabled: true
type: task
channel: "<discord-channel-id>"
pre_provider: futu-stock
pre_provider_config: cn-stock
prompt: |
  上方 pre_provider JSON 是我的富途账户脱敏持仓与盈亏摘要。

  生成一份简洁的 Discord 日报：
  - 不输出账号、token、手机号、完整流水。
  - 先给今日总盈亏和百分比。
  - 列出主要贡献和主要拖累。
  - 如果 MCP 返回口径风险，必须在末尾提醒。
```

## 推荐目录结构

当前目录结构：

```text
src/mcp/futu-stock/
  server.ts
  config.ts
  futu-client.ts
  mapper.ts
  redact.ts
  safety.ts
  state.ts
  types.ts
  __tests__/
    config.test.ts
    mapper.test.ts
    redact.test.ts
    safety.test.ts
    server-tools.test.ts

src/providers/futu-stock/
  index.ts
  config.ts
  format.ts
  types.ts
  __tests__/
    config.test.ts
    format.test.ts
    index.test.ts
```

职责：

- `server.ts`: MCP server 入口，只注册只读 tools。
- `config.ts`: 读取 `~/.miniclaw/providers/futu-stock/config.yaml`。
- `futu-client.ts`: 封装 Futu SDK 查询调用。
- `mapper.ts`: 将 Futu 返回字段转换为统一快照模型。
- `redact.ts`: 对资产、账号、持仓等字段做脱敏。
- `safety.ts`: 中央化 forbidden method 列表与运行期保护。
- `state.ts`: 保存本地 snapshot，用于昨日对比和口径校验。
- `types.ts`: 定义 `FutuSnapshot`、`FutuPositionSummary`、`FutuDailyPnlReport`。
- `src/providers/futu-stock/index.ts`: `pre_provider` 入口，调用只读 Futu client 并返回脱敏 JSON。
- `src/providers/futu-stock/config.ts`: 读取 cron provider 配置，支持按 job name 选择 `market_session`。
- `src/providers/futu-stock/format.ts`: 输出 `source/report/snapshot/positions_summary/warnings`，并统一脱敏。

## 安全测试

第一批测试必须覆盖安全边界。

### Forbidden API 静态扫描

测试目标：

- `src/mcp/futu-stock` 中不能出现交易方法。
- 若出现 forbidden method name，测试直接失败。

Forbidden list：

```text
unlock_trade
place_order
modify_order
trade_unlock
order_create
order_modify
cancel_order
```

### Tool Registry 测试

测试目标：

- MCP server 只注册允许的四个 tools。
- tools 名称不能包含 `trade`、`order`、`unlock`、`buy`、`sell`。

### Redaction 测试

测试目标：

- 输出中不能包含完整账号。
- 输出中不能包含手机号格式。
- 输出中不能包含 token/cookie/password 字段。
- Discord 文本默认不展示完整总资产，只展示区间或用户明确允许的摘要数值。

### OpenD 连接测试

测试目标：

- `futu_health_check` 能判断 OpenD 是否可连。
- OpenD 不可用时返回明确错误，不泄漏配置和路径。
- OpenD host 不是 `127.0.0.1` 时默认拒绝，除非用户显式开启高级配置。

## 实施阶段

### Phase 1：文档与安全边界

目标：先固定只读 MCP 设计和安全验收标准。

验收：

- 文档只包含富途。
- 文档不包含其他券商实现计划。
- 明确 OpenD、本地 MCP、只读 tools、禁用交易接口。

### Phase 2：MCP Server Skeleton

目标：实现最小可运行 MCP server。

验收：

- MiniClaw 能加载 `futu-stock` MCP。
- `futu_health_check` 可运行。
- forbidden API 测试通过。
- tool registry 测试通过。

状态：已实现。

### Phase 3：富途查询实现

目标：接入 Futu SDK 和本机 OpenD，只读查询账户数据。

验收：

- 能查询账户资金。
- 能查询持仓。
- 能生成脱敏日报输入文本。
- 不配置交易密码。
- 不调用交易解锁。

状态：已实现 Python bridge 调用路径；需要用户本机安装 `futu-api` 并启动 OpenD 后做真实账户联调。

### Phase 4：Cron + Discord 日报

目标：通过 MiniClaw cron 定时调用 task，生成 Discord 日报。

验收：

- Discord 输出无敏感字段。
- 报告包含今日盈亏、百分比、主要贡献和口径风险。
- OpenD 不可用时 Discord 报错简洁且不泄漏敏感信息。

状态：已实现 `futu-stock` cron `pre_provider`，并通过 `stock-portfolio` 聚合接入当前四个股票日报任务：`us-stock-pre-market`、`us-stock-post-market`、`cn-stock-pre-market`、`cn-stock-post-market`。富途 provider 负责输出脱敏持仓、gross/net P&L、Top gainers/losers；`stock-portfolio` 负责和其他券商数据合并并折算为统一人民币口径。

## 最终边界

MiniClaw 可以拥有：

- 连接本机 `futu-stock` MCP。
- 查询脱敏账户快照。
- 生成每日盈亏日报。
- 推送到 Discord。

MiniClaw 不应该拥有：

- 富途登录密码。
- 富途交易密码。
- 解锁交易能力。
- 下单、撤单、改单能力。
- 资金划拨能力。
- 复用浏览器登录态抓取富途网页的能力。

一句话边界：

> `futu-stock` MCP 是一个只读账户日报工具，不是自动交易系统。
