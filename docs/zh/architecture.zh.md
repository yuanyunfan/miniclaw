---
doc_id: architecture
lang: zh
translation_of: docs/architecture.md
translation_status: pending
---

# MiniClaw 架构

> 这个中文文档当前是 tracked 占位摘要。完整翻译应以 `docs/architecture.md` 为 source，并在完成后把 `translation_status` 改为 `current`。

MiniClaw 的 canonical 架构事实仍以英文 source doc 和代码为准。后续迁移需要同步：

- runtime bootstrap 和 Discord intake/routing。
- Agent/Codex/Claude task runtime。
- cron scheduler 和 provider pre-context。
- SQLite data model 和 schema version。
- operations、connectivity、Auto Doctor 和 quality gates。
