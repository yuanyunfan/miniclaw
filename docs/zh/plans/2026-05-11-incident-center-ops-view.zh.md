---
doc_id: incident-center-ops-view-plan
lang: zh
translation_of: docs/plans/2026-05-11-incident-center-ops-view.md
translation_status: not_required
---

# Incident Center Operator View

状态：`draft`
日期：2026-05-11

## 背景

MiniClaw 已经有一个有意义的 Auto Doctor 基础：

- `/doctor`
- `/incidents`
- `/incident view`
- `/incident resolve`
- `/incident ignore`
- `/incident retry-repair`
- `/incident ship-preview`
- `/incident approve-ship`
- guarded repair worker
- guarded ship path
- safe restart boundary

剩余缺口是 operator continuity。用户应能从一个 incident id 追踪 original task/cron/log evidence、task trace、repair run、ship preview、restart decision、blockers、rollback command 和 post-ship monitoring state。

## 目标

- 将 `/incident view` 强化成紧凑的 operator detail view。
- 增加按 type、category、route、provider、repair status 和 severity 搜索/过滤 incidents。
- 增加 repair branch review report，包含 diff summary、changed paths、verification commands、risks 和 rollback command。
- 将 incidents 关联到 task trace、cron run detail、repair run detail、ship preview 和 restart status。
- 让 MiniClaw 主进程在 diagnosis 中保持 read-only；repair writes 留在 isolated worktrees。

## 非目标

- 本 slice 不创建 web dashboard。
- 没有显式 approval 时，不 auto-update `main` 或 restart production。
- 不在 Discord 中暴露 raw evidence bundles、prompts、credentials、cookies 或 account data。
- 不让 main bot process 修改 source files。
- 不替换 `doctor:repair` 或 `doctor:ship`；只改进它们的 review surfaces。

## 现有架构证据

- `src/commands/register.ts`：incident slash commands 已注册。
- `src/commands/handlers.ts`：处理 `/incidents` 和 `/incident` subcommands。
- `src/commands/incident-detail.ts`：格式化 incident detail text。
- `src/store/incidents.ts`：incident、incident event 和 repair run repositories。
- `src/ops/doctor.ts`：evidence collection 和 diagnosis。
- `src/ops/doctor-scheduler.ts`：scheduled diagnosis、notifications、repair attempts。
- `src/ops/doctor-repair.ts`：isolated worktree repair flow 和 repair reports。
- `src/ops/doctor-ship.ts`：guarded ship 和 optional safe restart。
- `docs/zh/archive/features/13-auto-doctor.zh.md`：当前 Auto Doctor 用户文档。
- `docs/plans/2026-05-10-miniclaw-auto-doctor-self-repair.md`：原始 self-repair loop plan。

## 目标用户体验

### `/incidents`

支持 optional filters：

- `status`
- `type`
- `severity`
- `category`
- `provider`
- `route`
- `repair_status`
- `limit`

默认仍只显示 open incidents。

输出应分组且紧凑：

- headline count
- top severity/type groups
- incident rows，包含 short id、severity/status、type、subject、updated age、repair state
- command hints

### `/incident view id:<prefix>`

有数据时增加 sections：

- core incident facts
- source subject
- diagnosis summary
- 如果 subject 是 task，提供 linked task trace command
- 如果 subject 是 cron 且 cron run history 存在，提供 linked cron run command
- recent incident events
- repair run summary
- ship preview state
- restart status
- blockers
- rollback command 或 revert instructions
- next recommended operator action

### Repair Review Report

增加 reusable formatter，用于 repair review：

- incident id and title
- repair branch and commit
- base SHA
- changed files
- diff summary
- verification commands and exit status
- blocked paths result
- risks and rollback command
- ship/restart commands

暴露方式：

- `pnpm run doctor:ship -- --incident <id>` dry-run output
- `/incident ship-preview`
- 如果 `/incident view` 过长，也许增加 `/incident repair-report id:<id>`

## 数据模型增补

优先使用现有 `repair_runs.report_json` 和 `verification_json`。

如果需要缺失字段，后续再增加 nullable fields：

- `repair_runs.diff_summary_json`
- `repair_runs.changed_files_json`
- `repair_runs.rollback_command`
- `repair_runs.ship_blockers_json`
- `repair_runs.post_ship_monitoring_json`

在 formatter 证明当前 stored JSON 不足之前，不增加 schema fields。

## 实施计划

1. 盘点当前 incident 和 repair JSON payloads。
   - 使用 tests 和 local dry-run outputs；不要为了 docs 检查 private live data。
2. 增加 incident filter store helpers。
   - 扩展 `listOpenIncidents` 或增加 `listIncidents(filters)`。
   - 保持 id-prefix resolution 不变。
   - 增加 filters 和 sorting tests。
3. 扩展 `/incidents`。
   - 在 `src/commands/register.ts` 中增加 optional filter args。
   - 在 `src/commands/handlers.ts` 中实现 filter parsing。
   - 保持输出低于 Discord limits。
4. 改进 `formatIncidentDetail`。
   - 增加 linked command hints：
     - 可用时 `/task-log id:<task-prefix>`；
     - cron history 存在时 future `/cron-run id:<run-id>`；
     - local preview 用 `pnpm run doctor:ship -- --incident <id>`。
   - 从 latest repair run 增加 repair state 和 blockers。
5. 增加 repair review formatter。
   - 候选文件：`src/commands/repair-review.ts` 或 `src/ops/doctor-repair-report.ts`。
   - 尽可能在 `doctor:ship` dry-run 和 Discord ship preview 中复用。
6. 增加 post-ship monitoring hints。
   - 成功 ship/restart 后，incident events 应记录 main update 和 restart attempt。
   - View 应展示这些 events 和 next check command；除非已有配置，否则不 auto-run monitoring。
7. 一旦 task trace exporter 实现，复用它。
   - 如果 trace exporter 尚未落地，只增加 command hints，并把这项保留在 execution notes。
8. 增加测试。
   - Incident filter tests。
   - Incident detail formatting tests。
   - Repair review formatter tests。

## 验证计划

- Focused：
  - `pnpm vitest run src/store/__tests__/incidents.test.ts`
  - `pnpm vitest run src/commands/__tests__/incident-detail.test.ts`
  - 如果实现 repair review，则增加对应 tests。
- Static：
  - `pnpm run typecheck`
  - `pnpm run lint`
- Full：
  - `pnpm test`
- Optional local smoke：
  - `pnpm run doctor -- --json`
  - 当存在 safe test incident 时，运行 `pnpm run doctor:ship -- --incident <test-incident> --json`。

## 风险与回滚

- 风险：incident view 超过 Discord message limits。
  - 缓解：保持 detail sections 紧凑；只有 redaction 和 size handling 就绪时才使用 attached Markdown。
- 风险：filters 产生误导性 empty output。
  - 缓解：包含 active filter summary 和 examples。
- 风险：repair report 泄露 sensitive files 的 diff content。
  - 缓解：默认展示 changed paths 和 summary；避免在 Discord 中展示 raw diff。
- 风险：operator commands 暗示 auto-approval。
  - 缓解：copy 应明确 approval boundary；ship/restart commands 仍然显式执行。

## 文档同步

- 更新 `docs/zh/archive/features/13-auto-doctor.zh.md`。
- 如果 incident data model 或 command surface 改变，更新 `docs/architecture.md`。
- 如果 slash command behavior 有实质变化，更新 `docs/bot-routing.md`。
- 运行 `pnpm run quality:docs`。

## 执行记录

实现时在这里记录 new filters、formatter behavior、command output examples 和 verification evidence。

