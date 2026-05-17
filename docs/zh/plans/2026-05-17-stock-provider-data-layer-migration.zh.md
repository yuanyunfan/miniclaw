---
doc_id: stock-provider-data-layer-migration
lang: zh
translation_of: docs/plans/2026-05-17-stock-provider-data-layer-migration.md
translation_status: current
source_sha256: 09c8ecf27561e0e6db4439887c37b4b9641eb7c2ef4dfb1fc648359d466e1a6a
---
# Stock Provider 数据层迁移

Status: completed (compatibility migration)
Date: 2026-05-17

## 背景

MiniClaw 的 stock providers 当前作为 cron pre-provider context builders 运行。这个形态对交付有效，但实现边界已经过载：source access、标准化 stock data、signal calculation、report composition 和 cron compatibility 经常混在同一个 provider 文件夹里。

stock domain 的长期主轴应该强于单个 cron task。Portfolio snapshots、quotes、watchlists、market calendars、macro evidence、ETF premium data 和 market memory 应该是稳定的数据能力。Cron tasks 应该组合这些能力生成报告，而不是拥有底层数据模型。

## 目标

- 将 stock 内部迁移到四层设计：Source Adapter、Data Domain、Signal / Intelligence、Report Composer / Cron Provider。
- 迁移期间保持所有现有 stock cron provider 名称和 cron YAML 字段兼容。
- 将可复用 stock 逻辑迁入 `src/stock/*`，避免 big-bang rewrite。
- 让 market memory 成为一等 stock data capability，并能注入到所有相关 stock task。
- 保留 provider redaction、readonly safety、health check、dry-run、`skipTask` 和 commit-after-success 行为。

## 非目标

- 本计划不重命名现有 provider registry names。
- 不修改 `pre_provider`、`pre_provider_config`、`pre_context_providers` 或 `pre_provider_preflight` 等 cron schema 字段。
- 第一轮迁移不新增外部 stock data vendors。
- 不把 account credentials、session material、cookies 或私有券商细节放进 repo docs 或 repo code。
- 不让 LLM prompts 负责确定性的 source mapping 或 signal computation。

## 现有架构证据

- 相关 provider 文件：
  - `src/providers/index.ts`：注册 `futu-stock`、`eastmoney-jywg-readonly`、`eastmoney-etf-premium`、`stock-portfolio`、`stock-pulse`、`market-intel`、`market-forecast-evaluation`、`market-context` 和 `stock-watchlist-research`。
  - `src/providers/framework.ts`：定义 `ProviderModule`、health checks、dry runs、structured `run()`、`format()` 和可选 `commit()`。
  - `src/cron/types.ts`：定义 `pre_provider`、`pre_context_providers` 和 provider preflight options。
  - `src/providers/stock-pulse/*`：当前混合 universe collection、quote fetching、market-window checks、alert generation 和 report payload formatting。
  - `src/providers/market-intel/*`：当前混合 portfolio context、quote snapshots、official evidence collection、scoring 和 report formatting。
  - `src/providers/market-context/*` 与 `src/store/market-context.ts`：实现 rolling market memory 和 forecast injection。
- 相关 source 文件：
  - `src/mcp/futu-stock/*`：Futu OpenD readonly account 和 watchlist access。
  - `src/mcp/eastmoney-jywg/*`：Eastmoney JYWG readonly account access。
  - `src/mcp/eastmoney-myfavor/*`：Eastmoney MyFavor watchlist access。
  - `src/providers/eastmoney-etf-premium/*`：public ETF premium data。
- 相关 docs：
  - `docs/providers/provider-framework.md`
  - `docs/providers/stock/README.md`
  - `docs/providers/stock/eastmoney.md`
  - `docs/providers/stock/research.md`

## 目标四层架构

目标内部布局是：

```text
src/stock/
  sources/
  data/
  signals/
  reports/
  types.ts
```

各层职责：

