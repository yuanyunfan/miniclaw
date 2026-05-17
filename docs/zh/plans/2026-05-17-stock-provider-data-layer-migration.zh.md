---
doc_id: stock-provider-data-layer-migration
lang: zh
translation_of: docs/plans/2026-05-17-stock-provider-data-layer-migration.md
translation_status: current
source_sha256: ae294ba87a7dcd954a110635ca842d70f1652cfad5957c8f49255fc9a1d42892
---
# Stock Provider 数据层迁移

Status: completed (stock ownership migrated; provider config/facade compatibility retained)
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

## 剩余执行计划

兼容迁移已经把主要 runtime entrypoints 移入 `src/stock/reports/*`，但只有当 stock domain code 不再依赖 `src/providers/*` 下的 stock-specific 文件时，迁移才算真正完成。下一阶段因此是 ownership cleanup，而不是继续做大范围目录搬迁。

### 完成定义

只有以下条件都成立时，本迁移才算完成：

- `src/stock/sources/*`、`src/stock/data/*` 和 `src/stock/signals/*` 不再 import `src/providers/*` 下的 stock-specific modules。
- `src/stock/reports/*` 可以 import generic provider framework contracts，但 stock-specific config/type/format ownership 要么属于 `src/stock/*`，要么由 thin provider wrapper 传入。
- `src/providers/*` 下的每个 stock provider folder 只保留 compatibility exports、config loading、provider framework adapters、compatibility behavior tests，以及少量 provider-specific cron glue。
- 现有 cron YAML provider names 和 config file locations 保持兼容。
- 除非明确规划 schema version bump，否则 fixture output shape 不变。

### Slice 0：Baseline And Dependency Guard

目标：在移动代码前，让剩余迁移工作可度量。

Actions：

- 从 `src/providers/index.ts` 记录当前 stock provider compatibility list。
- 用 `rg "../../providers|../../../providers|../../../../providers|../../../../../providers" src/stock --glob '*.ts'` 记录当前 reverse dependency count。
- 新增或记录 guard expectation：`src/stock/sources`、`src/stock/data` 和 `src/stock/signals` 不允许 import stock-specific provider modules。
- 暂时豁免 `src/stock/reports`，因为它仍是 cron-facing composer layer。

Acceptance criteria：

- reviewer 能清楚判断哪些 remaining imports 是允许的，哪些是 migration debt。
- cleanup slice 的最终 PR 或 commit summary 中包含 baseline command。

Verification：

- `pnpm run typecheck`
- `pnpm run quality:docs`

Rollback：

- 本 slice 只改文档；如果 guard wording 过严，直接回滚文档补充。

### Slice 1：Move Stock Domain Types Out Of Providers

目标：移除最大的耦合来源：当前由 provider folders 拥有的 stock data 和 signal types。

Target moves：

- `src/providers/stock-pulse/types.ts` -> stock-owned pulse/universe/quote types。
- `src/providers/market-intel/types.ts` -> stock-owned market evidence、market snapshot、scoring 和 payload types。
- `src/providers/stock-portfolio/types.ts` -> stock-owned portfolio aggregation 和 premium types。
- `src/providers/market-forecast-evaluation/types.ts` -> stock-owned forecast evaluation types。
- `src/providers/market-context/types.ts` -> stock-owned market memory/report context types。
- `src/providers/futu-stock/types.ts`、`src/providers/eastmoney-jywg-readonly/types.ts` 和 `src/providers/eastmoney-etf-premium/types.ts` -> 相关 `src/stock/sources/*`、`src/stock/data/*` 或 `src/stock/reports/*` 模块下的 source/report payload types。

Implementation approach：

- 如果单个 flat `src/stock/types.ts` 会过宽，优先使用 module-local stock type files。例如 `src/stock/data/portfolio-types.ts`、`src/stock/data/market-intel-types.ts`、`src/stock/signals/forecast-evaluation-types.ts` 都是可接受的。
- `src/providers/*/types.ts` 在一个迁移周期内保留为 compatibility re-export files。
- 先更新所有 non-provider imports，再更新 provider tests。
- 本 slice 不改变 runtime payload schema。

