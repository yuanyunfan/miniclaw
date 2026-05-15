# MiniClaw Docs Index

> 结论：`docs/` 是 MiniClaw 的 implementation source of truth，面向 LLM 和维护者；`website/` 是面向人的 GitHub Pages 展示层。短期内 root `docs/` 仍作为 English canonical tree，`docs/zh/` 是 tracked Chinese mirror，迁移状态由 `documentation-migration-map.md` 记录。

## Core Design

- [`architecture.md`](architecture.md): MiniClaw 全局架构、数据流、cron、DB、用户级目录。
- [`bot-routing.md`](bot-routing.md): Discord Gateway、message、slash command、thread continuation、chat/task routing。
- [`chat-router-current-logic.md`](chat-router-current-logic.md): 当前 chat router 的代码级判断逻辑、capability 映射、确认按钮和真实误分流边界。
- [`install-distribution-strategy.md`](install-distribution-strategy.md): 面向外部用户的安装、配置向导、Release artifact 和本机 Deploy 改造建议。
- [`prompts.md`](prompts.md): 框架级 prompt 资产管理。
- [`quality-gates.md`](quality-gates.md): 测试分层、质量门禁、Discord E2E 方案。
- [`documentation-migration-map.md`](documentation-migration-map.md): 当前 docs 迁移、双语 pairing、website exposure 的 machine-readable 初始地图。

## Runtime

- [`runtime/README.md`](runtime/README.md): Discord intake、routing、chat/task/cron runtime、memory/context、operations 的当前 source-of-truth 入口。

Runtime 仍复用部分 legacy feature docs 作为详细实现记录：

- [`features/03-discord-task-output.md`](features/03-discord-task-output.md): Discord task 输出、进度和 embed 设计。
- [`features/04-smart-task-router.md`](features/04-smart-task-router.md): Smart Task Router 中文设计。
- [`features/05-smart-task-router.en.md`](features/05-smart-task-router.en.md): Smart Task Router English design.
- [`features/12-connectivity-monitor.md`](features/12-connectivity-monitor.md): Discord / 网络 / SMTP 链路探测与 Email fallback 告警。
- [`features/13-auto-doctor.md`](features/13-auto-doctor.md): task / cron / PM2 / 日志 / connectivity 的只读运行态诊断。
- [`features/19-agent-prompt-context-audit.md`](features/19-agent-prompt-context-audit.md): Codex / Claude Code chat、task、cron prompt 与上下文注入审计。
- [`features/20-memory-curation-lifecycle.md`](features/20-memory-curation-lifecycle.md): memory 自动抽取候选校验、去重合并、生命周期 metadata 和定期 maintenance。
- [`features/21-agent-run-manager.md`](features/21-agent-run-manager.md): task-scoped Agent Run Manager、Agent Bus、ACP lifecycle、managed runtime routing、guardrails、DAG scheduler foundation、final synthesis 与 trace UX。

## Providers

- [`providers/README.md`](providers/README.md): Provider 文档总入口，描述 provider runtime、trust boundary、privacy boundary 和维护规则。
- [`providers/provider-framework.md`](providers/provider-framework.md): Provider framework 当前入口，链接到详细实现记录。
- [`providers/content.md`](providers/content.md): Content provider family，当前覆盖 WeChat MP ingestion 和 dedupe 边界。
- [`providers/email.md`](providers/email.md): Email provider family，区分通用只读 email capability 与业务 parser。
- [`providers/stock/README.md`](providers/stock/README.md): Stock provider family 数据流。
- [`providers/stock/eastmoney.md`](providers/stock/eastmoney.md): Eastmoney provider family，是 JYWG readonly 和 MyFavor watchlist 的当前 source of truth。
- [`providers/stock/research.md`](providers/stock/research.md): Stock research provider pipeline，串联 portfolio、pulse、market-intel 和 watchlist research。

- [`features/02-wechat-mp-provider.md`](features/02-wechat-mp-provider.md): 微信公众号文章采集 pre-provider。
- [`features/06-futu-stock.md`](features/06-futu-stock.md): 富途股票账户只读查询 MCP / provider。
- [`features/07-email-capability.md`](features/07-email-capability.md): 通用只读 Email capability。
- [`features/08-cmb-credit-card-email-provider.md`](features/08-cmb-credit-card-email-provider.md): 招商信用卡邮件消费解析 provider。
- [`features/10-stock-portfolio-provider.md`](features/10-stock-portfolio-provider.md): 多券商股票账户聚合 provider。
- [`features/11-stock-pulse-provider.md`](features/11-stock-pulse-provider.md): 股票盘中 hourly 异动扫描 provider。
- [`features/14-market-intel-provider.md`](features/14-market-intel-provider.md): CN/US 盘前市场情报、forecast persistence、盘后评价与 calibration loop。
- [`features/16-provider-framework.md`](features/16-provider-framework.md): provider manifest、health check、dry-run、structured output 和兼容 adapter。
- [`features/18-stock-watchlist-research-provider.md`](features/18-stock-watchlist-research-provider.md): 券商 watchlist stock 盘前/每日深度研究 provider，独立推送到 daily-watchlist-stock。

