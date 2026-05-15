---
doc_id: eastmoney-provider-family
lang: zh
translation_of: docs/providers/stock/eastmoney.md
translation_status: pending
---

# 东方财富 Provider Family

> 这个中文文档当前是 tracked 摘要，占位对应 `docs/providers/stock/eastmoney.md`。英文 source 已合并 JYWG readonly 和 MyFavor watchlist 两个 legacy feature 文档；完整翻译完成后再把 `translation_status` 改为 `current`。

MiniClaw 的东方财富集成分成两个运行时边界：

- `eastmoney-jywg-readonly`: 读取 `jywg.18.cn` 的账户持仓和账户证据，服务 `stock-portfolio`。
- `eastmoney-myfavor`: 读取 `myfavor.eastmoney.com` 的自选股分组和证券列表，服务 `stock-pulse` universe 和 watchlist research。

两者可以在 docs 里归为同一个 provider family，但 runtime 不能混用 session、endpoint 或业务语义。

迁移状态：

- `docs/features/09-eastmoney-jywg-readonly-provider.md` 已变成兼容 stub，当前事实维护在英文 family doc 的 JYWG section。
- `docs/features/17-eastmoney-myfavor-watchlist.md` 已变成兼容 stub，当前事实维护在英文 family doc 的 MyFavor section。
- 中文完整翻译仍是 pending；在此之前，英文 `docs/providers/stock/eastmoney.md` 是该 family 的实现事实来源。
