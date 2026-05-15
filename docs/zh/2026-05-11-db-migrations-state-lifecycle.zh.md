# DB Migrations 与 State Lifecycle 治理

状态：`draft`
日期：2026-05-11

## 背景

`src/store/db.ts` 当前负责 schema creation、schema version upgrades、task helpers、chat history helpers、Smart Router helpers，以及多个 runtime state tables。随着 MiniClaw 累积 `task_events`、incidents、repair runs、market forecasts、Smart Router evaluation fields，以及未来 cron run history，单一 DB module 会变得很难 review。

State lifecycle 也需要显式治理。MiniClaw 会存储私有 operational data：prompts、trace summaries、provider payload summaries、account-adjacent data、email-derived data 和 incident evidence。长期运行时不应永久累积敏感数据。

## 目标

- 在 `src/store/migrations/` 下引入 versioned migration modules。
- 增加 schema migration audit/history。
- 将 table-specific repository helpers 从 DB initialization 中拆出。
- 增加 retention policy config 和 cleanup command。
- 为 exports 和 diagnostic bundles 定义 redaction policy。
- 确保现有用户 DB upgrade path 安全。

## 非目标

- 不 drop 或 rewrite 用户现有 DB。
- 不迁移到不同数据库引擎。
- 不在一个 commit 中实现所有 repository split。
- 在 call sites 迁移前，不移除现有 `src/store/db.ts` exports。
- 不在没有显式 config 和 dry-run command 的情况下静默删除数据。

## 现有架构证据

- `src/store/db.ts`：导出 `SCHEMA_VERSION`，打开 SQLite，创建 tables，应用 migrations，并提供大量 helper methods。
- `src/store/task-events.ts`：已经从 DB 中拆出，用于 task event append/list/count。
- `src/store/incidents.ts`：已经拆出 incidents、incident events 和 repair runs。
- `src/store/market-forecasts.ts`：独立 market forecast repository。
- `src/store/__tests__/db.test.ts`：检查 table/column existence。
- `docs/architecture.md`：记录 schema version 和 ER diagram。
- `scripts/quality-docs.ts`：检查 docs schema version 与 code schema version 一致。

## 目标 Store 布局

```text
src/store/
  db.ts                         # open DB, init, compatibility exports
  connection.ts                 # getDb/open/close/test reset if useful
  schema.ts                     # SCHEMA_VERSION and migration runner
  migrations/
    001-initial.ts
    002-chat-history.ts
    ...
    009-router-feedback.ts
  repositories/
    tasks.ts
    chat-history.ts
    smart-router-decisions.ts
    task-events.ts              # may keep current path and re-export
    incidents.ts                # may keep current path and re-export
    market-forecasts.ts         # may keep current path and re-export
```

使用 facade exports，避免一次性大范围 import migration。

## Schema Audit 提案

增加表：

```sql
CREATE TABLE IF NOT EXISTS schema_version_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_version INTEGER,
  to_version INTEGER NOT NULL,
  migration_name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

规则：

- 每个 migration 成功执行后记录一行。
- 重新运行 init 时，不应为已应用 migrations 重复写入 audit rows。
- 失败 migrations 不应提升 `PRAGMA user_version` 或等价 schema metadata。

## Retention Policy 提案

Config candidates：

```yaml
state:
  retention:
    chat_history_days: 90
    task_events_days: 90
    smart_router_decisions_days: 180
    incidents_days: 365
    repair_runs_days: 365
    market_forecasts_days: 730
    dry_run_default: true
