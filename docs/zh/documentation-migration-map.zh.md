---
doc_id: documentation-migration-map
lang: zh
translation_of: docs/documentation-migration-map.md
translation_status: current
source_sha256: 6fefea41da2f896a134f76335110fe72d02e2f9f2485e91f9376d07ec9a31375
---
# MiniClaw 文档迁移地图

状态：inventory-complete
日期：2026-05-15

本文件是文档策略的 machine-readable inventory，来源是
[`docs/plans/2026-05-15-documentation-strategy.md`](../../plans/2026-05-15-documentation-strategy.md)。
它覆盖 `docs/` 下所有 tracked canonical Markdown docs。`docs/zh/**` 不是独立 source docs，
而是通过 `zh_path` 作为中文 mirror 被追踪。legacy feature-stub 清理后，`quality:docs-i18n`
会强制执行这份 inventory。非 archive、非 private 的 canonical docs 必须拥有 current 中文 mirror，
并保持 source-hash parity。

字段含义：

- `source_path`：当前英文 canonical source path。
- `target_path`：legacy doc move/merge 时的未来或合并后 source path。
- `zh_path`：required translated docs 对应的 tracked 中文 mirror。
- `status`：当前迁移动作：`keep`、`move`、`merge`、`archive`、`private` 或 `website-source`。
- `merge_group`：未来可能合并的逻辑文档组。
- `website_exposure`：该概念是否可公开、internal、history-only、private 或不公开。
- `translation_required`：中文 mirror 是否必须存在并通过 strict i18n enforcement。
- `translation_status`：`current`、`pending` 或 `not_required`。

