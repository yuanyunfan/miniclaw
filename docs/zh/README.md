---
doc_id: zh-docs-index
lang: zh
translation_status: not_required
---

# MiniClaw 中文文档

这个目录现在是 tracked 的中文文档树，不再是本地 review-copy 目录。

当前策略：

- `docs/` 根目录继续作为短期 English canonical tree。
- `docs/zh/` 镜像 English docs 的相对路径，并用 `.zh.md` 后缀标识中文版本。
- 每个中文文档应包含 `doc_id`、`lang: zh`、`translation_of` 和 `translation_status` frontmatter。
- `translation_status: current` 表示中文内容应与英文 source 保持结构同步。
- `translation_status: pending` 不再允许用于 `translation_required=true` 的文档；确实不需要中文 pair 的 source doc 应在 migration map 中标为 `translation_status: not_required`。
- 迁移期仍保留少量历史平铺 `.zh.md` 翻译；新的 first-class pairing 以镜像英文相对路径为准。

## Current Chinese Docs

- [`plans/2026-05-15-documentation-strategy.zh.md`](plans/2026-05-15-documentation-strategy.zh.md): 文档策略计划的中文版本。
- [`architecture.zh.md`](architecture.zh.md): 架构文档中文 mirror。
- [`runtime/README.zh.md`](runtime/README.zh.md): Runtime 文档中文 mirror。
- [`experiments/README.zh.md`](experiments/README.zh.md): Experiments 文档中文 mirror。
- [`providers/README.zh.md`](providers/README.zh.md): Provider docs index 中文 mirror。
- [`providers/provider-framework.zh.md`](providers/provider-framework.zh.md): Provider framework 新 taxonomy 入口中文 mirror。
- [`providers/content.zh.md`](providers/content.zh.md): Content provider family 中文 mirror。
- [`providers/email.zh.md`](providers/email.zh.md): Email provider family 中文 mirror。
- [`providers/stock/README.zh.md`](providers/stock/README.zh.md): Stock provider family 中文 mirror。
- [`providers/stock/eastmoney.zh.md`](providers/stock/eastmoney.zh.md): Eastmoney provider family 中文 mirror。
- [`providers/stock/research.zh.md`](providers/stock/research.zh.md): Stock research provider pipeline 中文 mirror。
- [`features/16-provider-framework.zh.md`](features/16-provider-framework.zh.md): 历史 provider framework feature 中文兼容 stub；当前 pairing 已迁移到 `providers/provider-framework.zh.md`。
- [`quality-gates.zh.md`](quality-gates.zh.md): 质量门禁中文 mirror。
- [`runbooks/install.zh.md`](runbooks/install.zh.md): 安装 runbook 中文 mirror。
- 平铺历史翻译：`2026-05-*.zh.md`、`13-auto-doctor.zh.md`、`19-agent-prompt-context-audit.zh.md`。这些文件保留用于人工审阅，后续迁移 slice 再逐步归入镜像路径或 archive。

## Maintenance

- 迁移状态由 [`../documentation-migration-map.md`](../documentation-migration-map.md) 记录。
- `pnpm run quality:docs-i18n` 会检查中文文档 pairing、frontmatter 和基础 heading parity；required 中文 pair 缺失或 pending 都是 blocking error。
- 当英文 source doc 变更时，应在同一 patch 同步更新对应中文文档，不能把 required translation 降级为 pending。
