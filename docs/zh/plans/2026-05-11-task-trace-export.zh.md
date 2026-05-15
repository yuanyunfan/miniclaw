---
doc_id: task-trace-export-plan
lang: zh
translation_of: docs/plans/2026-05-11-task-trace-export.md
translation_status: not_required
---

# Task Trace Export 与 Discord Task Log

状态：`draft`
日期：2026-05-11

## 背景

MiniClaw 已经在 `task_events` 中持久化 structured task facts。Auto Doctor 和 incident views 可以读取部分 task-related evidence，但用户还没有一个针对近期 task 的直接、用户可读 trace output。

缺失的表面是安全的 `/task-log` 或 `/task trace` command，以及类似 `task-<id>-trace.md` 的 Markdown exporter。Exporter 必须有助于 diagnosis，同时避免 prompt、cookie、token、email、account 和 provider payload 泄露。

## 目标

- 增加一个由 `task_events` 支撑的 reusable task trace Markdown exporter。
- 增加一个 Discord slash command，用于通过 id prefix 查找近期 task trace。
- 增加一个 local trace export/debugging CLI。
- 尽可能从 Auto Doctor incident detail 复用同一个 exporter。
- 为失败或长时间运行 tasks 增加 threshold-based automatic trace attachment。
- 默认强制 redaction 和 size limits。

## 非目标

- 不暴露 full prompts、raw provider payloads、cookies、tokens、raw email bodies、broker account data 或 attachment file contents。
- 不替换 Auto Doctor diagnosis。
- 不构建 web dashboard。
- 本地 trace export 不要求 Discord。
- 不默认让每个成功的短 task 上传 trace file。

## 现有架构证据

- `src/store/task-events.ts`：持久化并列出 task events。
- `src/agent/task-reporter.ts`：写入 event types，包括 `task_started`、`task_accepted`、`task_context_captured`、`session_started`、`turn_started`、`turn_completed`、`tool_event`、`provider_error`、`discord_delivery_failed` 和 final status events。
- `src/store/db.ts`：task rows 包含 task id、status、cwd、prompt、thread/source metadata、result summary 和 session id。
- `src/commands/register.ts`：负责 slash command registration。
- `src/commands/handlers.ts`：负责 `/status`、`/doctor`、`/incident`、`/resume` 和其他 command handlers。
- `src/commands/incident-detail.ts`：当前格式化 incident events 和 repair runs。
- `src/ops/doctor.ts`：已经查询 `task_events` 作为 evidence。

## 数据与隐私契约

### 安全 Trace 字段

默认 user trace 可以包含：

- task id and status
- created/completed timestamps
- cwd
- route/source type
- source channel/thread/message ids or URLs when available
- provider name
- session id
- event type
- severity
- compact message
- allowlist 中选定的 payload keys
- events 之间的 elapsed time
- error type and sanitized error message

### 禁止或脱敏字段

默认 user trace 不得包含：

- full prompt text
- raw `payload_json`
- cookies、tokens、API keys、session strings
- full email bodies 或 account numbers
- raw provider JSON
- local private file contents
- binary attachment contents
- unbounded stack traces

先使用 allowlist。Regex redaction 是第二道防线，而不是主要 privacy model。

## 实施计划

1. 增加 `src/store/task-trace-export.ts`。
   - 导出 `resolveTaskForTrace(idPrefix: string)`。
   - 导出 `buildTaskTraceModel(taskId: string, options)`。
   - 导出 `renderTaskTraceMarkdown(model)`。
   - 从 `getTask`、`listTaskEvents` 和 `countTaskEvents` 读取。
   - 对 missing id、ambiguous prefix 和 task with no events 返回明确 errors。
2. 定义 trace event projection。
   - 防御性解析 `payload_json`。
   - 通过 per-event allowlist 保留 payload keys。
   - 当 keys 被省略时，增加 `redacted_payload_keys` count。
   - rendered timeline 中保持 chronological event ordering。