Acceptance criteria：

- `src/stock/sources/*`、`src/stock/data/*` 和 `src/stock/signals/*` 不再 import provider `types.ts`。
- Provider `types.ts` files 要么消失，要么变成 pure re-export compatibility facades。
- 不修改 cron config 或 runtime provider name。

Verification：

- `pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse src/providers/market-intel src/providers/market-context src/providers/market-forecast-evaluation src/providers/stock-watchlist-research`
- `pnpm vitest run src/mcp/futu-stock src/mcp/eastmoney-jywg src/mcp/eastmoney-myfavor`
- `pnpm run typecheck`

Rollback：

- 回滚 type move，同时保留之前 provider-owned type files。

### Slice 2：Move Portfolio Data Semantics Into Data Domain

目标：让 `src/stock/data/portfolio.ts` 成为真正的 data-domain module，而不是 provider formatting 的 re-export。

Target moves：

- 将 portfolio payload construction、CNY rollup、FX conversion、source compaction、source error redaction 和 position premium merge logic 从 `src/providers/stock-portfolio/format.ts` 移入 `src/stock/data/portfolio.ts` 或更小的 `src/stock/data/portfolio-*` modules。
- 将 asset classification guidance 的 data 部分移入 `src/stock/data/portfolio.ts` 或 dedicated portfolio classification module。
- 最终 JSON string formatting 可以留在 `src/stock/reports/stock-portfolio.ts`，也可以作为命名清晰的 data-domain serializer。

Provider boundary after slice：

- `src/providers/stock-portfolio/format.ts` 应删除，或降级为 compatibility re-export。
- `src/stock/reports/stock-portfolio.ts` 应从 `src/stock/data/portfolio*` import portfolio domain functions，而不是从 provider format files import。

Acceptance criteria：

- `src/stock/data/portfolio.ts` 不再 import `../../providers/stock-portfolio/format.js`。
- Portfolio tests 仍覆盖 `position_premium_summary`、CNY rollup、source error handling 和 redacted source payload behavior。
- 现有 daily stock summary 和 A/H stock cron payloads 保持 schema-compatible。

Verification：

- `pnpm vitest run src/providers/stock-portfolio src/providers/futu-stock src/providers/eastmoney-jywg-readonly src/providers/eastmoney-etf-premium`
- `pnpm run typecheck`

Rollback：

- 恢复 provider format module 作为 implementation source，并让 stock data module 继续作为 facade。

### Slice 3：Move Portfolio Visualization And Classification Signals

目标：从 `src/providers/stock-portfolio` 移除非 provider 的 chart 和 classification logic。

Target moves：

- 如果把 `src/providers/stock-portfolio/pie-chart.ts` 视为 report rendering，则迁到 `src/stock/reports/portfolio-pie-chart.ts`；如果 classification 会被复用，则拆成 `src/stock/signals/portfolio-allocation.ts` 加 report renderer。
- PNG file output 的 runtime storage 路径保持不变。
- `runStockPortfolioProvider` 的 chart attachment behavior 保持不变。

Acceptance criteria：

- 没有 stock report import `../../providers/stock-portfolio/pie-chart.js`。
- Pie chart model tests 继续覆盖 domestic equity、overseas equity、bond buckets、gold、cash、unclassified assets、label ordering 和 rendering。
- Runtime attachment metadata 保持不变。

Verification：

- `pnpm vitest run src/providers/stock-portfolio/__tests__/pie-chart.test.ts src/providers/stock-portfolio/__tests__/index.test.ts`
- `pnpm run typecheck`

Rollback：

- 在旧 provider path re-export 已迁移 chart module 一个迁移周期。

### Slice 4：Move Market Intel Formatting And Calibration Ownership

目标：把 market-intel payload assembly、data quality assembly 和 calibration logic 放到 stock-owned data/signal/report modules。