- Source Adapter：
  - 负责外部连接细节、认证边界、raw payload validation、最小归一化、source-specific retries 和 redaction。
  - 候选模块：`sources/futu`、`sources/eastmoney`、`sources/yahoo` 和 `sources/official`。
  - 不决定 report wording、investment interpretation 或 cron skip policy。

- Data Domain：
  - 负责稳定的 stock semantics，例如 portfolio、quotes、universe、market calendar、ETF premium、market evidence 和 market memory。
  - 暴露不依赖具体 cron task 的可复用接口。
  - 将 source adapter output 转成持久 domain snapshots。

- Signal / Intelligence：
  - 将 domain snapshots 转成可解释 signals，并在可用时携带 rationale、severity、evidence references 和 confidence。
  - 候选模块：`signals/pulse`、`signals/portfolio-risk`、`signals/market-intel`、`signals/forecast-evaluation` 和 `signals/context-synthesis`。
  - 输出 structured facts，而不是最终 prompt prose。

- Report Composer / Cron Provider：
  - 保留现有 cron-facing provider 名称作为 compatibility wrappers。
  - 加载 provider config，创建 provider context，组合 Data Domain 与 Signal 输出，注入 market memory，格式化 LLM context，并保留 `commit()` 语义。
  - 候选模块：`reports/stock-portfolio`、`reports/stock-pulse`、`reports/market-intel`、`reports/market-context`、`reports/forecast-evaluation` 和 `reports/watchlist-research`。

## 实施计划

1. 冻结 docs 和 compatibility boundary。
   - 保持现有 provider names 和 cron YAML 字段稳定。
   - 记录 `src/providers/*` 是 cron-facing compatibility layer，而 `src/stock/*` 会成为可复用 stock domain layer。

2. 引入共享 stock types。
   - 新增 `src/stock/types.ts`，包含 market scope、symbol、quote snapshot、portfolio snapshot、market evidence、market memory 和 stock signal types。
   - 这些类型保持 vendor-neutral 和 cron-neutral。

3. 抽取 Source Adapters。
   - 通过 `src/stock/sources/futu` 移动或 re-export Futu access。
   - 通过 `src/stock/sources/eastmoney` 移动或 re-export Eastmoney JYWG、MyFavor 和 ETF premium access。
   - 将 `stock-pulse` 和 `market-intel` 的 Yahoo quote access 移入 `src/stock/sources/yahoo`。
   - 将 `market-intel` 的 official evidence collectors 移入 `src/stock/sources/official`。
   - 第一轮保持现有 tests 和 public provider behavior 不变。

4. 抽取 Data Domain modules。
   - `data/portfolio`：统一 account、position、allocation 和 PnL snapshots。
   - `data/quotes`：quote 和 intraday bar snapshots。
   - `data/universe`：configured symbols、portfolio symbols、watchlist symbols 和 source symbols。
   - `data/calendar`：market open/closed windows、trade dates、sessions 和 time zones。
   - `data/etf-premium`：ETF 相关分析所需的 premium 和 discount data。
   - `data/market-evidence`：macro、news、earnings、filing、policy、calendar 和 risk evidence。
   - `data/market-memory`：daily market summaries、active items 和 forecast history 的读写访问。

5. 抽取 Signal / Intelligence modules。
   - 将 stock pulse anomaly logic 从 `stock-pulse/analyzer.ts` 移入 `signals/pulse`。
   - 将 market-intel scoring 和 calibration 移入 `signals/market-intel`。
   - 将 forecast evaluation 和 calibration 移入 `signals/forecast-evaluation`。
   - 新增 `signals/context-synthesis`，把 yesterday memory 加 today's evidence 合成为 today's market memory。
   - 保持输出 deterministic 且可测试。

6. 收薄 cron-facing providers。
   - 将 `src/providers/*` 下每个 stock provider 转成 config loading、composer invocation、formatting 和 commit wrapping。
   - 对已经支持 `ProviderModule` 的 provider，保留 health checks 和 dry runs。
   - 当 composer output 结构化后，再逐步把 legacy-only stock providers 迁到 `ProviderModule`。

