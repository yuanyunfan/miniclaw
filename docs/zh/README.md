---
doc_id: docs-index
lang: zh
translation_of: docs/README.md
translation_status: current
source_sha256: 65702341101c1a1ee0fbb3c0cf2c35b5a0bc8e6f67b7c792e1cd6920a45d7aa7
---
# MiniClaw 文档索引

> 结论：`docs/` 是 MiniClaw 面向 LLM 和维护者的实现真相源；`website/` 是面向人的 GitHub Pages 展示层。根目录 `docs/` 是英文 canonical tree，`docs/zh/` 是 tracked 中文镜像。双语 pairing 状态记录在 `documentation-migration-map.md`。

## 核心设计

- [`architecture.md`](../architecture.md)：系统架构、runtime 边界、数据流、存储模型和用户级 `~/.miniclaw/` 布局。
- [`bot-routing.md`](../bot-routing.md)：Discord Gateway 事件路由、message path、slash command、button dispatch 和 thread continuation。
- [`chat-router-current-logic.md`](../chat-router-current-logic.md)：当前 chat/task 路由逻辑、Smart Router capability mapping、确认按钮和已知误分流边界。
- [`install-distribution-strategy.md`](../install-distribution-strategy.md)：面向外部技术用户的安装、配置向导、release artifact 和本地部署策略。
- [`prompts.md`](../prompts.md)：framework-level prompt 资产和 prompt loader 规则。
- [`quality-gates.md`](../quality-gates.md)：测试分层、质量门禁、docs drift gate、双语 docs gate 和 Discord E2E 策略。
- [`documentation-migration-map.md`](../documentation-migration-map.md)：docs 迁移、双语 pairing、website exposure、private/archive 边界的 machine-readable 地图。

## Runtime

- [`runtime/README.md`](runtime/README.zh.md)：Discord intake、routing、chat/task/cron runtime、memory/context 和 operations 的 runtime 真相源。

runtime compatibility stub 已移除，内容已经合并到 `runtime/README.md` 和顶层 routing docs。

## Providers

- [`providers/README.md`](providers/README.zh.md)：provider 文档索引和维护规则。
- [`providers/provider-framework.md`](providers/provider-framework.zh.md)：provider framework 的 manifest、health check、dry run、structured output、fixture 和 failure taxonomy。
- [`providers/content.md`](providers/content.zh.md)：content provider family，目前覆盖 WeChat MP ingestion 和 dedupe 边界。
- [`providers/email.md`](providers/email.zh.md)：email provider family，区分 read-only email capability 和业务 parser。
- [`providers/stock/README.md`](providers/stock/README.zh.md)：stock provider family 数据流和 Futu readonly provider 边界。
- [`providers/stock/eastmoney.md`](providers/stock/eastmoney.zh.md)：Eastmoney provider family，包括 JYWG readonly 和 MyFavor watchlist。
- [`providers/stock/research.md`](providers/stock/research.zh.md)：stock research provider pipeline，连接 portfolio、pulse、market intel 和 watchlist research。

provider compatibility stub 已移除，内容已经合并到上面的 provider-family docs。

## Experiments

- [`experiments/README.md`](experiments/README.zh.md)：实验性 control plane 索引。

experiment compatibility stub 已移除，Stage 和 Ralph 内容已经合并到 `experiments/README.md` 和 Ralph docs。

## Plans

- [`plans/README.md`](plans/README.zh.md)：非平凡开发任务的 plan 文档规则。
- [`plans/2026-05-15-documentation-strategy.md`](plans/2026-05-15-documentation-strategy.zh.md)：已完成的文档策略；`docs/` 是 docs-driven source of truth，GitHub Pages 是 human portal。
- `plans/YYYY-MM-DD-*.md`：已完成或进行中的实施计划。

## 中文文档

- [`zh/README.md`](README.md)：本索引的中文镜像。
- `docs/zh/**`：英文 canonical docs 的中文镜像。每个 tracked 中文 mirror 必须包含 `doc_id`、`lang: zh`、`translation_of`、`translation_status` 和 `source_sha256` frontmatter。

中文文档不再是本地 review copy，而是 repo docs 的一等语言层。required mirror 必须保持 `translation_status: current`，并且 `source_sha256` 必须匹配英文 source。

## Website

- `../website/en/`：英文 GitHub Pages source。
- `../website/zh/`：中文 GitHub Pages source。
- `../website/llms.txt`：面向 LLM 的 website note。

website pages 只能作为 presentation layer，并通过 `source_docs` frontmatter 指向 canonical docs。website 不能替代 `docs/` 作为实现真相源。

## Archive

- [`archive/2026-05-11-continuous-improvement-report.md`](../archive/2026-05-11-continuous-improvement-report.md)：历史架构审计和持续优化报告；不是当前真相源。

## Runbooks

- [`runbooks/install.md`](runbooks/install.zh.md)：MiniClaw 1.0 的安装、配置和故障排查流程。
- [`runbooks/local-deploy.md`](runbooks/local-deploy.zh.md)：本地 PM2 runtime 的 safe deploy、safe restart、rollback 和验证流程。

## Private

- `private/eastmoney/`：Eastmoney 私有研究和敏感设计边界。该目录故意排除在 public website exposure 和 bilingual parity gate 之外。

## 放置规则

- 全局架构、routing、工程治理和 framework-level prompt docs 放在 `docs/` 顶层。
- runtime docs 放在 `docs/runtime/`，provider docs 放在 `docs/providers/`，实验性 control-plane docs 放在 `docs/experiments/`。
- 不新增 feature-level compatibility stub。当前真相源应进入 runtime、provider 或 experiment family docs。
- implementation plan 只放在 `docs/plans/`，不要和当前设计文档混放。
- 过期审计、历史复盘、退役路线图放在 `docs/archive/`，不能替代当前 source-of-truth docs。
- 可执行运维流程放在 `docs/runbooks/`。
- 含账户、cookie、交易后台或其他敏感细节的私有调研放在 `docs/private/`。
- 中文文档放在 `docs/zh/`，镜像英文相对路径，普通文件使用 `.zh.md` 后缀，README mirror 例外。
- 移动、合并、archive 或 website exposure 变更前，先更新 `docs/documentation-migration-map.md`。
- website 内容放在 `website/`。不要把 `docs/plans/**`、`docs/archive/**` 或 `docs/private/**` 直接作为当前 public docs 发布。
