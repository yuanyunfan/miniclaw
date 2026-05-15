---
doc_id: runtime-index
lang: zh
translation_of: docs/runtime/README.md
translation_status: pending
---

# MiniClaw Runtime

> 这个中文文档当前是 tracked 摘要，占位对应 `docs/runtime/README.md`。完整翻译完成后再把 `translation_status` 改为 `current`。

Runtime 文档现在是 `docs/features` 迁移后的当前 source of truth，覆盖：

- Discord / IM intake、slash command、thread continuation 和 chat/task routing。
- Smart Router 的 deterministic guard、LLM classifier、policy resolver 和 confirmation state。
- Task output、TaskReporter、task-view events、Discord view rendering 和 trace export。
- Cron runtime、pre-provider context、provider commit callback 和 cron run persistence。
- Prompt/context assembly、memory injection、memory curation lifecycle 和 prompt audit 边界。
- Connectivity monitor、recovery outbox、pre-clientReady watchdog 和 SMTP fallback notifier。
- Auto Doctor diagnose、incident persistence、guarded repair、guarded ship 和 redaction boundary。
- Agent Run Manager、Agent Bus、managed child runtime、ACP lifecycle、final synthesis 和 guardrails。

迁移状态：

- runtime 相关 legacy feature docs 已变成兼容 stub，当前事实维护在英文 `docs/runtime/README.md`。
- 中文完整翻译仍是 pending；在此之前，英文 runtime doc 是实现事实来源。
