---
doc_id: documentation-strategy
lang: zh
translation_of: docs/plans/2026-05-15-documentation-strategy.md
translation_status: current
---

# MiniClaw 文档策略

Status: completed
Date: 2026-05-15

## Background

MiniClaw 需要两个文档表面：repo 内 `docs/` 继续作为 LLM 和维护者使用的 docs-driven development source of truth，另建 GitHub Pages 网站作为面向人的项目门户。

`docs/` 需要保留当前实现事实、计划、contract、runbook 和 drift checks。网站负责总结、可视化和引导阅读，并通过 `source_docs` 回链到 canonical repo docs，不能变成第二套 source of truth。

## Goals

- 保持 `docs/` 对 LLM 开发、实施计划和维护友好。
- 创建适合人类读者快速理解 MiniClaw 的公开网站。
- 避免在 repo docs 和 website 之间重复维护实现事实。
- 为当前混合的 `docs/` 内容建立迁移计划。
- 把 English 和 Chinese docs 都作为 first-class repo documentation 维护。
- 增加 `quality:website-docs` 和 `quality:docs-i18n`，降低 website/docs/i18n drift。

## Non-Goals

- 不直接把 repo 的 `docs/` 发布成 GitHub Pages。
- 不公开 `docs/private/**`。
- 不把 archive 报告当作当前实现状态。
- 不让 `website/**` 替代 code-to-docs drift gate 所要求的 canonical docs。
- 不在最初的 plan-only 设计 slice 中一次性移动所有 `docs/archive/features/` 文件。

## Existing Architecture Evidence

- `docs/README.md`: 当前 docs index 和 placement rules。
- `docs/plans/README.md`: plan 文档模板。
- `scripts/quality-docs.ts` 与 `src/quality/docs-drift.ts`: 现有 D1 docs drift gate。
- `docs/quality-gates.md`: 质量门禁说明。
- `.gitignore`: 当前只忽略生成物 `website-dist/`，不忽略 tracked `docs/zh/`。

当前 drift 方向：

```text
source code -> canonical docs
```

目标 drift 方向：

```text
source code -> canonical docs -> website
```

## Implementation Plan

1. 保留 `docs/` 作为 canonical docs-driven development layer。
2. 定义 `en` / `zh` 维护模型：短期保留 root `docs/` 作为 English canonical tree，`docs/zh/` 作为 tracked Chinese mirror。
3. 维护 `docs/documentation-migration-map.md`，用 `doc_id`、`source_path`、`target_path`、`zh_path`、`category`、`status`、`merge_group`、`website_exposure`、`translation_required` 和 `translation_status` 记录迁移状态；所有 tracked canonical `docs/**/*.md` source（排除 `docs/zh/**`）都必须进入 migration map。
4. 分阶段迁移当前 docs：先 inventory，再建立 i18n parity gate，然后分类/合并 `docs/archive/features/`，最后只把 curated material 暴露给 website。
5. 对 Eastmoney 相关文档，后续应合并成一个 provider-family entry，用 sections 区分 JYWG readonly 和 MyFavor watchlist。
6. 新增 `website/en/**` 和 `website/zh/**` 骨架，网站页面必须声明 language-aware `source_docs`。
7. 新增 `quality:website-docs` 检查 frontmatter、`source_docs`、private/archive source 禁用规则和 affected page reporting。
8. 新增 `quality:docs-i18n` 检查 migration map inventory completeness、translation pairing、heading parity、ignored-path detection 和 missing translation reporting；migration map 漏收 tracked source doc、required 中文 pair 缺失或 `translation_status: pending` 都是 blocking error。
9. Phase 2 分类迁移先增加 taxonomy entrypoints；后续 cleanup 已删除 legacy `docs/archive/features/*` stubs。当前入口包括 `docs/runtime/README.md`、`docs/providers/README.md`、`docs/providers/provider-framework.md`、`docs/providers/content.md`、`docs/providers/email.md`、`docs/providers/stock/eastmoney.md`、`docs/providers/stock/research.md` 和 `docs/experiments/README.md`。
10. 新增 GitHub Pages build / deploy path：`scripts/build-website.ts` 把 `website/**/*.md(x)` 构建成 `website-dist/**/*.html`，`pnpm run website:build` 做本地验证，`.github/workflows/pages.yml` 先跑 `quality:website-docs` 再发布 Pages artifact。
11. Phase 3 从小 slice 开始迁移：Eastmoney 和 Email 已先完成 provider-family merge；最终 runtime、experiments、content、provider-framework、stock 和 stock research 也已迁移完成，legacy compatibility stubs 已在 cleanup 后删除。
12. 本阶段保留 root `docs/` 作为 English canonical tree，不迁到 `docs/en/**`；如果未来确实需要显式双语树，再单独开迁移计划。

