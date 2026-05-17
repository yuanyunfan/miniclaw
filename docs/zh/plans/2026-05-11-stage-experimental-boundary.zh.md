---
doc_id: stage-experimental-boundary-plan
lang: zh
translation_of: docs/plans/2026-05-11-stage-experimental-boundary.md
translation_status: current
source_sha256: ae1e007538c45ef311889cc883ee781769a69919214e05b8d54a82f0d216dee8
---
# Stage 实验边界

状态：`draft`
日期：2026-05-11

## 背景

Stage subsystem 有自己的 persona、orchestrator、TUI、smoke/E2E path 和 CLI commands。它适合作为 persona 与 multi-agent workflow research 的 playground，但它不是长期运行 Discord bot 的同一个产品表面。

如果 Stage 与 Discord task runtime 深度耦合，MiniClaw 实际上会维护两个假设不同的 primary UX surfaces。这会分散当前优先级：personal automation、private data ingestion、Discord-native delivery、runtime switching 和 operations governance。

## 目标

- 明确将 Stage 标记为 experimental。
- 避免 Stage 阻塞 Discord bot quality 和 runtime changes。
- 当 `AgentRuntime` 和 `ModelClient` contracts 稳定后，允许 Stage 复用它们。
- 防止 Stage-specific UX、persona 或 multi-agent decisions 变成默认 Discord task behavior。
- 增加最小 docs 和 tests 来保持边界。

## 非目标

- 不删除 Stage。
- 本 slice 不把 Stage 变成 core runtime path。
- 不默认让 MiniClaw tasks 使用 multi-agent execution。
- 除非 Stage 后续被提升，否则不构建完整 Stage docs index、health、usage accounting 或 quality gates。
- 不为了 Stage-only needs 重构 Discord task runtime。

## 现有架构证据

- `package.json`：存在 `stage` 和 `stage:repl` scripts。
- `src/stage/index.tsx`：TUI entry。
- `src/stage/repl.ts`：REPL entry。
- `src/stage/agent.ts`：provider-specific Stage agent behavior。
- `src/stage/orchestrator.ts`：Stage orchestration。
- `src/stage/personas.ts`：Stage persona definitions。
- `src/stage/e2e.ts` 和 `src/stage/smoke.ts`：Stage checks。
- `src/stage/__tests__/*`：现有 Stage tests。
- `docs/archive/2026-05-11-continuous-improvement-report.md`：建议保持 Stage experimental。

## 边界规则

- Stage 可以依赖 shared low-level contracts：
  - `AgentRuntime`
  - `ModelClient`
  - logging
  - config read-only summary
  - prompt utilities
- Stage 不应依赖 Discord-specific task intake、button routing 或 task thread rendering。
- Discord bot 不应依赖 Stage personas、TUI state 或 Stage orchestrator。
- Stage-specific multi-agent protocols 不得成为默认 task execution path。
- Stage docs 应清晰说明“experimental playground”。

## 实施计划

1. 增加或更新 Stage documentation。
   - 候选 doc：`docs/archive/features/16-stage-experimental.md` 或 `docs/stage.md`。
   - 包含：
     - purpose；
     - non-goals；
     - commands；
     - 与 Discord bot 的边界；
     - 如果 Stage 未来成为 core，需要满足的 promotion criteria。
2. 如果增加 feature doc，更新 docs index。
   - 向 `docs/README.md` 增加 entry。
3. 如果可行，增加 import-boundary check。
   - 简单第一阶段：`scripts/quality-docs.ts` 不是合适位置。
   - 后续候选脚本：`scripts/quality-boundaries.ts`。
   - 初始检查可以是 Vitest static test：
     - Stage modules 不应 import `src/bot.ts`、`src/discord/task-intake.ts` 或 Discord command handlers。
     - Discord runtime modules 不应 import `src/stage/*`。
4. 只在 `AgentRuntime` 存在后，让 Stage 适配 runtime contracts。
   - 如果 `2026-05-11-agent-runtime-contracts.md` 尚未落地，不要强推。
   - 将其记录为 follow-up。
5. 保持 Stage quality 分离。
   - 现有 Stage tests 可以继续作为普通 `pnpm test` 的一部分。
   - 不把 real Discord/LLM Stage E2E 加入 commit gates。
6. 记录 promotion criteria。
   - Stage 只有获得以下内容后才可成为 core：
     - docs index；
     - runtime health；
     - usage accounting；
     - quality gates；
     - 清晰的 Discord integration strategy；
     - 明确超越 experimentation 的用户价值。

## 验证计划

- Focused：
  - `pnpm vitest run src/stage`
  - 如果实现 boundary static test，则运行它。
- Static：
  - `pnpm run typecheck`
  - `pnpm run lint`
- Docs：
  - 如果增加 feature doc 或 index entry，运行 `pnpm run quality:docs`。
- Full：
  - `pnpm test`

## 风险与回滚

- 风险：boundary doc 随代码漂移而过期。
  - 缓解：实际可行时增加 static import-boundary test。
- 风险：Stage refactor 阻塞 core bot work。
  - 缓解：把 Stage 适配 runtime contracts 作为 follow-up，而不是 prerequisite。
- 风险：docs 让 Stage 看起来像 unsupported，而不是 experimental。
  - 缓解：说明当前可用 commands 和精确 scope。
- 风险：future multi-agent ideas 泄漏到 default task path。
  - 缓解：保持默认 Discord task single-agent，除非 dedicated plan 改变它。

## 文档同步

- 增加或更新 Stage doc。
- 如果增加新 doc，更新 `docs/README.md`。
- 只有 shared runtime contracts 成为 Stage 的一部分时，才更新 `docs/architecture.md`。
- 运行 `pnpm run quality:docs`。

## 执行记录

实现时在这里记录 doc path、boundary tests 和 runtime-contract adoption status。

