---
doc_id: stock-cron-market-split-cny-plan
lang: zh
translation_of: docs/plans/2026-05-08-stock-cron-market-split-cny.md
translation_status: current
source_sha256: c0899b6ed515a2dc3b2de88d47de8457a597addee72ab57f6a905722ee7f8ce9
---
# 股票Cron市场分割和CNY P&L

现况:已完成
日期:2026-05-08

## 背景情况

MiniClaw目前有两个库存工作:

- `stock-market-premarket`:北京时间09:15,美国/A/H预市场混合报告.
- `a-share-hk-postmarket`:北京时间15:15,A/H邮购报告.

两者都使用`pre_provider: stock-portfolio`,该总和`futu-stock`和`eastmoney-jywg-readonly`现有有效载荷保留了每个经纪人供应商的产出,但没有生产一个跨经纪人CNY标价的P&L滚动。

新的要求是将报告分为四个市场/会议特定工作,并包括统一的CNY P&L统计数据,包括股票和ETF:

- `us-stock-pre-market`
- `us-stock-post-market`
- `cn-stock-pre-market`
- `cn-stock-post-market`

## 目标

- 把股票报告分成美国和CNDiscord频道。
- 使用市场-地方时区:
- 美国就业情况`America/New_York`.
- CN工作使用情况`Asia/Shanghai`.
- 在LLM运行之前,增加由供应商方CNY命名的P&L滚动。
- 包括:
- 纽约市的毛利润;
- 纽约市损失总额;
- 纽约市P&L净额;
- 按货币计算的原始总额;
- 纽约市前5名;
- 纽约市前5名输家;
- 在可能情况下,为库存对ETF推断出仪器类型。
- 从Discord输出中保留账户识别符、准确的总资产、饼干、信使、验证密钥、密码和交易证书。

## 非目标

- 禁止交易端点、订单放置、现金转移或位置变异。
- 没有账户密码,交易密码, 或经纪人信使存储。
- 在第一次执行中不自动在线获取FX;费率是明确的本地配置值,因此报告数学是决定性的和可审计的。
除非以后明确要求,否则不试图将美元/韩元/CNY的市场价值合并为一份正式的NAV报告。

## 现有建筑证据

- `src/cron/scheduler.ts`通行证`job.timezone` to `node-cron`.
- `src/cron/runner-task.ts`通行证`job.name`输入`runPreProvider`,因此提供者配置可以因cron工作而异.
- `src/providers/futu-stock/config.ts`和`src/providers/eastmoney-jywg-readonly/config.ts`已经支持`market_session_by_job`.
- `src/providers/futu-stock/format.ts`和`src/providers/eastmoney-jywg-readonly/format.ts`目前仅输出`top_positions`,而不是单独的顶级增益者/亏损者或总损益.
- `src/providers/stock-portfolio/format.ts`目前汇总源有效载荷,但不计算CNY滚滚.

## 执行计划

1. 扩大经纪人供应商的有效载荷。
- 添加内容`positions_summary.pnl_summary`.
- 添加内容`positions_summary.top_gainers`.
- 添加内容`positions_summary.top_losers`.
- 只保留紧凑字段:代码、名称、货币、P&L值、比率;没有数量或市场价值。

2. 扩展`stock-portfolio`调伏.
- 添加内容`market_scope`.
- 添加内容`base_currency`默认值`CNY`.
- 添加内容`fx_rates`,解释为一个单位的原始货币转换为基准货币。
- 添加内容`fx_rates_as_of`和`fx_rates_source`.
- 添加内容`top_movers_limit`,默认值 5.
- 添加内容`include_cny_summary`,默认为真实。

3. 扩展`stock-portfolio`问题。
- 阅读嵌套经纪人`pnl_summary`和最高损益清单。
- 将总利润/损失/净P&L转换为CNY。
- 将Top5增益者/损失者转换为CNY.
- 如果来源货币没有FX率,则添加警告。
- 保留原始的每源有效载荷,以便追踪。

