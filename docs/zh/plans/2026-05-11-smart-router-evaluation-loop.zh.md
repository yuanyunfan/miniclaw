---
doc_id: smart-router-evaluation-loop-plan
lang: zh
translation_of: docs/plans/2026-05-11-smart-router-evaluation-loop.md
translation_status: not_required
---

# Smart Router Evaluation Loop

状态：`draft`
日期：2026-05-11

## 背景

`smart_router_decisions` 已经记录足够支持单次决策调试的信息：prompt hash/preview、capability JSON、classifier timing/error、action result 和 created task id。但它还不能提供长期 quality loop。

MiniClaw 需要回答以下 operational questions：

- 用户是否接受建议的 task route，还是继续 chat？
- 自动创建的 task 是否成功完成？
- 哪些 prompts 是 false positives 或 false negatives？
- classifier failure 是否真的伤害用户体验？
- 哪些 route corrections 应该变成 deterministic fixtures？

## 目标

- 持久化 user choice、final route、task final status 和 route correction metadata。
- 更新 Smart Router button handlers，记录 choice 和 final action。
- 将 router decisions 关联到 created task outcome。
- 增加 local `router-review` report，并可选增加 Discord command。
- 将高频真实 prompts 转换成 deterministic fixtures。
- 保持 deterministic policy 作为 permission boundary；LLM classifier 仍然只是 capability hint。

## 非目标

- 不让 LLM classifier 对 permissions 具有权威性。
- 除非现有 config 明确开启，不存储 full prompt text。
- 不从 user prompts 自动训练或 fine-tune model。
- 没有 tests 和 docs 时，不改变 default routing behavior。
- evaluation reports 不要求 real Discord 或 real LLM calls。

## 现有架构证据

- `src/bot.ts`：记录 Smart Router decisions，并处理 Smart Router buttons。
- `src/routing/*`：deterministic intent、context、confirmation、classifier 和 action resolution logic。
- `src/store/db.ts`：`smart_router_decisions` table 和 helpers。
- `docs/bot-routing.md` 和 `docs/chat-router-current-logic.md`：当前 routing behavior 和 decision fields。
- `docs/plans/2026-05-07-smart-task-router-implementation.md`：原始 implementation plan 和 non-goals。
- `src/store/__tests__/db.test.ts`：Smart Router fields 的 schema invariant tests。

## 数据模型提案

向 `smart_router_decisions` 增加 columns，或增加一个窄 companion table。如果当前表仍然较小且 migration 简单，优先 columns。

Candidate columns：

- `user_choice TEXT`
  - examples：`accepted_task`、`continued_chat`、`cancelled`、`ignored`、`auto_task_no_choice`
- `final_route TEXT`
  - examples：`chat`、`task`、`none`
- `task_final_status TEXT`
  - examples：`completed`、`failed`、`cancelled`、`interrupted`、`not_created`
- `correction_type TEXT`
  - examples：`false_positive`、`false_negative`、`classifier_error`、`policy_blocked`、`user_override`、`none`
- `correction_note TEXT`
  - short redacted note 或 deterministic reason
- `resolved_at TEXT`
  - final route/outcome 明确的时间

如果这超出 router-only fields，使用 `smart_router_feedback`：

```sql
CREATE TABLE smart_router_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id INTEGER NOT NULL,
  user_choice TEXT,
  final_route TEXT NOT NULL,
  task_final_status TEXT,
  correction_type TEXT,
  correction_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_id) REFERENCES smart_router_decisions(id)
);
```

## 实施计划

1. 确认当前 schema 和 helpers。
   - 阅读 `src/store/db.ts` 中 `smart_router_decisions` 附近的代码。
   - 识别 update helpers 是否能安全更新 nullable new fields。
2. 增加 persistence fields。
   - 增加 migration columns 或 companion table。
   - 增加 typed helpers，例如 `recordSmartRouterUserChoice`、`recordSmartRouterTaskOutcome` 和 `listSmartRouterReviewRows`。
   - 在 `src/store/__tests__/db.test.ts` 中增加 schema tests。
