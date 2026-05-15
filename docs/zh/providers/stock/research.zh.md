---
doc_id: stock-research-provider-pipeline
lang: zh
translation_of: docs/providers/stock/research.md
translation_status: pending
---

# Stock Research Provider Pipeline

> 这个中文文档当前是 tracked 摘要，占位对应 `docs/providers/stock/research.md`。完整翻译完成后再把 `translation_status` 改为 `current`。

Stock research pipeline 把多个股票相关 provider 作为一个数据流来维护：

- `stock-portfolio`: 聚合 Futu / Eastmoney JYWG 等只读 account providers，生成 CNY P&L、top movers、premium summary 和 private-channel asset summary。
- `stock-pulse`: 在交易时段和个人 active window 内扫描 holdings / watchlist / universe sources，用 deterministic anomaly scoring 生成 `alerts[]`。
- `market-intel`: 收集 macro、policy、news、filings、quote 和 market evidence，持久化 forecast / forecast items / post-market evaluations。
- `stock-watchlist-research`: 读取 broker watchlist universe，排除已持仓标的，生成 watchlist-only 买入时点研究。

核心 contract：

- Holdings 和 watchlists 是不同 source type，不能隐式合并。
- Provider 层先计算 deterministic evidence，再交给 LLM 解释。
- Watchlist research 必须保留 `watchlist_only=true`，不能输出账户资产、成本价、持仓数量或盈亏。
- Market probabilities 是研究输入，不是交易指令。
- 任何 provider 都不能解锁交易、下单、改单、撤单或划拨资金。

迁移状态：

- `docs/features/10-stock-portfolio-provider.md`、`11-stock-pulse-provider.md`、`14-market-intel-provider.md` 和 `18-stock-watchlist-research-provider.md` 已变成兼容 stub。
- 当前事实维护在英文 `docs/providers/stock/research.md`。
- 中文完整翻译仍是 pending；在此之前，英文 stock research doc 是实现事实来源。