```mermaid
flowchart LR
  Current[Current mixed docs tree] --> Inventory[Inventory and migration map]
  Inventory --> I18n[en/zh mirror and parity gate]
  I18n --> Classify[Classify runtime / providers / reference / runbooks / experiments]
  Classify --> Merge[Move or merge docs in small slices]
  Merge --> Website[Curated website pages with source_docs]
```

## Verification Plan

- plan-only 变更不需要 typecheck。
- 实现 quality scripts 时需要运行 focused Vitest、`pnpm run typecheck` 和 `pnpm run quality:docs`。
- `quality:docs-i18n` 对 migration map 漏收 tracked canonical source doc、required 中文 pair 缺失和 pending translation 都必须 blocking。
- website scaffolding 存在后运行 `pnpm run quality:website-docs`。

## Risks And Rollback

- Risk: website 变成第二套 source of truth。
  - Mitigation: `source_docs` metadata 和 website docs gate。
  - Rollback: 停止 website publishing，保留 canonical `docs/`。

- Risk: docs migration 破坏链接或 docs drift mappings。
  - Mitigation: 小 slice 迁移，并在同一 slice 更新 indexes、links 和 drift mappings。
  - Rollback: 从 git 恢复旧路径，并在 migration map 中标记 blocked。

- Risk: English 和 Chinese docs 分歧。
  - Mitigation: `doc_id`、`translation_of`、`translation_status` 和 `quality:docs-i18n`。
  - Rollback: 只有在中文文档确实不需要时，才在 migration map 中标为 `translation_status: not_required`；否则必须同 patch 修复中文 pair。

## Documentation Sync

- `docs/README.md`: 增加 migration map、bilingual policy 和 website policy。
- `docs/zh/README.md`: 从 local review copy 改成 tracked Chinese docs index。
- `.gitignore`: 移除 `docs/zh/`。
- `docs/quality-gates.md`: 补充 `quality:docs-i18n` 和 `quality:website-docs`。
- `package.json`: 增加质量脚本并接入 `quality:docs`。

## Execution Notes