3. 更新 button handling。
   - 用户点击“转为 task”时，记录 `user_choice=accepted_task`、`final_route=task`。
   - 用户点击“继续 chat”时，记录 `user_choice=continued_chat`、`final_route=chat`。
   - confirmation 过期或取消时，尽可能记录明确 terminal state。
   - 保持 custom id privacy；不要把 prompt text 放进 button ids。
4. 关联 created task outcomes。
   - task 创建时保留当前 `created_task_id`。
   - task final status 更新时，如果存在相关 decision row，则更新该 row。
   - 优先在 task status finalized 的同一点调用小 helper，而不是 polling loop。
   - 如果这会让 task execution 与 router store 耦合，则通过 generic `onTaskFinalized` hook 或 repository helper 隔离。
5. 增加 route correction capture。
   - 先从显式 button choices 和 task outcome 开始；不要过度推断 corrections。
   - 如果用户后续需要标记历史决策为 false positive/negative，再增加简单 slash/local command path。
   - Optional CLI：`pnpm run router:mark -- --decision <id> --correction false_positive`。
6. 增加 review report。
   - 新脚本：`scripts/router-review.ts`。
   - Package script candidate：`"router:review": "tsx scripts/router-review.ts"`。
   - Report dimensions：
     - time window，默认 7 days；
     - channel；
     - initial intent/action；
     - classifier error type；
     - user choice；
     - final route；
     - task outcome；
     - correction type。
   - 输出 terminal-friendly text，不使用宽 Markdown tables。
7. 增加 fixtures。
   - 将代表性 prompts 抽到 `src/routing/__fixtures__/smart-router-prompts.ts` 或 JSON。
   - Categories：
     - current info lookup；
     - multi-step research；
     - file/code change；
     - runtime inspection；
     - ordinary explanation/chat；
     - ambiguous follow-up using recent context。
   - Tests 应断言 deterministic policy 和 expected suggested action。
8. Optional Discord command。
   - 增加 `/router-review days:<n> channel:<optional>`。
   - 保持 output summary 低于 Discord content limits。
   - 不暴露 prompt text，只暴露 prompt preview/hash 和 aggregate counts。

## 验证计划

- Focused tests：
  - `pnpm vitest run src/store/__tests__/db.test.ts`
  - `pnpm vitest run src/routing/__tests__/intent.test.ts src/routing/__tests__/context.test.ts src/routing/__tests__/confirmations.test.ts`
  - 如果实现新 `router-review` script tests，则运行它们。
- Static checks：
  - `pnpm run typecheck`
  - `pnpm run lint`
- Regression：
  - `pnpm test`
- Manual local smoke：
  - 插入或复用 local test decisions。
  - 运行 `pnpm run router:review -- --days 7`。
  - 确认 report 区分 classifier errors、user choices 和 task failures。

## 风险与回滚

- 风险：new schema fields 变成另一个 monolithic DB edit。
  - 缓解：保持 fields nullable 并增加 tests；如果 DB migration refactor 已落地，则增加 versioned migration。
- 风险：task outcome update 让 router 与 task execution 耦合过紧。
  - 缓解：使用按 `task_id` 的小 store helper；task execution 不需要理解 router logic。
- 风险：prompt privacy regression。
  - 缓解：使用 prompt hash 和现有 prompt preview config；默认永远不把 full prompt 加入 reports。
- 风险：错误的 correction inference 造成误导性 metrics。
  - 缓解：先记录 observed facts；只从显式用户动作或 dedicated review command 推断 false positive/negative。

## 文档同步

- 用新 feedback fields 更新 `docs/bot-routing.md` 和 `docs/chat-router-current-logic.md`。
- 如果 schema 变化，更新 `docs/architecture.md` ER diagram。
- 如果 report command 面向用户，增加或更新 Smart Router feature doc。
- 运行 `pnpm run quality:docs`。

## 执行记录

实现时在这里记录 schema version、added fields、report command、fixture categories 和 verification output。