7. 在 code migration 启动后重组 stock docs。
   - 保持 `docs/providers/stock/README.md` 作为 family entry。
   - 只有 source adapters 在代码中存在后，才新增 source-family docs。
   - 只有 report composers 在代码中存在后，才新增 pipeline docs。
   - 不要在代码存在前把规划中的 module paths 写成已完成实现事实。

## 验证计划

- Source Adapter tests：
  - Futu、Eastmoney、Yahoo 和 official collector fixtures 仍然 map 到相同 safe payloads。
  - Redaction、readonly safety、auth failures 和 format drift 继续覆盖。
- Data Domain tests：
  - Portfolio snapshots、quote snapshots、universe merging、market calendar decisions、ETF premium snapshots、market evidence 和 market memory queries 是 deterministic。
- Signal tests：
  - Stock pulse alerts 匹配现有 fixture behavior。
  - Market-intel scoring 和 calibration 匹配现有 expectations。
  - Forecast evaluation 保留之前的 hit-rate 和 calibration behavior。
  - Context synthesis 对相同 previous memory 和 evidence input 产生 deterministic 输出。
- Composer tests：
  - 现有 stock provider outputs 保持 schema-compatible。
  - `skipTask`、`commit`、dry-run 和 health-check 行为保持完整。
  - Market context 仍可通过 `pre_context_providers` 注入。
- 每个 slice 建议 gate：
  - `pnpm vitest run src/mcp/futu-stock src/mcp/eastmoney-jywg src/mcp/eastmoney-myfavor`
  - `pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse src/providers/market-intel src/providers/market-context src/providers/market-forecast-evaluation src/providers/stock-watchlist-research`
  - `pnpm run typecheck`
  - `pnpm run quality:docs`

## 风险与回滚

- Risk：移动逻辑改变 provider output shape。
  - Mitigation：围绕每个已迁移 provider 保留 fixture-based compatibility tests。
  - Rollback：让 provider wrapper 恢复调用旧实现，保留但不使用已抽取模块。

- Risk：source adapters 意外暴露 account 或 session details。
  - Mitigation：在 source boundary 保留 redaction 和 readonly safety tests。
  - Rollback：回滚 source extraction slice，继续使用现有 MCP/provider boundary。

- Risk：cron tasks 在 domain API 稳定前就耦合到新接口。
  - Mitigation：先通过现有 provider wrappers 暴露 report composers。
  - Rollback：cron config 保持不变，将 wrappers 切回 legacy code。

- Risk：docs 把未来实现描述成当前事实。
  - Mitigation：在 code migration 完成前，本文件保留在 `docs/plans/`。
  - Rollback：将本计划标记为 superseded，并只用已验证实现事实更新 provider docs。

## 文档同步

- `docs/providers/stock/README.md`：把本计划链接为目标架构迁移计划，不替换当前 provider facts。
- `docs/providers/provider-framework.md`：只有 provider framework contracts 改变时才更新。
- `docs/documentation-migration-map.md`：追踪本计划和中文 mirror。
- Website pages：除非 provider capability summaries 改变，否则本计划不需要 public copy change。
- Changelog：除非 code migration 交付 user-visible behavior，否则 docs-only plan 不需要 changelog。

## 执行记录

- 2026-05-17：基于当前 provider code inspection 和前序 stock provider architecture discussion 创建计划。
- 2026-05-17：完成兼容迁移切片。`src/providers/*/index.ts` 对所有 stock provider 名称继续作为 cron-facing compatibility layer，可复用 stock 实现迁入 `src/stock/`。
- 2026-05-17：新增 `src/stock/types.ts`，以及 Futu、Eastmoney、Yahoo、official evidence 的 source adapter 模块；新增 calendar、universe、quotes、portfolio、ETF premium、market evidence、market memory 的 data-domain bridge；新增 pulse、market-intel scoring、forecast evaluation、context synthesis signal 模块；并为所有现有 stock cron provider 增加 report composer。
- 2026-05-17：已用 `pnpm run typecheck`、stock provider focused Vitest、Futu/Eastmoney MCP focused Vitest 验证兼容性。
