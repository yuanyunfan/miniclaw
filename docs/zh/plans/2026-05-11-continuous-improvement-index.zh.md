---
doc_id: continuous-improvement-index-plan
lang: zh
translation_of: docs/plans/2026-05-11-continuous-improvement-index.md
translation_status: current
source_sha256: edef43fa70207b10f689a55e9f8d80b950cdaba1b2303db171a0f861b8f57f18
---
# 持续改进计划索引

状态：`draft`
日期：2026-05-11

## 背景

`docs/archive/2026-05-11-continuous-improvement-report.md` 汇总了当前 code alignment pass 之后的 MiniClaw 下一阶段改进 backlog。本索引把那份报告转成 `docs/plans/` 下可执行的计划文档。

每个链接计划都应能作为独立 Codex session 的 kickoff artifact。后续 session 应先阅读具体计划，然后在编辑前验证当前代码状态，因为 MiniClaw 变化很快。

## 推荐执行顺序

### Track A：Task Runtime 与用户可见性

1. `2026-05-11-task-view-boundary.md`
   - 第一优先级，因为它降低后续 trace、incident 和 Discord output 工作的 blast radius。
   - 建立 `TaskViewEvent`、task runners 和 Discord view reporter 边界。
2. `2026-05-11-task-trace-export.md`
   - 可以从现有 `task_events` 开始，但如果 Track A 已落地，应复用 task view vocabulary。
   - 增加 `/task-log` 或 `/task trace`，以及 Markdown export。
3. `2026-05-11-smart-router-evaluation-loop.md`
   - 围绕 router decisions、user choices、created tasks 和 final task status 建立 outcome loop。

### Track B：质量与可维护性

4. `2026-05-11-docs-drift-gate.md`
   - 将 D1 从固定 invariants 扩展为 changed-path review mapping。
   - 应尽早落地，因为后续每个 architecture change 都需要 docs sync。
5. `2026-05-11-complexity-hotspot-refactor.md`
   - 协调 god-module refactors。
   - 不要在一个 commit 中实现所有列出的 refactor；把它当成一系列 narrow slices。

### Track C：Runtime、Provider、Config 与 State Frameworks

6. `2026-05-11-agent-runtime-contracts.md`
   - 分离 Agent runtime、Model client、IM transport 和 Data provider contracts。
   - 应指导后续 config 和 task runner refactors。
7. `2026-05-11-db-migrations-state-lifecycle.md`
   - 引入 migration modules、schema audit、repositories、retention 和 redaction policy。
8. `2026-05-11-config-schema-first.md`
   - 拆分 config loading、schema validation、path resolution 和 runtime config。
9. `2026-05-11-provider-framework-sdk.md`
   - 将当前 pre-provider conventions 变成 manifest、health、dry-run、structured output、replay fixture 和 commit protocol。

### Track D：Operations Surface

10. `2026-05-11-incident-center-ops-view.md`
    - 将现有 Auto Doctor incident paths 扩展成真正的 operator view。
    - 最佳用户体验依赖 task trace export。
11. `2026-05-11-cron-run-history-control.md`
    - 增加 `cron_runs`、per-job control、provider preflight 和 linked diagnostics。
    - 受益于 provider framework 和 incident center，但可以增量实现。
12. `2026-05-11-stage-experimental-boundary.md`
    - 保持 Stage 明确为 experimental，避免它把 Discord bot runtime 拉成第二个产品表面。

## 所有后续 Session 的横向规则

- 从 `git status --short` 开始，并保留 unrelated user changes。
- 用 `rg --files` 重新检查当前 file structure，因为部分计划可能已被早前 sessions 局部实现。
- 优先 narrow slices 和 atomic commits。
- 对代码改动至少运行 `pnpm run typecheck`、`pnpm run lint` 和 focused `pnpm vitest run ...`。
- 当 source-of-truth docs、DB schema、routing、provider contracts 或 quality gates 变化时，运行 `pnpm run quality:docs`。
- 对 Discord-visible behavior，先使用 deterministic fake/E2E tests；real Discord E2E 仍然是手动或显式请求。

## 取代规则

这些计划是 draft execution plans，不是永久 source of truth。当任务实现后：

- 更新 plan `Status` 和 `Execution Notes`。
- 更新相关 source-of-truth doc，通常是 `docs/architecture.md`、`docs/bot-routing.md`、`docs/quality-gates.md` 或 `docs/archive/features/*.md`。
- 如果行为实质上偏离计划，在关闭 session 前把新决策记录到计划中。