4. 增加重点测试。
- 经纪人对顶级增益者/失利者和总数据进行物质测试。
- 股票组合用于CNY转换、缺失FX警告和Top5排序。
- 新领域的股票组合配置测试。

5. 更新本地运行时间配置。
- 添加未来`us`配置文件为`trd_market: US`和`currency: USD`.
- 添加提供者配置 :
     - `~/.miniclaw/providers/futu-stock/us-stock.yaml`
     - `~/.miniclaw/providers/futu-stock/cn-stock.yaml`
     - `~/.miniclaw/providers/eastmoney-jywg-readonly/cn-stock.yaml`
     - `~/.miniclaw/providers/stock-portfolio/us-stock.yaml`
     - `~/.miniclaw/providers/stock-portfolio/cn-stock.yaml`
- 禁用旧的股票工作。
- 添加四个新 cron YAML 文件 。

6. 创建或再利用Discord频道。
   - `#daily-us-stock`
   - `#daily-cn-stock`

## 核查计划

- 重点测试:
  - `pnpm vitest run src/providers/futu-stock src/providers/eastmoney-jywg-readonly src/providers/stock-portfolio`
- 类型检查:
  - `pnpm build`
- 全面测试:
  - `pnpm test`
- 配置负载 :
  - `pnpm cron:list`
- 在不打印财务细节的情况下进行供应商干燥:
- 运行`stock-portfolio`(单位:千美元)`us-stock`和`cn-stock`,只打印状态计数和摘要形状。

## 风险 倒车

- 风险:如果OpenD账户权限不包括美国交易,未来美国简介可能失败。
- 缓解:美国股票供应商配置与CN股票配置隔离。
- 退后:禁用`us-stock-*`cron文件。

- 风险:静态FX率变得停滞。
- 缓解:有效载荷包括:`fx_rates_as_of`和`fx_rates_source`;报告必须说明CNY值是基于配置的费率。
- 回转: 设定`include_cny_summary: false`或更新当地FX费率。

- 风险:ETF分类不完善。
- 缓解:标记`instrument_type` as `etf`仅针对明确的名称/代码提示; 否则`stock`.

## 文档同步

- 计划文件记录了设计
- 提供文件者在实施后应提及纽约市的滚动场。

## 执行笔记

- 增加经纪人级别`pnl_summary`, `top_gainers`,以及`top_losers` to `futu-stock`和`eastmoney-jywg-readonly`供应商有效载荷。
- 已经添加了`market_scope`, `base_currency`, `fx_rates`, `fx_rates_as_of`, `fx_rates_source`, `top_movers_limit`,以及`include_cny_summary` to `stock-portfolio`提供者配置 。
- 已经添加了`stock-portfolio.cny_summary`(c) 包括纽约市总利润、总亏损、净保费和利息、按货币计的总额和最高收益者/亏损者。
- 创建私人Discord频道:
  - `#daily-us-stock`
  - `#daily-cn-stock`
- 添加本地提供者配置:
  - `~/.miniclaw/providers/futu-stock/us-stock.yaml`
  - `~/.miniclaw/providers/futu-stock/cn-stock.yaml`
  - `~/.miniclaw/providers/eastmoney-jywg-readonly/cn-stock.yaml`
  - `~/.miniclaw/providers/stock-portfolio/us-stock.yaml`
  - `~/.miniclaw/providers/stock-portfolio/cn-stock.yaml`
- 增加地方工作:
  - `us-stock-pre-market`
  - `us-stock-post-market`
  - `cn-stock-pre-market`
  - `cn-stock-post-market`
- 残废的本地库存工作:
  - `stock-market-premarket`
  - `a-share-hk-postmarket`
- 核查:
  - `pnpm vitest run src/providers/futu-stock src/providers/eastmoney-jywg-readonly src/providers/stock-portfolio`
  - `pnpm build`
  - `pnpm cron:list`
  - `stock-portfolio`干线运行`us-stock`和`cn-stock`
  - `pnpm test`
