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

Runtime feature-level compatibility stubs have been removed after their content was merged into `runtime/README.md` and the top-level routing docs.

## Providers

- [`providers/README.md`](providers/README.md): Provider 文档总入口，描述 provider runtime、trust boundary、privacy boundary 和维护规则。
- [`providers/provider-framework.md`](providers/provider-framework.md): Provider framework source of truth，覆盖 manifest、health、dry-run、structured output、fixture 和 failure taxonomy。
- [`providers/content.md`](providers/content.md): Content provider family，当前覆盖 WeChat MP ingestion 和 dedupe 边界。
- [`providers/email.md`](providers/email.md): Email provider family，区分通用只读 email capability 与业务 parser。
- [`providers/stock/README.md`](providers/stock/README.md): Stock provider family 数据流与 Futu readonly provider 边界。
- [`providers/stock/eastmoney.md`](providers/stock/eastmoney.md): Eastmoney provider family，是 JYWG readonly 和 MyFavor watchlist 的当前 source of truth。
- [`providers/stock/research.md`](providers/stock/research.md): Stock research provider pipeline，串联 portfolio、pulse、market-intel 和 watchlist research。

Provider feature-level compatibility stubs have been removed after their content was merged into the provider-family docs above.

## Experiments

- [`experiments/README.md`](experiments/README.md): 实验性控制面总入口。
Experiment feature-level compatibility stubs have been removed after Stage and Ralph content was merged into `experiments/README.md` and `ralph/README.md`.

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

## Runbooks

- [`runbooks/install.md`](runbooks/install.md): MiniClaw 1.0 面向技术用户的安装、配置和故障排查流程。
- [`runbooks/local-deploy.md`](runbooks/local-deploy.md): 本机 PM2 runtime 的安全 deploy、safe restart、回滚和验证流程。

## Private

- `private/eastmoney/`: 东方财富相关私有调研和敏感设计边界。

## Placement Rules

- 全局架构、路由、工程治理和 framework-level prompt 文档放在 `docs/` 顶层。
- Runtime 文档放在 `docs/runtime/`，provider 文档放在 `docs/providers/`，实验控制面放在 `docs/experiments/`。
- 不再新增 feature-level compatibility stub；当前 source-of-truth 文档已经进入 runtime/providers/experiments 分类目录。
- 实施计划只放 `docs/plans/`，不要与当前设计文档混放。
- 过期审计报告、历史复盘和不再维护的全局路线图放在 `docs/archive/`，不能替代当前 source-of-truth 文档。
- 可执行运维流程放在 `docs/runbooks/`。
- 含账户、cookie、交易后台细节的私有调研放 `docs/private/`。
- 中文文档放在 `docs/zh/`，镜像英文相对路径并使用 `.zh.md` 后缀。
- 当前 docs 移动、合并或 archive 之前，先更新 `docs/documentation-migration-map.md`。
- Website content 放在 `website/`，不能把 `docs/plans/**`、`docs/archive/**` 或 `docs/private/**` 直接当作当前公开文档发布。