Eastmoney legacy compatibility stubs:

- [`features/09-eastmoney-jywg-readonly-provider.md`](features/09-eastmoney-jywg-readonly-provider.md): merged into [`providers/stock/eastmoney.md`](providers/stock/eastmoney.md#jywg-readonly-provider).
- [`features/17-eastmoney-myfavor-watchlist.md`](features/17-eastmoney-myfavor-watchlist.md): merged into [`providers/stock/eastmoney.md`](providers/stock/eastmoney.md#myfavor-watchlist-provider).

## Experiments

- [`experiments/README.md`](experiments/README.md): 实验性控制面总入口。
- [`features/01-stage.md`](features/01-stage.md): Stage 实验性 CLI 多 agent 控制台及 Discord runtime 边界。
- [`features/15-ralph-controller.md`](features/15-ralph-controller.md): plan-based fresh-context Codex execution controller。

## Plans

- [`plans/README.md`](plans/README.md): 非平凡开发任务的 plan 文档规范。
- [`plans/2026-05-15-documentation-strategy.md`](plans/2026-05-15-documentation-strategy.md): `docs/` 作为 LLM 维护的 docs-driven development source of truth，GitHub Pages 作为 human-facing portal 的分层策略。
- `plans/YYYY-MM-DD-*.md`: 已完成或进行中的实施计划。

## Chinese Docs

- [`zh/README.md`](zh/README.md): tracked 中文文档索引和维护规则。
- [`zh/plans/2026-05-15-documentation-strategy.zh.md`](zh/plans/2026-05-15-documentation-strategy.zh.md): 文档策略计划中文版本。
- `docs/zh/**`: English source docs 的中文 mirror。每个中文文档应包含 `doc_id`、`lang`、`translation_of` 和 `translation_status` frontmatter。

中文文档不再是本地 review copy；它是 repo docs 的 first-class language layer。未完成翻译必须显式标记 `translation_status: pending`。

## Website

- `../website/en/`: English GitHub Pages source。
- `../website/zh/`: Chinese GitHub Pages source。
- `../website/llms.txt`: LLM-facing website note。

Website pages must stay presentation-only and declare language-aware `source_docs` frontmatter. Website pages do not satisfy code-to-docs drift requirements; canonical implementation facts still belong in `docs/`.

## Archive

- [`archive/2026-05-11-continuous-improvement-report.md`](archive/2026-05-11-continuous-improvement-report.md): 2026-05-11 架构审计和持续优化历史报告；不再作为当前 source of truth。

## Runbooks

- [`runbooks/install.md`](runbooks/install.md): MiniClaw 1.0 面向技术用户的安装、配置和故障排查流程。
- [`runbooks/local-deploy.md`](runbooks/local-deploy.md): 本机 PM2 runtime 的安全 deploy、safe restart、回滚和验证流程。

## Private

- `private/eastmoney/`: 东方财富相关私有调研和敏感设计边界。

## Placement Rules

- 全局架构、路由、工程治理和 framework-level prompt 文档放在 `docs/` 顶层。
- Runtime 文档放在 `docs/runtime/`，provider 文档放在 `docs/providers/`，实验控制面放在 `docs/experiments/`。
- `docs/features/` 是迁移期 legacy detailed-doc 目录；旧 feature 文件继续保留一轮以保护历史链接，但新增 source-of-truth 文档优先进入 runtime/providers/experiments 分类目录。
- 实施计划只放 `docs/plans/`，不要与当前设计文档混放。
- 过期审计报告、历史复盘和不再维护的全局路线图放在 `docs/archive/`，不能替代当前 source-of-truth 文档。
- 可执行运维流程放在 `docs/runbooks/`。
- 含账户、cookie、交易后台细节的私有调研放 `docs/private/`。
- 中文文档放在 `docs/zh/`，镜像英文相对路径并使用 `.zh.md` 后缀。
- 当前 docs 移动、合并或 archive 之前，先更新 `docs/documentation-migration-map.md`。
- Website content 放在 `website/`，不能把 `docs/plans/**`、`docs/archive/**` 或 `docs/private/**` 直接当作当前公开文档发布。