```json
[
  {
    "doc_id": "discord-agent-control-plane",
    "source_path": "docs/plans/2026-05-25-discord-agent-control-plane.md",
    "zh_path": "docs/zh/plans/2026-05-25-discord-agent-control-plane.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": "task-runtime",
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
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
    "doc_id": "stock-provider-data-layer-migration",
    "source_path": "docs/plans/2026-05-17-stock-provider-data-layer-migration.md",
    "zh_path": "docs/zh/plans/2026-05-17-stock-provider-data-layer-migration.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": "providers/stock",
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "docs-index",
    "source_path": "docs/README.md",
    "zh_path": "docs/zh/README.md",
    "category": "index",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "documentation-migration-map",
    "source_path": "docs/documentation-migration-map.md",
    "zh_path": "docs/zh/documentation-migration-map.zh.md",
    "category": "reference",
    "status": "website-source",
    "merge_group": null,
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "plans-index",
    "source_path": "docs/plans/README.md",
    "zh_path": "docs/zh/plans/README.zh.md",
    "category": "plan-index",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "continuous-improvement-report",
    "source_path": "docs/archive/2026-05-11-continuous-improvement-report.md",
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
    "zh_path": "docs/zh/runtime/README.zh.md",
    "category": "runtime",
    "status": "website-source",
    "merge_group": null,
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "providers-index",
    "source_path": "docs/providers/README.md",
    "zh_path": "docs/zh/providers/README.zh.md",
    "category": "provider",
    "status": "website-source",
    "merge_group": "providers",
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "stock-providers-index",
    "source_path": "docs/providers/stock/README.md",
    "zh_path": "docs/zh/providers/stock/README.zh.md",
    "category": "provider",
    "status": "website-source",
    "merge_group": "providers/stock",
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "content-provider-family",
    "source_path": "docs/providers/content.md",
    "zh_path": "docs/zh/providers/content.zh.md",
    "category": "provider",
    "status": "website-source",
    "merge_group": "providers/content",
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "email-provider-family",
    "source_path": "docs/providers/email.md",
    "zh_path": "docs/zh/providers/email.zh.md",
    "category": "provider",
    "status": "website-source",
    "merge_group": "providers/email",
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "stock-workflows",
    "source_path": "docs/providers/stock/workflows.md",
    "zh_path": "docs/zh/providers/stock/workflows.zh.md",
    "category": "provider",
    "status": "website-source",
    "merge_group": "providers/stock/workflows",
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "stock-data-and-sources",
    "source_path": "docs/providers/stock/data-and-sources.md",
    "zh_path": "docs/zh/providers/stock/data-and-sources.zh.md",
    "category": "provider",
    "status": "website-source",
    "merge_group": "providers/stock/data",
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "stock-operations-and-security",
    "source_path": "docs/providers/stock/operations-and-security.md",
    "zh_path": "docs/zh/providers/stock/operations-and-security.zh.md",
    "category": "provider",
    "status": "website-source",
    "merge_group": "providers/stock/operations",
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "experiments-index",
    "source_path": "docs/experiments/README.md",
    "zh_path": "docs/zh/experiments/README.zh.md",
    "category": "experiment",
    "status": "keep",
    "merge_group": "experiments",
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "ralph-index",
    "source_path": "docs/ralph/README.md",
    "zh_path": "docs/zh/ralph/README.zh.md",
    "category": "experiment",
    "status": "keep",
    "merge_group": "experiments/ralph",
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "ralph-learnings",
    "source_path": "docs/ralph/learnings.md",
    "zh_path": "docs/zh/ralph/learnings.zh.md",
    "category": "experiment",
    "status": "keep",
    "merge_group": "experiments/ralph",
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
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
    "translation_status": "current"
  },
  {
    "doc_id": "bot-routing",
    "source_path": "docs/bot-routing.md",
    "zh_path": "docs/zh/bot-routing.zh.md",
    "category": "runtime",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "chat-router-current-logic",
    "source_path": "docs/chat-router-current-logic.md",
    "zh_path": "docs/zh/chat-router-current-logic.zh.md",
    "category": "runtime",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
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
    "translation_status": "current"
  },
  {
    "doc_id": "install-distribution-strategy",
    "source_path": "docs/install-distribution-strategy.md",
    "zh_path": "docs/zh/install-distribution-strategy.zh.md",
    "category": "runbook",
    "status": "website-source",
    "merge_group": null,
    "website_exposure": "public",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "prompts",
    "source_path": "docs/prompts.md",
    "zh_path": "docs/zh/prompts.zh.md",
    "category": "reference",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
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
    "translation_status": "current"
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
    "translation_status": "current"
  },
  {
    "doc_id": "discord-task-intake-channel-plan",
    "source_path": "docs/plans/2026-05-07-discord-task-intake-channel.md",
    "zh_path": "docs/zh/plans/2026-05-07-discord-task-intake-channel.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "email-capability-plan",
    "source_path": "docs/plans/2026-05-07-email-capability.md",
    "zh_path": "docs/zh/plans/2026-05-07-email-capability.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "futu-stock-cron-provider-plan",
    "source_path": "docs/plans/2026-05-07-futu-stock-cron-provider.md",
    "zh_path": "docs/zh/plans/2026-05-07-futu-stock-cron-provider.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "layered-config-yaml-plan",
    "source_path": "docs/plans/2026-05-07-layered-config-yaml.md",
    "zh_path": "docs/zh/plans/2026-05-07-layered-config-yaml.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "smart-task-router-implementation-plan",
    "source_path": "docs/plans/2026-05-07-smart-task-router-implementation.md",
    "zh_path": "docs/zh/plans/2026-05-07-smart-task-router-implementation.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "connectivity-monitor-email-fallback-plan",
    "source_path": "docs/plans/2026-05-08-connectivity-monitor-email-fallback.md",
    "zh_path": "docs/zh/plans/2026-05-08-connectivity-monitor-email-fallback.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "cron-failure-retry-alerts-plan",
    "source_path": "docs/plans/2026-05-08-cron-failure-retry-alerts.md",
    "zh_path": "docs/zh/plans/2026-05-08-cron-failure-retry-alerts.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "quality-gates-and-discord-e2e-plan",
    "source_path": "docs/plans/2026-05-08-quality-gates-and-discord-e2e.md",
    "zh_path": "docs/zh/plans/2026-05-08-quality-gates-and-discord-e2e.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "stock-cron-market-split-cny-plan",
    "source_path": "docs/plans/2026-05-08-stock-cron-market-split-cny.md",
    "zh_path": "docs/zh/plans/2026-05-08-stock-cron-market-split-cny.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "stock-pulse-hourly-provider-plan",
    "source_path": "docs/plans/2026-05-08-stock-pulse-hourly-provider.md",
    "zh_path": "docs/zh/plans/2026-05-08-stock-pulse-hourly-provider.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "market-intel-pre-market-research-plan",
    "source_path": "docs/plans/2026-05-10-market-intel-pre-market-research.md",
    "zh_path": "docs/zh/plans/2026-05-10-market-intel-pre-market-research.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "miniclaw-auto-doctor-self-repair-plan",
    "source_path": "docs/plans/2026-05-10-miniclaw-auto-doctor-self-repair.md",
    "zh_path": "docs/zh/plans/2026-05-10-miniclaw-auto-doctor-self-repair.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "agent-runtime-contracts-plan",
    "source_path": "docs/plans/2026-05-11-agent-runtime-contracts.md",
    "zh_path": "docs/zh/plans/2026-05-11-agent-runtime-contracts.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "complexity-hotspot-refactor-plan",
    "source_path": "docs/plans/2026-05-11-complexity-hotspot-refactor.md",
    "zh_path": "docs/zh/plans/2026-05-11-complexity-hotspot-refactor.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "config-schema-first-plan",
    "source_path": "docs/plans/2026-05-11-config-schema-first.md",
    "zh_path": "docs/zh/plans/2026-05-11-config-schema-first.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "continuous-improvement-index-plan",
    "source_path": "docs/plans/2026-05-11-continuous-improvement-index.md",
    "zh_path": "docs/zh/plans/2026-05-11-continuous-improvement-index.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "cron-run-history-control-plan",
    "source_path": "docs/plans/2026-05-11-cron-run-history-control.md",
    "zh_path": "docs/zh/plans/2026-05-11-cron-run-history-control.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "db-migrations-state-lifecycle-plan",
    "source_path": "docs/plans/2026-05-11-db-migrations-state-lifecycle.md",
    "zh_path": "docs/zh/plans/2026-05-11-db-migrations-state-lifecycle.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "docs-drift-gate-plan",
    "source_path": "docs/plans/2026-05-11-docs-drift-gate.md",
    "zh_path": "docs/zh/plans/2026-05-11-docs-drift-gate.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "incident-center-ops-view-plan",
    "source_path": "docs/plans/2026-05-11-incident-center-ops-view.md",
    "zh_path": "docs/zh/plans/2026-05-11-incident-center-ops-view.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "provider-framework-sdk-plan",
    "source_path": "docs/plans/2026-05-11-provider-framework-sdk.md",
    "zh_path": "docs/zh/plans/2026-05-11-provider-framework-sdk.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "smart-router-evaluation-loop-plan",
    "source_path": "docs/plans/2026-05-11-smart-router-evaluation-loop.md",
    "zh_path": "docs/zh/plans/2026-05-11-smart-router-evaluation-loop.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "stage-experimental-boundary-plan",
    "source_path": "docs/plans/2026-05-11-stage-experimental-boundary.md",
    "zh_path": "docs/zh/plans/2026-05-11-stage-experimental-boundary.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "task-trace-export-plan",
    "source_path": "docs/plans/2026-05-11-task-trace-export.md",
    "zh_path": "docs/zh/plans/2026-05-11-task-trace-export.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "task-view-boundary-plan",
    "source_path": "docs/plans/2026-05-11-task-view-boundary.md",
    "zh_path": "docs/zh/plans/2026-05-11-task-view-boundary.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "agent-prompt-context-management-plan",
    "source_path": "docs/plans/2026-05-13-agent-prompt-context-management.md",
    "zh_path": "docs/zh/plans/2026-05-13-agent-prompt-context-management.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "agent-run-manager-plan",
    "source_path": "docs/plans/2026-05-14-agent-run-manager.md",
    "zh_path": "docs/zh/plans/2026-05-14-agent-run-manager.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "im-transport-abstraction-feishu-validation-plan",
    "source_path": "docs/plans/2026-05-14-im-transport-abstraction-feishu-validation.md",
    "zh_path": "docs/zh/plans/2026-05-14-im-transport-abstraction-feishu-validation.zh.md",
    "category": "plan",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  },
  {
    "doc_id": "local-deploy-runbook",
    "source_path": "docs/runbooks/local-deploy.md",
    "zh_path": "docs/zh/runbooks/local-deploy.zh.md",
    "category": "runbook",
    "status": "keep",
    "merge_group": null,
    "website_exposure": "internal",
    "translation_required": true,
    "translation_status": "current"
  }
]
```
