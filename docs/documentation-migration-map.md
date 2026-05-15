# MiniClaw Documentation Migration Map

Status: inventory-complete
Date: 2026-05-15

This file is the machine-readable inventory for the documentation strategy in
[`docs/plans/2026-05-15-documentation-strategy.md`](plans/2026-05-15-documentation-strategy.md).
It covers every tracked canonical Markdown doc under `docs/` except `docs/zh/**`,
which are tracked through `zh_path` pairs. `quality:docs-i18n` enforces this
inventory before large file moves begin.

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
    "doc_id": "docs-index",
    "source_path": "docs/README.md",
    "zh_path": null,
    "category": "index",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "documentation-migration-map",
    "source_path": "docs/documentation-migration-map.md",
    "zh_path": null,
    "category": "reference",
    "status": "website-source",
    "merge_group": null,
    "website_exposure": "public",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "plans-index",
    "source_path": "docs/plans/README.md",
    "zh_path": null,
    "category": "plan-index",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "continuous-improvement-report",
    "source_path": "docs/archive/2026-05-11-continuous-improvement-report.md",
    "zh_path": null,
    "category": "archive",
    "status": "archive",
    "merge_group": null,
    "website_exposure": "history",
    "translation_required": false,
    "translation_status": "not_required"
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
    "doc_id": "stage-experiment",
    "source_path": "docs/features/01-stage.md",
    "target_path": "docs/experiments/README.md",
    "zh_path": null,
    "category": "experiment",
    "status": "move",
    "merge_group": "experiments/stage",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "ralph-controller",
    "source_path": "docs/features/15-ralph-controller.md",
    "target_path": "docs/experiments/README.md",
    "zh_path": null,
    "category": "experiment",
    "status": "move",
    "merge_group": "experiments/ralph",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "ralph-index",
    "source_path": "docs/ralph/README.md",
    "zh_path": null,
    "category": "experiment",
    "status": "keep",
    "merge_group": "experiments/ralph",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "ralph-learnings",
    "source_path": "docs/ralph/learnings.md",
    "zh_path": null,
    "category": "experiment",
    "status": "keep",
    "merge_group": "experiments/ralph",
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
    "doc_id": "bot-routing",
    "source_path": "docs/bot-routing.md",
    "zh_path": null,
    "category": "runtime",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "public",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "chat-router-current-logic",
    "source_path": "docs/chat-router-current-logic.md",
    "zh_path": null,
    "category": "runtime",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "discord-task-output",
    "source_path": "docs/features/03-discord-task-output.md",
    "target_path": "docs/runtime/README.md",
    "zh_path": null,
    "category": "runtime",
    "status": "move",
    "merge_group": "runtime",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "smart-task-router-legacy-zh",
    "source_path": "docs/features/04-smart-task-router.md",
    "target_path": "docs/runtime/README.md",
    "zh_path": null,
    "category": "runtime",
    "status": "merge",
    "merge_group": "runtime/smart-router",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "smart-task-router-en",
    "source_path": "docs/features/05-smart-task-router.en.md",
    "target_path": "docs/runtime/README.md",
    "zh_path": null,
    "category": "runtime",
    "status": "merge",
    "merge_group": "runtime/smart-router",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "connectivity-monitor",
    "source_path": "docs/features/12-connectivity-monitor.md",
    "target_path": "docs/runtime/README.md",
    "zh_path": null,
    "category": "runtime",
    "status": "move",
    "merge_group": "runtime",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "auto-doctor",
    "source_path": "docs/features/13-auto-doctor.md",
    "target_path": "docs/runtime/README.md",
    "zh_path": null,
    "category": "runtime",
    "status": "move",
    "merge_group": "runtime",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "agent-prompt-context-audit",
    "source_path": "docs/features/19-agent-prompt-context-audit.md",
    "target_path": "docs/runtime/README.md",
    "zh_path": null,
    "category": "runtime",
    "status": "move",
    "merge_group": "runtime",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "memory-curation-lifecycle",
    "source_path": "docs/features/20-memory-curation-lifecycle.md",
    "target_path": "docs/runtime/README.md",
    "zh_path": null,
    "category": "runtime",
    "status": "move",
    "merge_group": "runtime",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "agent-run-manager-feature",
    "source_path": "docs/features/21-agent-run-manager.md",
    "target_path": "docs/runtime/README.md",
    "zh_path": null,
    "category": "runtime",
    "status": "move",
    "merge_group": "runtime",
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
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
    "doc_id": "install-distribution-strategy",
    "source_path": "docs/install-distribution-strategy.md",
    "zh_path": null,
    "category": "runbook",
    "status": "website-source",
    "merge_group": null,
    "website_exposure": "public",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "prompts",
    "source_path": "docs/prompts.md",
    "zh_path": null,
    "category": "reference",
    "status": "keep",
    "merge_group": null,
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
  },
  {
    "doc_id": "discord-task-intake-channel-plan",
    "source_path": "docs/plans/2026-05-07-discord-task-intake-channel.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "email-capability-plan",
    "source_path": "docs/plans/2026-05-07-email-capability.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "futu-stock-cron-provider-plan",
    "source_path": "docs/plans/2026-05-07-futu-stock-cron-provider.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "layered-config-yaml-plan",
    "source_path": "docs/plans/2026-05-07-layered-config-yaml.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "smart-task-router-implementation-plan",
    "source_path": "docs/plans/2026-05-07-smart-task-router-implementation.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "connectivity-monitor-email-fallback-plan",
    "source_path": "docs/plans/2026-05-08-connectivity-monitor-email-fallback.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "cron-failure-retry-alerts-plan",
    "source_path": "docs/plans/2026-05-08-cron-failure-retry-alerts.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "quality-gates-and-discord-e2e-plan",
    "source_path": "docs/plans/2026-05-08-quality-gates-and-discord-e2e.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "stock-cron-market-split-cny-plan",
    "source_path": "docs/plans/2026-05-08-stock-cron-market-split-cny.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "stock-pulse-hourly-provider-plan",
    "source_path": "docs/plans/2026-05-08-stock-pulse-hourly-provider.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "market-intel-pre-market-research-plan",
    "source_path": "docs/plans/2026-05-10-market-intel-pre-market-research.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "miniclaw-auto-doctor-self-repair-plan",
    "source_path": "docs/plans/2026-05-10-miniclaw-auto-doctor-self-repair.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "agent-runtime-contracts-plan",
    "source_path": "docs/plans/2026-05-11-agent-runtime-contracts.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "complexity-hotspot-refactor-plan",
    "source_path": "docs/plans/2026-05-11-complexity-hotspot-refactor.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "config-schema-first-plan",
    "source_path": "docs/plans/2026-05-11-config-schema-first.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "continuous-improvement-index-plan",
    "source_path": "docs/plans/2026-05-11-continuous-improvement-index.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "cron-run-history-control-plan",
    "source_path": "docs/plans/2026-05-11-cron-run-history-control.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "db-migrations-state-lifecycle-plan",
    "source_path": "docs/plans/2026-05-11-db-migrations-state-lifecycle.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "docs-drift-gate-plan",
    "source_path": "docs/plans/2026-05-11-docs-drift-gate.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "incident-center-ops-view-plan",
    "source_path": "docs/plans/2026-05-11-incident-center-ops-view.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "provider-framework-sdk-plan",
    "source_path": "docs/plans/2026-05-11-provider-framework-sdk.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "smart-router-evaluation-loop-plan",
    "source_path": "docs/plans/2026-05-11-smart-router-evaluation-loop.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "stage-experimental-boundary-plan",
    "source_path": "docs/plans/2026-05-11-stage-experimental-boundary.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "task-trace-export-plan",
    "source_path": "docs/plans/2026-05-11-task-trace-export.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "task-view-boundary-plan",
    "source_path": "docs/plans/2026-05-11-task-view-boundary.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "agent-prompt-context-management-plan",
    "source_path": "docs/plans/2026-05-13-agent-prompt-context-management.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "agent-run-manager-plan",
    "source_path": "docs/plans/2026-05-14-agent-run-manager.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "im-transport-abstraction-feishu-validation-plan",
    "source_path": "docs/plans/2026-05-14-im-transport-abstraction-feishu-validation.md",
    "zh_path": null,
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  },
  {
    "doc_id": "local-deploy-runbook",
    "source_path": "docs/runbooks/local-deploy.md",
    "zh_path": null,
    "category": "runbook",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": false,
    "translation_status": "not_required"
  }
]
```