```

Cleanup command candidates：

- `pnpm state:cleanup -- --dry-run`
- `pnpm state:cleanup -- --execute`
- `pnpm state:cleanup -- --table task_events --older-than-days 30`

初始实现应默认 dry-run。

## Redaction Policy

为 diagnostic exports 增加 central policy：

- Prompt previews 有长度上限，并可被 hash。
- Raw prompts 默认排除。
- Provider payloads 默认排除，除非存在 provider-specific allowlist。
- Email/account/broker fields 必须由 provider-specific redactors 脱敏。
- Token-like strings、cookies、authorization headers 和 session ids 永远脱敏。
- Diagnostic bundles 包含 omitted/redacted fields manifest。

这个 policy 应被 task trace export、incident center、provider dry-run 和 state cleanup reports 复用。

## 实施计划

1. 移动逻辑前先增加 migration runner tests。
   - 测试从空 DB 应用 migrations。
   - 测试旧版本 DB 升级到当前版本。
   - 测试第二次 init 的 idempotency。
2. 抽出 `SCHEMA_VERSION` 和 migration runner。
   - 保持 `src/store/db.ts` 作为 public facade。
   - 在不改变 SQL 的前提下，将当前 inline migration blocks 移入 migration functions。
3. 增加 `schema_version_history`。
   - Migration runner 记录已应用 migrations。
   - 增加 repository/helper，用于 diagnostics 查看 history。
4. 增量拆分 repositories。
   - 第一个候选：Smart Router decisions，因为 evaluation-loop 会增加 fields。
   - 如果 task repository 变得过大，单独拆分。
   - 使用 `db.ts` re-exports 避免大范围 call-site churn。
5. 增加 retention config。
   - 如果 config schema-first refactor 尚未落地，保守地向当前 config 增加 fields。
   - 只有当项目模式要求时才包含 env overrides。
6. 增加 cleanup command。
   - 新脚本 `scripts/state-cleanup.ts`。
   - Package script candidate：`"state:cleanup": "tsx scripts/state-cleanup.ts"`。
   - Dry-run output 列出 table、count、oldest/newest timestamps 和 delete SQL summary。
7. 增加 redaction policy helpers。
   - 候选文件：`src/privacy/redaction.ts` 或 `src/store/redaction.ts`。
   - 如果 provider framework 也要复用，优先放在中立位置。
8. 更新 docs 和 quality checks。
   - 更新 `docs/architecture.md` schema version 和 migration layout。
   - 如果 schema version extraction path 变化，更新 `scripts/quality-docs.ts`。

## 验证计划

- Focused：
  - `pnpm vitest run src/store/__tests__/db.test.ts`
  - 增加 `src/store/__tests__/migrations.test.ts`
  - 如果 cleanup logic 是 pure/testable，增加 `src/store/__tests__/state-cleanup.test.ts`。
- Static：
  - `pnpm run typecheck`
  - `pnpm run lint`
- Regression：
  - `pnpm test`
  - `pnpm run build`
- Manual safety：
  - 使用 temp SQLite DB 做 migration smoke。
  - 只运行 `pnpm state:cleanup -- --dry-run`；实现期间不要对真实 DB 执行 deletion，除非用户明确要求。

## 风险与回滚

- 风险：migration bug 损坏用户 DB。
  - 缓解：在 temp DB 上测试，保持 idempotent migrations，live migration 前记录 backup command。
  - 回滚：恢复 DB backup，并 revert migration commit。
- 风险：facade/re-export drift 破坏 imports。
  - 缓解：在 call sites 迁移前保持 `db.ts` exports 稳定。
- 风险：cleanup 删除有用 state。
  - 缓解：dry-run default、显式 `--execute`、保守 retention defaults。
- 风险：schema version docs check 在文件拆分后失败。
  - 缓解：在移动 `SCHEMA_VERSION` 的同一 slice 中更新 `quality-docs.ts`。

## 文档同步

- 更新 `docs/architecture.md` ER diagram、schema version、migration lifecycle 和 state retention。
- 如果 `quality:docs` 开始检查 migration files，更新 `docs/quality-gates.md`。
- 如果 redaction policy 共享，更新 provider/incident/trace docs。
- 运行 `pnpm run quality:docs`。

## 执行记录

实现时在这里记录 migration versions、repository splits、retention defaults 和 verification commands。