Target moves：

- 将 `src/providers/market-intel/format.ts` 的 payload builders 移入 `src/stock/reports/market-intel-format.ts`，或把可复用 data quality logic 拆入 `src/stock/data/market-evidence.ts`。
- 将 `src/providers/market-intel/calibration.ts` 移入 `src/stock/signals/market-intel-calibration.ts`。
- 更新 `src/stock/signals/market-intel.ts`、`src/stock/reports/market-intel.ts` 和 `src/stock/reports/watchlist-research.ts`，从 stock-owned modules import calibration 和 payload builders。
- 除非重新设计 provider config ownership，否则 `src/providers/market-intel/config.ts` 继续负责 provider config loading。

Acceptance criteria：

- `src/stock/signals/market-intel.ts` 不再 import provider calibration。
- `src/stock/reports/market-intel.ts` 不再 import provider format helpers。
- Market-intel fixtures 继续证明 data quality、evidence IDs、role protocol、scoring 和 skip behavior。

Verification：

- `pnpm vitest run src/providers/market-intel src/providers/stock-watchlist-research`
- `pnpm run typecheck`

Rollback：

- 如有需要，让旧 provider `format.ts` 和 `calibration.ts` 作为 compatibility re-exports 保留。

### Slice 5：Move Forecast Evaluation Calibration Into Signals

目标：让 forecast evaluation reliability、calibration summary 和 scoring helpers 对齐 Signal / Intelligence layer。

Target moves：

- 将 `src/providers/market-forecast-evaluation/calibration.ts` 移入 `src/stock/signals/forecast-calibration.ts`。
- Forecast persistence 继续留在 `src/store/market-forecasts.ts`。
- `market-forecast-evaluation` provider 的 report generation 继续留在 `src/stock/reports/forecast-evaluation.ts`。

Acceptance criteria：

- Calibration computation 从 `src/stock/signals/*` import，而不是从 provider folders import。
- Forecast evaluation output 和 market-intel calibration file generation 保持兼容。

Verification：

- `pnpm vitest run src/providers/market-forecast-evaluation src/providers/market-intel`
- `pnpm run typecheck`

Rollback：

- 从旧 provider path re-export 已迁移 calibration functions，直到 downstream imports 完成更新。

### Slice 6：Move Broker Report Payload Builders To Stock Sources Or Reports

目标：从 provider folders 移除 broker-specific report payload construction，同时保持 readonly safety 和 redaction 不变。

Target moves：

- 将 `src/providers/futu-stock/format.ts` 移入 `src/stock/reports/futu-stock-format.ts`；或者把 broker snapshot normalization 拆入 `src/stock/sources/futu`，final payload formatting 放入 `src/stock/reports/futu-stock`。
- 将 `src/providers/eastmoney-jywg-readonly/format.ts` 移入 `src/stock/reports/eastmoney-jywg-readonly-format.ts`；或者拆分 source normalization 和 report formatting。
- MCP/raw broker clients 继续留在 `src/mcp/*`，source adapter facades 继续留在 `src/stock/sources/*`。

Acceptance criteria：

- `src/stock/reports/futu-stock.ts` 和 `src/stock/reports/eastmoney-jywg-readonly.ts` 不再 import provider format files。
- Redaction 和 readonly safety tests 保持通过。
- trusted cron configs 的 exact/private redaction behavior 不变。

Verification：

- `pnpm vitest run src/mcp/futu-stock src/mcp/eastmoney-jywg src/providers/futu-stock src/providers/eastmoney-jywg-readonly`
- `pnpm run typecheck`

Rollback：

- 旧 provider `format.ts` files 作为 compatibility re-exports 保留一个迁移周期。

### Slice 7：Thin Provider Folders And Tighten Boundaries

目标：让 stock provider folders 成为真正的 cron compatibility facades。

Actions：

