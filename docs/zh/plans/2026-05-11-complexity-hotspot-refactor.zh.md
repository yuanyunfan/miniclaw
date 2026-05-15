---
doc_id: complexity-hotspot-refactor-plan
lang: zh
translation_of: docs/plans/2026-05-11-complexity-hotspot-refactor.md
translation_status: not_required
---

# 复杂度热点重构计划

状态：`draft`
日期：2026-05-11

## 背景

`docs/archive/2026-05-11-continuous-improvement-report.md` 识别出多个责任已经累积过多的文件：

- `src/providers/market-intel/collectors/official.ts`
- `src/agent/task.ts`
- `src/ops/doctor-scheduler.ts`
- `src/bot.ts`
- `src/ops/doctor-repair.ts`
- `src/store/db.ts`
- `src/config.ts`
- `src/ops/doctor.ts`

问题不只是行数。真正的风险是无关 concerns 共享同一个文件，导致未来 AI agents 更容易把改动落到错误层级、破坏隐藏 contract，或者需要很大的上下文才能 review。

这是一个协调计划。不要在一次 session 内实现下面所有重构。使用它来选择一个窄 slice，增加或保留测试，然后更新执行记录。

## 目标

- 按稳定职责拆分 god modules。
- 抽取期间保持 public behavior 不变。
- 围绕抽出的 pure logic 增加 focused tests。
- 降低后续 provider、route、repair、task、DB 和 config 改动的 blast radius。
- 避免大范围 formatting churn。

## 非目标

- 不重写整个项目架构。
- 不把这项工作和新功能混在一起，除非该功能必须先做抽取。
- 不在没有 compatibility layer 的情况下重命名大型 API。
- 不为了减少行数而移动文件。
- 不把未经测试的行为变化藏在 refactor 里面落地。

## 现有架构证据

- `src/bot.ts`：Discord message handling、Smart Router、chat、task channel intake、button routing、slash dispatch。
- `src/agent/task.ts`：active task lifecycle、runners、SDK events、Discord rendering、final output、DB status。
- `src/ops/doctor-scheduler.ts`：scan loop、grouping、notifications、repair trigger policy、scheduler state。
- `src/providers/market-intel/collectors/official.ts`：多种 market data collection 和 parsing concerns。
- `src/ops/doctor-repair.ts`：policy、prompt build、worktree、agent execution、verification、allowed-path checks、commit/push。
- `src/store/db.ts`：schema creation、migrations，以及 tasks/chat/router/incidents/events repositories。
- `src/config.ts`：YAML/env loading、validation、path resolution、runtime config、E2E guard，以及大量 feature configs。

## 重构原则

- 从 pure extraction 开始，而不是行为变化。
- 移动复杂分支前先增加 characterization tests。
- 外部模块依赖 exported names 时，保留这些 names。
- 使用小 PR/commit slice。
- I/O-heavy code 在 pure logic 抽出后再优先采用 dependency injection。
- 每个 slice 后保持 docs 和 tests 对齐。

## Slice A：`src/bot.ts` Message And Interaction Dispatch

### 目标文件

- `src/bot/message-thread-continuation.ts`
- `src/bot/message-task-channel.ts`
- `src/bot/message-chat.ts`
- `src/bot/message-smart-router.ts`
- `src/bot/button-dispatch.ts`
- `src/bot/slash-dispatch.ts`

### 计划

1. 增加 `src/bot/` 目录，同时保留顶层 `src/bot.ts` 作为 public entry。
2. 先抽取 pure route decision helpers。
   - 输入：message metadata、channel ids、thread state、route config。
   - 输出：route action enum。
3. 将 Smart Router message path 移入 `message-smart-router.ts`。
   - 保留现有 DB logging helpers，或注入它们。
4. 将 task-channel intake 移入 `message-task-channel.ts`。
   - 复用 `src/discord/task-intake.ts`。
5. 将 chat path 移入 `message-chat.ts`。
   - 保持 permission 和 E2E author guard 行为不变。
6. 将 thread continuation 移入 `message-thread-continuation.ts`。
   - 保持 resume/session compatibility checks。
7. 将 button routing 移入 `button-dispatch.ts`。
   - 明确保留 cron retry 和 Smart Router button ordering。
8. 将 slash command dispatch 移入 `slash-dispatch.ts`。
   - `src/commands/handlers.ts` 继续作为 command implementation。

### 测试

- 如果尚未覆盖，增加 route-decision tests。
- 重新运行 Smart Router、confirmation 和 E2E fake runtime tests。

## Slice B：`src/agent/task.ts` Runtime Boundary

使用 `2026-05-11-task-view-boundary.md` 作为详细实施计划。

保持这个 slice 独立，因为它会影响 task cancellation、provider streaming、Discord output 和 DB persistence。

## Slice C：`src/ops/doctor-scheduler.ts` Doctor Scheduler Split

### 目标文件

