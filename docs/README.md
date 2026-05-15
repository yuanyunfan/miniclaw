# MiniClaw Docs Index

> 结论：`docs/` 是 MiniClaw 的 implementation source of truth，面向 LLM 和维护者；`website/` 是面向人的 GitHub Pages 展示层。短期内 root `docs/` 仍作为 English canonical tree，`docs/zh/` 是 tracked Chinese mirror，迁移状态由 `documentation-migration-map.md` 记录。

## Core Design

- [`architecture.md`](architecture.md): MiniClaw 全局架构、数据流、cron、DB、用户级目录。
- [`bot-routing.md`](bot-routing.md): Discord Gateway、message、slash command、thread continuation、chat/task routing。
- [`chat-router-current-logic.md`](chat-router-current-logic.md): 当前 chat router 的代码级判断逻辑、capability 映射、确认按钮和真实误分流边界。
- [`install-distribution-strategy.md`](install-distribution-strategy.md): 面向外部用户的安装、配置向导、Release artifact 和本机 Deploy 改造建议。
- [`prompts.md`](prompts.md): 框架级 prompt 资产管理。
- [`quality-gates.md`](quality-gates.md): 测试分层、质量门禁、Discord E2E 方案。
- [`documentation-migration-map.md`](documentation-migration-map.md): 当前 docs 迁移、双语 pairing、website exposure 的 machine-readable 地图。

## Runtime

- [`runtime/README.md`](runtime/README.md): Discord intake、routing、chat/task/cron runtime、memory/context、operations 的当前 source-of-truth 入口。

Archived runtime feature records:

- [`archive/features/03-discord-task-output.md`](archive/features/03-discord-task-output.md): moved into [`runtime/README.md`](runtime/README.md#task-output-and-trace-ux).
- [`archive/features/04-smart-task-router.md`](archive/features/04-smart-task-router.md): merged into [`runtime/README.md`](runtime/README.md#intake-and-routing), [`bot-routing.md`](bot-routing.md), and [`chat-router-current-logic.md`](chat-router-current-logic.md).
- [`archive/features/05-smart-task-router.en.md`](archive/features/05-smart-task-router.en.md): merged into [`runtime/README.md`](runtime/README.md#intake-and-routing), [`bot-routing.md`](bot-routing.md), and [`chat-router-current-logic.md`](chat-router-current-logic.md).
- [`archive/features/12-connectivity-monitor.md`](archive/features/12-connectivity-monitor.md): moved into [`runtime/README.md`](runtime/README.md#connectivity-and-recovery).
- [`archive/features/13-auto-doctor.md`](archive/features/13-auto-doctor.md): moved into [`runtime/README.md`](runtime/README.md#auto-doctor).
- [`archive/features/19-agent-prompt-context-audit.md`](archive/features/19-agent-prompt-context-audit.md): moved into [`runtime/README.md`](runtime/README.md#memory-and-prompt-context).
- [`archive/features/20-memory-curation-lifecycle.md`](archive/features/20-memory-curation-lifecycle.md): moved into [`runtime/README.md`](runtime/README.md#memory-and-prompt-context).
- [`archive/features/21-agent-run-manager.md`](archive/features/21-agent-run-manager.md): moved into [`runtime/README.md`](runtime/README.md#agent-run-manager).

## Providers

- [`providers/README.md`](providers/README.md): Provider 文档总入口，描述 provider runtime、trust boundary、privacy boundary 和维护规则。
- [`providers/provider-framework.md`](providers/provider-framework.md): Provider framework source of truth，覆盖 manifest、health、dry-run、structured output、fixture 和 failure taxonomy。
- [`providers/content.md`](providers/content.md): Content provider family，当前覆盖 WeChat MP ingestion 和 dedupe 边界。
- [`providers/email.md`](providers/email.md): Email provider family，区分通用只读 email capability 与业务 parser。
- [`providers/stock/README.md`](providers/stock/README.md): Stock provider family 数据流与 Futu readonly provider 边界。
- [`providers/stock/eastmoney.md`](providers/stock/eastmoney.md): Eastmoney provider family，是 JYWG readonly 和 MyFavor watchlist 的当前 source of truth。
- [`providers/stock/research.md`](providers/stock/research.md): Stock research provider pipeline，串联 portfolio、pulse、market-intel 和 watchlist research。

Archived provider feature records:

- [`archive/features/02-wechat-mp-provider.md`](archive/features/02-wechat-mp-provider.md): merged into [`providers/content.md`](providers/content.md#wechat-mp-provider).
- [`archive/features/06-futu-stock.md`](archive/features/06-futu-stock.md): moved into [`providers/stock/README.md`](providers/stock/README.md#futu-stock-provider).
- [`archive/features/10-stock-portfolio-provider.md`](archive/features/10-stock-portfolio-provider.md): merged into [`providers/stock/research.md`](providers/stock/research.md#stock-portfolio).
- [`archive/features/11-stock-pulse-provider.md`](archive/features/11-stock-pulse-provider.md): merged into [`providers/stock/research.md`](providers/stock/research.md#stock-pulse).
- [`archive/features/14-market-intel-provider.md`](archive/features/14-market-intel-provider.md): merged into [`providers/stock/research.md`](providers/stock/research.md#market-intel).
- [`archive/features/16-provider-framework.md`](archive/features/16-provider-framework.md): moved into [`providers/provider-framework.md`](providers/provider-framework.md).
- [`archive/features/18-stock-watchlist-research-provider.md`](archive/features/18-stock-watchlist-research-provider.md): merged into [`providers/stock/research.md`](providers/stock/research.md#stock-watchlist-research).

Archived email feature records:

- [`archive/features/07-email-capability.md`](archive/features/07-email-capability.md): merged into [`providers/email.md`](providers/email.md#shared-read-only-email-capability).
- [`archive/features/08-cmb-credit-card-email-provider.md`](archive/features/08-cmb-credit-card-email-provider.md): merged into [`providers/email.md`](providers/email.md#cmb-credit-card-email-provider).

Archived Eastmoney feature records:

- [`archive/features/09-eastmoney-jywg-readonly-provider.md`](archive/features/09-eastmoney-jywg-readonly-provider.md): merged into [`providers/stock/eastmoney.md`](providers/stock/eastmoney.md#jywg-readonly-provider).
- [`archive/features/17-eastmoney-myfavor-watchlist.md`](archive/features/17-eastmoney-myfavor-watchlist.md): merged into [`providers/stock/eastmoney.md`](providers/stock/eastmoney.md#myfavor-watchlist-provider).

## Experiments

- [`experiments/README.md`](experiments/README.md): 实验性控制面总入口。
- [`archive/features/01-stage.md`](archive/features/01-stage.md): moved into [`experiments/README.md`](experiments/README.md#stage).
- [`archive/features/15-ralph-controller.md`](archive/features/15-ralph-controller.md): moved into [`experiments/README.md`](experiments/README.md#ralph-controller) and [`ralph/README.md`](ralph/README.md).

## Plans

- [`plans/README.md`](plans/README.md): 非平凡开发任务的 plan 文档规范。
- [`plans/2026-05-15-documentation-strategy.md`](plans/2026-05-15-documentation-strategy.md): 已完成的分层文档策略；`docs/` 作为 LLM 维护的 docs-driven development source of truth，GitHub Pages 作为 human-facing portal。
- `plans/YYYY-MM-DD-*.md`: 已完成或进行中的实施计划。

## Chinese Docs

- [`zh/README.md`](zh/README.md): tracked 中文文档索引和维护规则。
- [`zh/plans/2026-05-15-documentation-strategy.zh.md`](zh/plans/2026-05-15-documentation-strategy.zh.md): 文档策略计划中文版本。
- `docs/zh/**`: English source docs 的中文 mirror。每个中文文档应包含 `doc_id`、`lang`、`translation_of` 和 `translation_status` frontmatter。

中文文档不再是本地 review copy；它是 repo docs 的 first-class language layer。Required 中文 pair 必须保持 `translation_status: current`，不需要中文 pair 的 source doc 才能在 migration map 中标记为 `not_required`。

## Website

- `../website/en/`: English GitHub Pages source。
- `../website/zh/`: Chinese GitHub Pages source。
- `../website/llms.txt`: LLM-facing website note。

Website pages must stay presentation-only and declare language-aware `source_docs` frontmatter. Website pages do not satisfy code-to-docs drift requirements; canonical implementation facts still belong in `docs/`.

## Archive

- [`archive/2026-05-11-continuous-improvement-report.md`](archive/2026-05-11-continuous-improvement-report.md): 2026-05-11 架构审计和持续优化历史报告；不再作为当前 source of truth。
- [`archive/features/`](archive/features/): 旧 `docs/features/*.md` 兼容 stub 的统一归档位置；当前实现事实已经迁移到 runtime/providers/experiments 文档。

## Runbooks

- [`runbooks/install.md`](runbooks/install.md): MiniClaw 1.0 面向技术用户的安装、配置和故障排查流程。
- [`runbooks/local-deploy.md`](runbooks/local-deploy.md): 本机 PM2 runtime 的安全 deploy、safe restart、回滚和验证流程。

## Private

- `private/eastmoney/`: 东方财富相关私有调研和敏感设计边界。

## Placement Rules

- 全局架构、路由、工程治理和 framework-level prompt 文档放在 `docs/` 顶层。
- Runtime 文档放在 `docs/runtime/`，provider 文档放在 `docs/providers/`，实验控制面放在 `docs/experiments/`。
- `docs/archive/features/` 是旧 feature 兼容 stub 的统一归档位置；当前 source-of-truth 文档已经进入 runtime/providers/experiments 分类目录。
- 实施计划只放 `docs/plans/`，不要与当前设计文档混放。
- 过期审计报告、历史复盘和不再维护的全局路线图放在 `docs/archive/`，不能替代当前 source-of-truth 文档。
- 可执行运维流程放在 `docs/runbooks/`。
- 含账户、cookie、交易后台细节的私有调研放 `docs/private/`。
- 中文文档放在 `docs/zh/`，镜像英文相对路径并使用 `.zh.md` 后缀。
- 当前 docs 移动、合并或 archive 之前，先更新 `docs/documentation-migration-map.md`。
- Website content 放在 `website/`，不能把 `docs/plans/**`、`docs/archive/**` 或 `docs/private/**` 直接当作当前公开文档发布。