- 2026-05-15: 首批实现落地为独立 worktree slice，范围包括 migration map、tracked `docs/zh`、i18n/website docs gates、website skeleton 和 docs index 同步。
- 2026-05-15: 本 slice 位于 branch `codex/documentation-strategy` 的独立 worktree；大规模 `docs/archive/features/` 分类、移动和合并仍保留为后续 docs-only slices。
- 2026-05-15: 已在 `main` 开始 Phase 2 分类，不删除 legacy feature docs。新增 runtime/providers/experiments taxonomy 入口、Eastmoney provider family、content/email provider family 和 stock research pipeline，并同步 migration map、website `source_docs` 与 D1 docs drift patterns。
- 2026-05-15: 在 `main` 完成 migration-map inventory slice：`docs/documentation-migration-map.md` 覆盖所有 tracked canonical `docs/**/*.md` source（排除 `docs/zh/**`），`quality:docs-i18n` 会把 migration map 漏收 tracked source doc 判为 blocking error。Focused verification 已通过：`pnpm exec vitest run src/quality/__tests__/docs-i18n.test.ts` 和 `pnpm run quality:docs-i18n`，后者报告 73 个 migration map entries。
- 2026-05-15: inventory slice 的 broader verification 已通过：`pnpm run typecheck`、`pnpm run lint`、`pnpm run build`、`pnpm test`（185 files / 903 tests）和 `MINICLAW_DOCS_DRIFT_ALLOW=1 pnpm run quality:docs`。当前 raw `pnpm run quality:docs` 被同一 worktree 中并行的 Agent Run Manager runtime/store 改动挡住，不是本 inventory slice 导致。
- 2026-05-15: 新增 GitHub Pages deployment path：`scripts/build-website.ts` 从 `website/**/*.md(x)` 构建 `website-dist/**/*.html`，`package.json` 暴露 `website:build`，`.github/workflows/pages.yml` 在发布前运行 `quality:website-docs` 并上传 Pages artifact；workflow 也监听 website docs gate implementation 和 frontmatter parser，避免校验逻辑变化时绕过 Pages build。`website-dist/` 是生成物，已加入 `.gitignore`。
- 2026-05-15: 完成第一个 Phase 3 provider merge slice：`docs/providers/stock/eastmoney.md` 成为 JYWG readonly 和 MyFavor watchlist 的 provider-family source of truth；`docs/archive/features/09-eastmoney-jywg-readonly-provider.md` 与 `docs/archive/features/17-eastmoney-myfavor-watchlist.md` 改为兼容 stub；同步更新 `docs/README.md`、migration map 和中文摘要；后续 hardening follow-up 已把该中文 pair 提升为 current parity。
- 2026-05-15: 完成第二个 Phase 3 provider merge slice：`docs/providers/email.md` 成为通用只读 Email capability、`email-query` 和 `cmb-credit-card-email` 的 provider-family source of truth；`docs/archive/features/07-email-capability.md` 与 `docs/archive/features/08-cmb-credit-card-email-provider.md` 改为兼容 stub；同步更新 provider indexes、migration map、中文 Email 摘要和 website provider `source_docs`；后续 hardening follow-up 已把该中文 pair 提升为 current parity。
- 2026-05-15: 完成剩余 Phase 3/4 迁移：`docs/runtime/README.md`、`docs/experiments/README.md`、`docs/providers/content.md`、`docs/providers/provider-framework.md`、`docs/providers/stock/README.md` 和 `docs/providers/stock/research.md` 成为对应 feature groups 的当前 source of truth；所有 `docs/archive/features/*.md` 都变成一轮兼容 stub。新增 runtime、experiments、content、stock、stock research 的中文 mirror 摘要；更新 docs drift 规则，使 legacy feature stubs 不再满足未来 source-code 变更；新增 website runtime 页面并刷新 provider `source_docs`。后续 hardening follow-up 已把 required 中文 mirrors 提升为 current parity。本阶段保留 root English docs，不迁移到 `docs/en/**`。
- 2026-05-15: 完成 bilingual 和 website drift hardening follow-up：required 中文 pair 全部变为 `translation_status: current`，`quality:docs-i18n` 会阻止 missing/pending required translations；`quality:website-docs` 会阻止 canonical docs 变更后 website page 未同步更新的情况，除非同 patch 更新 website page、页面 frontmatter 显式标记 `website_docs_drift: unaffected` 并说明原因，或紧急设置 `MINICLAW_WEBSITE_DOCS_DRIFT_ALLOW=1`。
- 2026-05-15: 完成 feature stub archive 与 zh cleanup follow-up。所有 legacy `docs/features/*.md` 已移动到 `docs/archive/features/`，`quality:docs:drift` 不再把 archived feature docs 当成当前 source index；早期平铺中文翻译要么迁移到带标准 frontmatter 的 `docs/zh/plans/`，要么归档到 `docs/zh/archive/**`。Pages workflow 现在会先检查仓库 Pages 配置；如果 Pages 还没有启用，CI 会保留 website build/artifact path 成功，不再在 `actions/configure-pages` 阶段失败。
- 2026-05-15: 完成 migration-period feature stubs 的最终清理。`docs/archive/features/` 和对应的 `docs/zh/archive/features/` 翻译已删除，current docs 不再链接这些 stub paths，`docs/documentation-migration-map.md` 只跟踪仍存在的 canonical source docs，website 页面已同步这次 cleanup。
