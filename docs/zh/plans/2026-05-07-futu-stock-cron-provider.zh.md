---
doc_id: futu-stock-cron-provider-plan
lang: zh
translation_of: docs/plans/2026-05-07-futu-stock-cron-provider.md
translation_status: current
source_sha256: 2660f07935783b81a92441d6c19110282e3a0e76c812a28d6988272649ee0780
---
# 未来股票

现况:已完成
日期:2026-05-07

## 背景情况

用户想要已有的`daily-stock-market`Discord cron 报告包含其未来账户持有量和每日 P&L. MiniClaw 已经有一个只读的`src/mcp/futu-stock`可以通过Futu Python SDK正式查询本地 OpenD 的MCP服务器,将中介数据映射到快照中,并进行编辑敏感输出.

目前的股票 cron 工作纯粹是 LLM 提示 。 它们没有将会计背景纳入任务,因此报告无法解释投资组合的敞口,位置级别的贡献,或市场分析是否与用户的实际持有量有关.

## 目标

- 加一个内置的`futu-stock`曲线`pre_provider`.
- 重用现有的只读的Futu客户端、映射器和编辑码。
- 产出紧凑,经过编辑的JSON 适合预先支出一个 cron任务提示。
- 配置现有的市场前和市场后股票工作,以便使用供应商。
- 保持所有账户配置`~/.miniclaw/providers/futu-stock`外边
——只保留集成内容:无交易解锁,无订单,无交易密码,无原始账户标识.
- 用注入的假客户端添加对提供者配置解析、格式化/编辑的焦点测试,以及提供者执行。

## 非目标

- 不执行交易、订单管理、战略执行或现金转移。
- 不披露原始的Futu账户行、完整的账户ID、信使、饼干、电话号码或交易密码。
- 不要求 LLM 在执行时直接调用 MCP 工具 。
- 不要解决这个片段的多经纪人聚合。
- 不承诺用户级别`~/.miniclaw`cron/提供 YAML 文件。

## 现有建筑证据

- `src/providers/types.ts`: 定义`PreProviderRunArgs`和`PreProviderResult`.
- `src/providers/index.ts`:允许预先提供方的中央登记处。
- `src/cron/runner-task.ts`: 运行`pre_provider`在任务执行之前,并通过一个快速模板预置其输出。
- `src/mcp/futu-stock/futu-client.ts`:只读的Python桥通过本地的OpenD.
- `src/mcp/futu-stock/mapper.ts`: 将原始未来数据转换为`FutuAccountSnapshot`.
- `src/mcp/futu-stock/redact.ts`:格式与编辑 Discord/LLM安全输出.
- `~/.miniclaw/cron/stock-market-premarket.yaml`: 现有预市股票报告cron。
- `~/.miniclaw/cron/a-share-hk-postmarket.yaml`: 现有A/HK邮局股票报告cron。

## 执行计划

1. 添加`src/providers/futu-stock`:
- 提供者配置加载器来自`~/.miniclaw/providers/futu-stock/<name>.yaml`;
- 提供者一级的类型;
- 以编辑的快照、报告文本、最高位置和警告等内容向JSON发出压缩;
   - `runFutuStockProvider`,可选择的依赖性注射测试。
2. 登记册`futu-stock` in `src/providers/index.ts`所以Cron加载器接受它。
3. 添加测试:
- 配置加载器分析默认并拒绝不安全的配置名称;
- 不以简易模式披露准确的总资产,也不以类似账户的字符串进行编辑;
- 供应商可以使用假客户端运行,并返回可解析的编译JSON.
4. 添加本地用户配置 :
   - `~/.miniclaw/providers/futu-stock/daily-stock-market.yaml`.
5. 更新本地工作:
- 添加内容`pre_provider: futu-stock`;
- 添加内容`pre_provider_config: daily-stock-market`;
- 使时间表与北京保持一致`09:15`和`15:15`;
- 调整提示,明确使用预编版的Futu JSON进行组合感知分析。
6. 最新情况`docs/archive/features/06-futu-stock.md`, `docs/architecture.md`,并视需要建立README项目结构。

## 核查计划

- 类型检查:`pnpm build`.
- 重点测试:`pnpm vitest run src/providers/futu-stock src/mcp/futu-stock`.
- 全面测试:`pnpm test`.
- Cron配置检查:`pnpm cron:list`.
- 活烟,不打印敏感值:
- 运行`runFutuStockProvider`反对本地 OpenD;
- 只打印别名/会话/位置数/警告数。
- 在用户级的 cron 更改后重新启动 MiniClaw, 以便调度器重新装入配置 。

## 风险 倒车

- 风险: OpenD 未运行或未来会话过期 。
- 缓解:提供者发生短暂的消毒错误,故障; cron报告`pre_provider`失败而不是伪造账户数据。
- 风险:供应商输出泄露账户识别信息或准确的资产总额。
- 缓解:再利用`redactedSnapshotJson`, `formatFutuDailyPnlReport`, `redactSensitiveText`,并添加提供者测试。
- 风险:快速超重快照P&L作为最后结算。
- 媒体:输出和提示包括P&L警告.
- 退后:删除`futu-stock`从供应商登记处删除`pre_provider`线条来自两个用户 cron YAML 文件。

## 文档同步

- 最新情况`docs/archive/features/06-futu-stock.md`与已执行的预提供器和支线连接。
- 最新情况`docs/architecture.md`提供者实例。
- 如果引入新的提供者目录,则更新README项目结构。

## 执行笔记

- 已经添加了`src/providers/futu-stock`包含提供者配置加载, 每人`market_session`,紧凑JSON格式化,以及依赖注射执行测试.
- 登记`futu-stock`在提供前登记处。
- 固定共享的“未来”编辑器,如此长的分数百分比不会被误认为是账户式的整数。
- 添加本地供应商配置`~/.miniclaw/providers/futu-stock/daily-stock-market.yaml`.
- 更新本地工作`stock-market-premarket`和`a-share-hk-postmarket`用于`pre_provider: futu-stock`和时间表`15 9 * * 1-5` / `15 15 * * 1-5`.
- 通过核查:
  - `pnpm build`
  - `pnpm vitest run src/providers/futu-stock src/mcp/futu-stock`
  - `pnpm test`
  - `pnpm cron:list`
- 现场提供者对当地OpenD吸烟,只打印别名/会话/位置计数。