3. 增加 redaction helpers。
   - Shared helper 应脱敏常见 token-like 和 credential-like strings。
   - 为 token、cookie、authorization header、email body marker、account-like values 和 long prompt-like payload 增加 unit tests。
   - 截断所有 free-text field。
4. 增加 local CLI。
   - 新脚本：`scripts/task-trace.ts`。
   - Package script candidate：`"task:trace": "tsx scripts/task-trace.ts"`。
   - Usage examples：
     - `pnpm run task:trace -- --id <task-prefix>`
     - `pnpm run task:trace -- --id <task-prefix> --out /tmp/task-trace.md`
     - `pnpm run task:trace -- --id <task-prefix> --json`
5. 增加 Discord slash command。
   - 如果 Discord command naming 允许，优先 `/task-log id:<prefix>`。
   - 如果更偏好 command grouping，则使用 `/task-trace id:<prefix>`。
   - Handler 应：
     - 检查 `allowedUserId`；
     - defer ephemeral reply；
     - 在 reply 中渲染 short summary；
     - 当 trace 超过 Discord content limits 时附加 Markdown file。
6. 集成 incident detail。
   - 当 `subject_type === "task"` 且 `subject_id` 存在时，向 `formatIncidentDetail` 增加 trace command hint。
   - 如果尺寸允许，可选地在 incident detail 中包含最严重 recent task event summary。
   - 避免在 incident code 中复制 trace formatting。
7. 增加 threshold-based trace attachment。
   - Configuration candidate：
     - `tasks.trace_auto_attach.enabled`
     - `tasks.trace_auto_attach.on_failure`
     - `tasks.trace_auto_attach.min_duration_ms`
     - `tasks.trace_auto_attach.min_event_count`
     - `tasks.trace_auto_attach.max_bytes`
   - 保守开始：只在 failed task 上 attach，或如果行为太显眼，则放在 config default false 后面。
   - 在 `executeTask` 知道 final status 后，挂到 final task reporting。
8. 增加测试。
   - Unit tests 覆盖 resolver、renderer、redaction、size truncation 和 ambiguous id prefix。
   - 如果现有 Discord test utilities 支持，增加 handler test 覆盖 permission 和 attachment-vs-inline behavior。

## 验证计划

- Focused tests：
  - `pnpm vitest run src/store/__tests__/task-trace-export.test.ts`
  - 如果增加 command tests，运行 `pnpm vitest run src/commands/__tests__/task-log.test.ts`。
  - 如果触及 incident detail，运行现有 test：`pnpm vitest run src/commands/__tests__/incident-detail.test.ts`
- Static checks：
  - `pnpm run typecheck`
  - `pnpm run lint`
- Full regression：
  - `pnpm test`
- Manual local smoke：
  - 运行 fake task test 或使用现有 local DB task id。
  - `pnpm run task:trace -- --id <prefix>`
  - 验证生成的 Markdown 有 timeline，且没有 raw prompt/provider payload。

## 风险与回滚

- 风险：trace export 泄露敏感数据。
  - 缓解：allowlist payload keys、default truncation、redaction tests，并且不输出 raw `payload_json`。
  - 回滚：禁用 slash command registration，直到 redaction 修复前保持 CLI local-only。
- 风险：trace attachment 增加 Discord 噪声。
  - 缓解：让 auto-attach threshold 保守并由 config gate 控制。
  - 回滚：关闭 `tasks.trace_auto_attach.enabled`。
- 风险：large traces 超过 Discord file limits。
  - 缓解：限制 bytes，并包含 truncation notice。
- 风险：incident detail 过长。
  - 缓解：在 incident detail 中包含 command hints，而不是 full traces。

## 文档同步

- 用 trace exporter 和 redaction policy 更新 `docs/architecture.md`。
- 为新 slash command 更新 `docs/bot-routing.md`。
- 如果 incident detail 链接 task trace，更新 `docs/zh/archive/features/13-auto-doctor.zh.md`。
- 如果创建新 feature doc，更新 `docs/README.md`。
- 运行 `pnpm run quality:docs`。

## 执行记录

实现时在这里记录 command name、config defaults、redaction policy 和 verification evidence。

