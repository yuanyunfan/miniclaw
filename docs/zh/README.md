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
- `translation_status: pending` 表示该中文文档是占位或摘要，后续需要补齐。
- 迁移期仍保留少量历史平铺 `.zh.md` 翻译；新的 first-class pairing 以镜像英文相对路径为准。

## Current Chinese Docs

- [`plans/2026-05-15-documentation-strategy.zh.md`](plans/2026-05-15-documentation-strategy.zh.md): 文档策略计划的中文版本。
- [`architecture.zh.md`](architecture.zh.md): 架构文档中文占位，等待完整翻译。
- [`features/16-provider-framework.zh.md`](features/16-provider-framework.zh.md): Provider framework 中文占位，等待完整翻译。
- [`quality-gates.zh.md`](quality-gates.zh.md): 质量门禁中文占位，等待完整翻译。
- [`runbooks/install.zh.md`](runbooks/install.zh.md): 安装 runbook 中文占位，等待完整翻译。
- 平铺历史翻译：`2026-05-*.zh.md`、`13-auto-doctor.zh.md`、`19-agent-prompt-context-audit.zh.md`。这些文件保留用于人工审阅，后续迁移 slice 再逐步归入镜像路径或 archive。

## Maintenance

- 迁移状态由 [`../documentation-migration-map.md`](../documentation-migration-map.md) 记录。
- `pnpm run quality:docs-i18n` 会检查中文文档 pairing、frontmatter 和基础 heading parity。
- 当英文 source doc 变更时，应同步更新对应中文文档，或把中文文档标记为 `translation_status: pending`。