- 将 stock provider folders 收敛到 `index.ts`、`config.ts`、可选 `types.ts` re-export facades 和 compatibility tests。
- 决定 provider `config.ts` 是否永久留在 `src/providers/*`，因为 config files 是 provider-named；或者将 config loaders 移到 `src/stock/reports/config/*` 并由 provider facades re-export。
- 只有代码证明最终边界后，才更新 docs 描述。
- 如果 repo quality-gate 风格支持，新增 static dependency check。

Acceptance criteria：

- 重新运行 `find src/providers -maxdepth 2 -type f | rg '(stock|market|eastmoney|futu)'` 时，provider folders 下不再出现 source/data/signal implementation files。
- `rg "../../providers|../../../providers|../../../../providers|../../../../../providers" src/stock/sources src/stock/data src/stock/signals --glob '*.ts'` 不返回 stock-specific provider imports。
- `src/providers/index.ts` 仍是 cron provider names 的唯一 central registry。

Verification：

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm test`
- `pnpm run e2e:cron`
- `pnpm run quality:docs`

Rollback：

- 先恢复 provider facade re-exports；rollback 期间避免修改 cron YAML 或 runtime config paths。

### 推荐 Commit 边界

- Commit 1：docs/baseline guard 与 type ownership move。
- Commit 2：portfolio data 与 chart ownership cleanup。
- Commit 3：market-intel 与 forecast calibration cleanup。
- Commit 4：broker payload builder cleanup。
- Commit 5：final provider-folder thinning 与 docs sync。

每个 commit 都应保持 runtime provider names 稳定，并在最终 verification notes 中包含该 slice 的 focused test commands。

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
- 2026-05-17：在 compatibility migration 后完成 source/data cleanup slice。`stock-pulse` 的 universe/source mapping 已迁入 `src/stock/data/universe.ts` 和 `src/stock/sources/watchlists.ts`；market-intel calendar、quote snapshot、portfolio context、redaction 和 official evidence collectors 已迁入 `src/stock/data/*` 与 `src/stock/sources/official/collectors/*`；Eastmoney ETF premium 与 Yahoo watchlist research client 已迁入 `src/stock/sources/*`。`src/providers/*` 仍保留 cron-facing config/type compatibility 和部分 report-format helper，最终 report/config cleanup 仍是单独切片。
- 2026-05-17：完成 ownership cleanup slice。原本由 provider 拥有的 stock `types.ts` 现在改为从 stock-owned modules re-export，例如 `src/stock/data/portfolio-types.ts`、`src/stock/data/market-intel-types.ts`、`src/stock/data/pulse-types.ts`、`src/stock/data/market-context-types.ts`、`src/stock/signals/forecast-evaluation-types.ts`，以及 `src/stock/reports/*` 下的 report-specific type modules。
- 2026-05-17：将剩余 stock implementation ownership 移出 provider folders：asset allocation 和 portfolio payload assembly 迁入 `src/stock/data/*`；portfolio pie chart rendering 与 broker payload formatters 迁入 `src/stock/reports/*`；market-intel payload formatting 迁入 `src/stock/reports/market-intel-format.ts`；market-intel 与 forecast calibration 迁入 `src/stock/signals/*`。
- 2026-05-17：stock provider folders 现在只保留 cron config loaders、`index.ts` compatibility exports、小型 re-export facades 和 tests。`src/stock/sources`、`src/stock/data`、`src/stock/signals` 不再 import stock-specific provider modules；report composers 为了 cron compatibility 仍会 import provider config loaders 和 generic provider framework contracts。
- 2026-05-17：重新用 `pnpm run typecheck`、`pnpm vitest run src/providers/stock-portfolio src/providers/stock-pulse src/providers/market-intel src/providers/market-context src/providers/market-forecast-evaluation src/providers/stock-watchlist-research`、以及 `pnpm vitest run src/mcp/futu-stock src/mcp/eastmoney-jywg src/mcp/eastmoney-myfavor src/providers/futu-stock src/providers/eastmoney-jywg-readonly src/providers/eastmoney-etf-premium` 完成验证。
