---
doc_id: providers-index
lang: zh
translation_of: docs/providers/README.md
translation_status: pending
---

# MiniClaw Providers

> 这个中文文档当前是 tracked 摘要，占位对应 `docs/providers/README.md`。完整翻译完成后再把 `translation_status` 改为 `current`。

Provider docs 是 MiniClaw 外部数据采集、pre-provider context、provider safety boundary、health/dry-run 行为和 provider output contract 的 source-of-truth。

当前 provider families：

- Provider framework: manifest、health、dry-run、structured output、fixtures 和 failure taxonomy。
- Content: WeChat MP metadata ingestion。
- Email: read-only Email capability、`email-query` 和 `cmb-credit-card-email`。
- Stock: Futu、Eastmoney、portfolio、pulse、market-intel 和 watchlist research。

Provider docs 和 runtime docs 的边界：

- Provider docs 维护 trusted source、privacy boundary、output schema、state/session commit semantics。
- Runtime docs 维护 Discord/IM intake、routing、task execution、delivery 和 operations behavior。

中文完整翻译仍是 pending；在此之前，英文 `docs/providers/README.md` 是 provider index 的实现事实来源。