- `src/ops/doctor-scheduler/scan-loop.ts`
- `src/ops/doctor-scheduler/grouping.ts`
- `src/ops/doctor-scheduler/notifications.ts`
- `src/ops/doctor-scheduler/repair-policy.ts`
- `src/ops/doctor-scheduler/state.ts`

### 计划

1. 将 incident grouping 抽成 pure functions。
2. 将 notification formatting 从 Discord send side effects 中抽出。
3. 将 repair scheduling/rate-limit policy 从 scan loop 中抽出。
4. 保持 public `startDoctorScheduler()` 或等价 entry 稳定。
5. 为 grouping、notification text 和 repair skip reasons 增加测试。

### 测试

- `pnpm vitest run src/ops/__tests__/doctor-scheduler*.test.ts`
- 为抽出的 modules 增加新测试。

## Slice D：`src/providers/market-intel/collectors/official.ts`

### 目标文件

- `src/providers/market-intel/collectors/calendar.ts`
- `src/providers/market-intel/collectors/news.ts`
- `src/providers/market-intel/collectors/events.ts`
- `src/providers/market-intel/collectors/quotes.ts`
- `src/providers/market-intel/collectors/macro.ts`
- `src/providers/market-intel/collectors/scoring-input.ts`
- `src/providers/market-intel/collectors/parsers/*.ts`

### 计划

1. 用稳定静态 fixture data 为当前 collector output 增加 fixture tests。
2. 先抽取 source-specific parsers。
3. 再抽取 collector orchestration。
4. 在测试证明 parity 前，保持 exported collector API 不变。
5. 如果还没有，对每个 source 增加 redaction/staleness checks。

### 测试

- `pnpm vitest run src/providers/market-intel`
- 在移动 network-facing code 前增加 parser fixture tests。

## Slice E：`src/ops/doctor-repair.ts`

### 目标文件

- `src/ops/doctor-repair/policy.ts`
- `src/ops/doctor-repair/prompt.ts`
- `src/ops/doctor-repair/worktree.ts`
- `src/ops/doctor-repair/verification.ts`
- `src/ops/doctor-repair/path-policy.ts`
- `src/ops/doctor-repair/report.ts`

### 计划

1. 将 repair policy 和 path policy 抽成 pure modules。
2. 抽出 repair prompt builder，并增加 snapshot-style tests。
3. 抽出 verification command runner wrapper。
4. 将 worktree/branch operations 放到 interface 后面。
5. 保持 `scripts/doctor-repair.ts` CLI 行为不变。

### 测试

- 如果存在，运行现有 `src/ops/__tests__/doctor-repair*.test.ts`。
- 为 policy、prompt 和 path allowlist 增加 unit tests。

## Slice F：`src/store/db.ts`

使用 `2026-05-11-db-migrations-state-lifecycle.md` 作为详细实施计划。

不要把 DB migration extraction 和无关 schema additions 混在一起，除非该 schema addition 就是 pilot migration。

## Slice G：`src/config.ts`

使用 `2026-05-11-config-schema-first.md` 作为详细实施计划。

Config refactor 第一阶段应保留 `import { config } from "../config.js"`。

## 实施计划

1. 编码前先选择一个 slice。
2. 识别 public exports 和当前测试。
3. 如果行为尚未覆盖，增加最小 characterization test。
4. 抽取 pure functions 或 side-effect boundaries。
5. 尽可能保留旧 entry file 作为 facade。
6. 运行 focused tests 和 static gates。
7. 更新 docs 和本计划的执行记录。

## 验证计划

每个 slice 的 baseline：

- `pnpm run typecheck`
- `pnpm run lint`
- Focused `pnpm vitest run ...`

当 slice 触及 runtime output：

- `pnpm run build`
- 相关 E2E fake/fixture command，例如 `pnpm run e2e:cron` 或 focused fake runtime tests。

当 slice 触及 docs/source-of-truth behavior：

- `pnpm run quality:docs`

## 风险与回滚

- 风险：行为变化隐藏在 extraction 中。
  - 缓解：增加 characterization tests，并保留 public API。
  - 回滚：revert 该 slice commit；如果测试失败，不要部分保留已移动代码。
- 风险：与其他计划冲突。
  - 缓解：Task runtime、DB 和 config 通过各自 dedicated plans 执行。
- 风险：repo 范围 imports churn。
  - 缓解：迁移期间保留 facade files 并 re-export 旧 names。
- 风险：大型 refactor 变得不可恢复。
  - 缓解：每个 commit 只处理一个 module family。

## 文档同步

- 当 module boundaries 变化时，更新 `docs/architecture.md`。
- 只有 bot routing extraction 改变行为或 dispatch order 时，才更新 `docs/bot-routing.md`。
- 如果增加新 tests/gates，更新 `docs/quality-gates.md`。
- 将 plan docs 作为 execution records，而不是永久 behavior source of truth。

## 执行记录

每个已完成 slice 记录：

- slice name
- changed files
- behavior parity tests
- any public API changes
- follow-up cleanup

