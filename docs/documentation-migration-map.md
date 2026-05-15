# MiniClaw Documentation Migration Map

Status: initial
Date: 2026-05-15

This file is the first machine-readable inventory for the documentation strategy in
[`docs/plans/2026-05-15-documentation-strategy.md`](plans/2026-05-15-documentation-strategy.md).
It intentionally starts with the public website source set and the highest-drift
provider/runtime docs. Later migration slices should expand it until every tracked
Markdown doc is classified before large file moves begin.

Field meanings:

- `source_path`: current English or canonical source path.
- `target_path`: future or merged source path when a legacy doc is being moved or merged.
- `zh_path`: tracked Chinese documentation pair when one exists or is planned.
- `status`: current migration action: `keep`, `move`, `merge`, `archive`, `private`, or `website-source`.
- `merge_group`: logical group for docs that should eventually merge.
- `website_exposure`: whether the concept can be public, internal, history-only, private, or not exposed.
- `translation_required`: whether the Chinese pair must exist before strict i18n enforcement.
- `translation_status`: `current`, `pending`, or `not_required`.

```json
[
  {
    "doc_id": "documentation-strategy",
    "source_path": "docs/plans/2026-05-15-documentation-strategy.md",
    "zh_path": "docs/zh/plans/2026-05-15-documentation-strategy.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "runtime-index",
    "source_path": "docs/runtime/README.md",
    "zh_path": null,
    "category": "runtime",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "providers-index",
    "source_path": "docs/providers/README.md",
    "zh_path": null,
    "category": "provider",
    "status": "keep",
    "merge_group": "providers",
    "website_exposure": "public",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "stock-providers-index",
    "source_path": "docs/providers/stock/README.md",
    "zh_path": null,
    "category": "provider",
    "status": "keep",
    "merge_group": "providers/stock",
    "website_exposure": "public",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "content-provider-family",
    "source_path": "docs/providers/content.md",
    "zh_path": null,
    "category": "provider",
    "status": "keep",
    "merge_group": "providers/content",
    "website_exposure": "public",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "email-provider-family",
    "source_path": "docs/providers/email.md",
    "zh_path": null,
    "category": "provider",
    "status": "keep",
    "merge_group": "providers/email",
    "website_exposure": "public",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "stock-research-provider-pipeline",
    "source_path": "docs/providers/stock/research.md",
    "zh_path": null,
    "category": "provider",
    "status": "website-source",
    "merge_group": "providers/stock/research",
    "website_exposure": "public",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "experiments-index",
    "source_path": "docs/experiments/README.md",
    "zh_path": null,
    "category": "experiment",
    "status": "keep",
    "merge_group": "experiments",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "architecture",
    "source_path": "docs/architecture.md",
    "zh_path": "docs/zh/architecture.zh.md",
    "category": "architecture",
    "status": "website-source",
    "merge_group": null,
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "pending"
  },
  {
    "doc_id": "provider-framework",
    "source_path": "docs/providers/provider-framework.md",
    "zh_path": "docs/zh/providers/provider-framework.zh.md",
    "category": "provider",
    "status": "website-source",
    "merge_group": "providers",
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "pending"
  },
  {
    "doc_id": "wechat-mp-provider",
    "source_path": "docs/features/02-wechat-mp-provider.md",
    "target_path": "docs/providers/content.md",
    "zh_path": null,
    "category": "provider",
    "status": "merge",
    "merge_group": "providers/content",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "futu-stock-provider",
    "source_path": "docs/features/06-futu-stock.md",
    "target_path": "docs/providers/stock/README.md",
    "zh_path": null,
    "category": "provider",
    "status": "move",
    "merge_group": "providers/stock",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "email-capability",
    "source_path": "docs/features/07-email-capability.md",
    "target_path": "docs/providers/email.md",
    "zh_path": null,
    "category": "provider",
    "status": "merge",
    "merge_group": "providers/email",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "cmb-credit-card-email-provider",
    "source_path": "docs/features/08-cmb-credit-card-email-provider.md",
    "target_path": "docs/providers/email.md",
    "zh_path": null,
    "category": "provider",
    "status": "merge",
    "merge_group": "providers/email",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "provider-framework-legacy",
    "source_path": "docs/features/16-provider-framework.md",
    "target_path": "docs/providers/provider-framework.md",
    "zh_path": null,
    "category": "provider",
    "status": "move",
    "merge_group": "providers",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "eastmoney-provider-family",
    "source_path": "docs/providers/stock/eastmoney.md",
    "zh_path": "docs/zh/providers/stock/eastmoney.zh.md",
    "category": "provider",
    "status": "website-source",
    "merge_group": "providers/eastmoney",
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "pending"
  },
  {
    "doc_id": "eastmoney-jywg-readonly",
    "source_path": "docs/features/09-eastmoney-jywg-readonly-provider.md",
    "target_path": "docs/providers/stock/eastmoney.md",
    "zh_path": null,
    "category": "provider",
    "status": "merge",
    "merge_group": "providers/eastmoney",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "eastmoney-myfavor-watchlist",
    "source_path": "docs/features/17-eastmoney-myfavor-watchlist.md",
    "target_path": "docs/providers/stock/eastmoney.md",
    "zh_path": null,
    "category": "provider",
    "status": "merge",
    "merge_group": "providers/eastmoney",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "stock-portfolio-provider",
    "source_path": "docs/features/10-stock-portfolio-provider.md",
    "target_path": "docs/providers/stock/research.md",
    "zh_path": null,
    "category": "provider",
    "status": "merge",
    "merge_group": "providers/stock/research",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "stock-pulse-provider",
    "source_path": "docs/features/11-stock-pulse-provider.md",
    "target_path": "docs/providers/stock/research.md",
    "zh_path": null,
    "category": "provider",
    "status": "merge",
    "merge_group": "providers/stock/research",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "market-intel-provider",
    "source_path": "docs/features/14-market-intel-provider.md",
    "target_path": "docs/providers/stock/research.md",
    "zh_path": null,
    "category": "provider",
    "status": "merge",
    "merge_group": "providers/stock/research",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "stock-watchlist-research-provider",
    "source_path": "docs/features/18-stock-watchlist-research-provider.md",
    "target_path": "docs/providers/stock/research.md",
    "zh_path": null,
    "category": "provider",
    "status": "merge",
    "merge_group": "providers/stock/research",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "quality-gates",
    "source_path": "docs/quality-gates.md",
    "zh_path": "docs/zh/quality-gates.zh.md",
    "category": "reference",
    "status": "website-source",
    "merge_group": null,
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "pending"
  },
  {
    "doc_id": "install-runbook",
    "source_path": "docs/runbooks/install.md",
    "zh_path": "docs/zh/runbooks/install.zh.md",
    "category": "runbook",
    "status": "website-source",
    "merge_group": null,
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "pending"
  }
]
```
