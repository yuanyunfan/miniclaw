---
doc_id: stock-providers-index
lang: zh
translation_of: docs/providers/stock/README.md
translation_status: pending
---

# Stock Provider Family

> 这个中文文档当前是 tracked 摘要，占位对应 `docs/providers/stock/README.md`。完整翻译完成后再把 `translation_status` 改为 `current`。

Stock provider family 当前覆盖：

- Futu readonly account / watchlist provider：通过本机 Futu OpenD 和官方 SDK 读取账户快照、持仓摘要、日报上下文和 watchlist symbols。
- Eastmoney provider family：JYWG readonly holdings 与 MyFavor watchlist，详见 `docs/providers/stock/eastmoney.md`。
- Stock research pipeline：portfolio、pulse、market-intel 和 watchlist research，详见 `docs/providers/stock/research.md`。

核心 contract：

- Futu / Eastmoney account holdings 和 watchlist observation universe 不能混用。
- Futu provider 不保存交易密码，不调用 `unlock_trade`、`place_order`、`modify_order` 或资金划拨相关能力。
- Watchlist rows 只能作为观察池；除非同时来自 account/portfolio provider，否则不能被渲染成持仓。
- 账户、cookie、token、validatekey、手机号、交易密码和客户号不能进入 logs、Discord 或 LLM prompt。

迁移状态：

- `docs/features/06-futu-stock.md` 已变成兼容 stub，当前事实维护在英文 `docs/providers/stock/README.md` 的 Futu Stock Provider section。
- 中文完整翻译仍是 pending；在此之前，英文 stock provider doc 是实现事实来源。
