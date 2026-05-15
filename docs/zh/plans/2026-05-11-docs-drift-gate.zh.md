---
doc_id: docs-drift-gate-plan
lang: zh
translation_of: docs/plans/2026-05-11-docs-drift-gate.md
translation_status: not_required
---

# Docs Drift Quality Gate 扩展

状态：`draft`
日期：2026-05-11

## 背景

MiniClaw 是 docs-first 项目。`pnpm run quality:docs` 当前检查第一阶段 D1 invariants：DB schema version、部分 Smart Router ER fields，以及 `docs/archive/features/*.md` index coverage。

剩余缺口是 changed-path semantics。当 source paths 变化时，相关 source-of-truth docs 应在同一个 commit 中变化，或者 developer 应记录明确原因说明为什么推迟 docs updates。

## 目标

- 用 changed-path to required-docs mapping 扩展 `quality:docs`。
- 保持 gate 轻量、确定性。
- 支持 pre-commit 的 staged mode，以及 CI/pre-push 的 tree/range mode。
- 避免把 archived plan docs 当成当前 source of truth。
- 通过打印精确 changed source paths 和 expected docs paths，让 docs drift failures 可行动。

## 非目标

- 不要求每个 code change 都更新 docs。
- 第一阶段不深度解析 semantic diffs。
- 不构建通用 documentation linter。
- 不让旧 `docs/plans/*.md` files 成为强制 sync targets。
- 没有 override mechanism 时，不阻塞 emergency hotfixes。

## 现有架构证据

- `scripts/quality-docs.ts`：当前 D1 script。
- `package.json`：`quality:commit` 和 `quality:push` 都运行 `quality:docs`。
- `docs/quality-gates.md`：列出 D1 mapping expectations，例如 `src/bot.ts` 到 `docs/bot-routing.md`。
- `docs/architecture.md`：DB schema、cron、task runtime、config 和 user-level layout 的 source of truth。
- `docs/bot-routing.md`：Discord routing 的 source of truth。
- `docs/prompts.md`：prompt templates 的 source of truth。
- `docs/archive/features/*.md`：feature-level source-of-truth docs。

## Mapping 提案

从保守 map 开始：

- `src/bot.ts`、`src/commands/**`、`src/discord/**`、`src/routing/**`
  - 要求以下之一：
    - `docs/bot-routing.md`
    - `docs/chat-router-current-logic.md`
    - relevant `docs/archive/features/*.md`
- `src/agent/**`
  - 要求以下之一：
    - `docs/architecture.md`
    - `docs/archive/features/03-discord-task-output.md`
    - relevant runtime/agent feature doc
- `src/cron/**`、`scripts/cron-*`
  - 要求以下之一：
    - `docs/architecture.md`
    - relevant cron/provider feature doc
- `src/store/db.ts`、`src/store/**`
  - 要求 `docs/architecture.md`
  - 如果 Smart Router store 变化，也要求 `docs/bot-routing.md` 或 router feature doc
- `src/providers/**`
  - 要求 relevant provider feature doc 或 provider framework doc
- `src/config.ts`、`config.example.yaml`
  - 要求 `docs/architecture.md` 或 config/provider/runtime feature doc
- `prompts/**`、`src/agent/prompts.ts`
  - 要求 `docs/prompts.md` 和 prompt snapshot tests
- `scripts/quality-*`、`.github/workflows/**`、`scripts/git-hooks/**`
  - 要求 `docs/quality-gates.md`
- `src/ops/doctor*`、`scripts/doctor*`
  - 要求 `docs/zh/archive/features/13-auto-doctor.zh.md` 或 Auto Doctor plan/doc
- `src/stage/**`
  - 只有当 Stage behavior 打算成为 source-of-truth 时才要求 Stage doc；否则允许使用 experimental-boundary note。

## Override 提案

仅在需要时支持一个显式 checked-in marker file：

- `docs/drift-waivers.md` 太容易被滥用，也可能漂移。
- 更偏好 commit-body notes 作为人工流程，但 scripts 在 pre-commit 期间无法读取 commit body。
- 更好的第一阶段：允许一个小的环境变量用于 local emergency：
  - `MINICLAW_DOCS_DRIFT_ALLOW=1 pnpm run quality:docs`
  - CI 不应设置它。

正常工作中，正确修复是更新 mapped doc，或增加新的 source-of-truth doc 并将其加入 index。

## 实施计划

1. Refactor `scripts/quality-docs.ts`。
   - 保留现有 invariant checks。
   - 增加 helper functions：
     - `getChangedPaths(mode)`
     - `matchDocRequirements(changedPaths)`
     - `hasRequiredDocChange(requirement, changedPaths)`
   - 保持输出 concise and actionable。
2. 决定 changed path source。
   - Pre-commit：使用 `git diff --cached --name-only` 的 staged paths。
   - 普通 `pnpm run quality:docs`：如果有 staged paths 就使用 staged；否则使用 `git diff --name-only HEAD` 加 untracked non-ignored files。
   - CI：后续可选支持 `--base <sha>`；第一阶段可依赖 full invariant checks 加 local hooks changed path detection。
3. 在代码中增加 mapping config。
   - 先在 `scripts/quality-docs.ts` 中保持 simple constant array。
   - 如果变大，再移到 `scripts/docs-drift-map.ts`。
4. 避免 plan-only changes 的 false positives。
   - `docs/plans/**` 下的变更不要求 source docs。
   - `docs/archive/2026-05-11-continuous-improvement-report.md` 下的变更不要求 docs sync。
5. 增加 tests 或 testable helpers。
   - 如有必要，将 pure helpers 抽到可 import module。
   - 测试代表性 path sets 和 expected required docs。
6. 更新 `docs/quality-gates.md`。
   - 记录当前 mapping、limitations 和 emergency override。
7. 在当前 tree 上运行。
   - 确保现有 clean tree 通过。
   - 如果可行，在 temp git worktree 中模拟 changed source path without docs。

## 验证计划

- Focused：
  - 如果抽出 mapping helpers，增加测试。
  - 运行 `pnpm run quality:docs`。
- Static：
  - `pnpm run typecheck`
  - `pnpm run lint`
- Regression：
  - 如果 runtime 可接受，运行 `pnpm run quality:commit`。
- Manual simulation：
  - 临时编辑 mapped source file 且不改 docs；验证 `quality:docs` fail。
  - 增加 mapped doc change；验证通过。
  - Finalize 前 revert 临时 simulation。

## 风险与回滚

- 风险：噪声 false positives 拖慢小修复。
  - 缓解：从 high-value mappings 和清晰 output 开始。
  - 回滚：禁用 changed-path mapping，同时保留现有 invariant checks。
- 风险：script behavior 在 pre-commit 和 CI 中不一致。
  - 缓解：记录 mode selection，只在需要时增加显式 flags。
- 风险：developers 更新无关 docs 来满足 gate。
  - 缓解：error output 应命名 acceptable source-of-truth docs，而不是任意 docs file。
- 风险：archived plans 被当成当前 docs。
  - 缓解：除非明确列出，否则排除 `docs/plans/**` 作为 satisfying requirements。

## 文档同步

- 更新 `docs/quality-gates.md` D1 section。
- 只有增加新的 source-of-truth docs page 时，才更新 `docs/README.md`。
- 保持 plan docs 作为 execution artifacts，而不是 current behavior source。

## 执行记录

实现时在这里记录 final mapping rules、command modes 和 verification evidence。

