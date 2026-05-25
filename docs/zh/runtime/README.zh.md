---
doc_id: runtime-index
lang: zh
translation_of: docs/runtime/README.md
translation_status: current
source_sha256: 5aa9695b36f2c82c1ba08e5d0dd7ba02ac4c421aea5cbf876cbc28edbbfddf7e
---
# MiniClaw Runtime 文档

> 结论：runtime 文档说明 MiniClaw 如何接收 Discord / IM 输入、路由 chat/task 工作、执行 cron 和 agent task、管理 memory/context，以及处理运行态恢复。Provider 文档负责外部数据采集 contract；runtime 文档负责执行、持久化、投递和修复行为。

## Runtime 地图

```mermaid
flowchart TD
  Discord[Discord / IM intake] --> Intake[Message and slash intake]
  Intake --> Router[Routing / Smart Router]
  Router --> Chat[Chat runtime<br/>API fast path]
  Router --> Task[Task runtime]
  Cron[Cron scheduler] --> ProviderContext[Pre-provider context]
  ProviderContext --> Task
  Task --> AgentRuntime[Claude / Codex / managed runtime]
  AgentRuntime --> TaskEvents[Task view events]
  TaskEvents --> Delivery[Discord / IM delivery]
  Memory[Memory curation and injection] --> Chat
  Memory --> Task
  Connectivity[Connectivity monitor and recovery outbox] --> Ops[Auto Doctor]
  Ops --> Delivery
  AgentRuntime --> Manager[Agent Run Manager]
  Manager --> AgentBus[Agent Bus / ACP lifecycle]
```

## 入口与路由

Owner docs:

- [`../../bot-routing.md`](../../bot-routing.md): Discord Gateway、message handling、slash command dispatch、thread continuation、channel routing，以及 chat/task 边界。
- [`../../chat-router-current-logic.md`](../../chat-router-current-logic.md): 当前代码级 chat router 逻辑和已知误分流边界。

Owner code paths:

```text
src/bot.ts
src/commands/**
src/discord/**
src/im/adapters/weixin/**
src/routing/**
src/agent/chat.ts
src/store/repositories/smart-router-decisions.ts
```

Routing contract:

- Slash command 先于自然语言 message routing。
- Thread continuation 必须保留原始 task/chat context，不能对每条 reply 从头重新分类。
- Smart Router 可以把像 task 的 prompt 转入 task path，但不能提升普通 chat 权限。
- Confirmation button 保存 pending task context，并且必须安全过期。
- Per-channel cwd override 是 routing context，不是 prompt 文本。
- Weixin chat 复用 `chat()` 边界，但会要求它优先使用 lightweight Anthropic/OpenAI-compatible API client，再 fallback 到配置的 agent runtime。
- Weixin direct 可以作为唯一启用的 IM gateway；当 `im.transports.discord.enabled=false` 时，Discord credentials 变为可选，MiniClaw 仍会启动非 Discord gateway。
- Weixin 入站媒体会在路由前标准化：官方 `image_item.media` 和 `voice_item.media` CDN 引用会被下载、按 AES-ECB 解密，语音 SILK 会尽量转成 WAV 后再进入附件处理链路。

Smart Router resolution order:

```mermaid
flowchart LR
  Message[Incoming message] --> Deterministic[Deterministic guards]
  Deterministic --> LLM[LLM classifier when needed]
  LLM --> Policy[Policy resolver]
  Policy --> Chat[chat]
  Policy --> Confirm[ask for task confirmation]
  Policy --> Task[create task]
  Policy --> Ignore[ignore / no-op]
```

## 任务输出与 Trace UX

Owner code paths:

```text
src/agent/task.ts
src/agent/task-reporter.ts
src/agent/task-view-events.ts
src/discord/task-view-reporter.ts
src/discord/task-trace-attachment.ts
scripts/task-trace.ts
```

Runtime contract:

- Task runner 负责执行和状态；Discord view code 负责渲染。
- Progress message 应保留到足以调试 task，而不是成功后立即删除。
- Final task result 应尽量作为普通 Markdown message 发送，而不是藏在窄 embed description 里。
- Task events 是 runner、trace 和 Discord rendering 之间的共享边界。
- 大 trace 应导出或作为附件发送，而不是刷屏到 Discord message。

Current delivery shape:

- Status card: 简短 embed，展示当前状态。
- Progress stream: 持久 progress/update message。
- Final result: 普通 Markdown message，必要时 chunking。Discord 正文 chunk 会 suppress link embeds，裸 URL 只会在最后的 link-preview footer 里重复，因此卡片出现在完整结果之后，而不是插在正文 chunk 中间。
- Fanout and replay: Discord IM fanout、recovery outbox replay 和 script cron `DISCORD_MESSAGE` output 使用与 task results 相同的 deferred-link-preview helper。
- Weixin delivery: 文本使用 `sendmessage`；文件投递使用官方 `getuploadurl -> CDN AES upload -> sendmessage` 链路，并把 caption 和媒体拆成独立 message item。Session expired `-14` 会让受影响账号暂停一小时。
- Weixin chat 会在 `getconfig` 返回 typing ticket 时发送 `sendtyping` start、keepalive 和 cancel 信号，让较长 LLM 回复在微信里有可见的输入状态。
- Trace view: task events 和 trace-export command 提供 operator 级细节。

## Weixin 协议兼容

MiniClaw 的 Weixin adapter 是 native IM transport 实现，当前对齐官方源码快照 `tencent-weixin-openclaw-weixin 2.4.3` 和 npm 包 `@tencent-weixin/openclaw-weixin` 版本 `2.4.3`。它运行时不直接 import 这个官方包；本地 adapter 负责 MiniClaw routing、credential storage、Smart Router confirmation、task reporting 和 delivery semantics。

跟踪的官方协议文件：

```text
src/api/types.ts
src/media/media-download.ts
src/messaging/send-media.ts
src/cdn/upload.ts
src/api/session-guard.ts
src/auth/login-qr.ts
```

官方包升级时的流程：

1. 把官方包源码放到本地，然后运行 `pnpm weixin:drift-check -- --package-dir /path/to/tencent-weixin-openclaw-weixin`。
2. 只有 drift report 显示官方协议 anchor 改变时，才更新 MiniClaw；改完后运行 `pnpm test src/im/__tests__/weixin-transport.test.ts`。
3. 保持 `src/im/__fixtures__/weixin-official-payloads.json` fixture coverage 最新；它覆盖官方形状的 image media、voice media、media upload、QR expiration、session-expired `-14` 和 chat/task confirmation payloads。
4. Unit tests 通过后跑 live smoke：`pnpm weixin:login`，停止正常 gateway，然后运行 `pnpm weixin:smoke -- --account <accountId> --target <user@im.wechat> --image /path/to/image --save-buffer`。
5. 重启 MiniClaw 并手动验证 end-to-end routing：普通文字应该作为 chat 回复，像 task 的消息应该询问 `y` or `n`，回复 `y` 应执行 task，回复 `n` 应继续 chat。

## Cron Runtime 执行时

Owner code paths:

```text
src/cron/**
src/providers/index.ts
src/providers/framework.ts
src/store/cron-runs.ts
```

Execution flow:

```text
cron schedule
  -> load job config
  -> enabled 时应用全局 config.yaml cron.active_window guard
  -> optional provider health/dry-run preflight
  -> run pre_provider when configured
  -> inject provider text into task prompt
  -> inject task output contract when configured
  -> execute task runtime
  -> run output validator hook
  -> commit provider state only after downstream task success
  -> persist cron run and recovery metadata
```

Runtime contract:

- Provider commit callback 只能在 downstream task 成功后运行。
- Provider failure 默认 fail closed，除非 provider config 明确允许 partial data。
- `type=task` job 可以在 cron YAML 内配置 inline `output_template` 或 `output_contract.template` 文本，在 provider/script context 之后、job prompt 之前注入 prompt-level output contract。
- 配置 output contract 时，MiniClaw 会先注入共享 chat/IM output surface policy；cron YAML 只应描述报告结构、机器块、privacy/link/length 例外和其他 job-specific 格式。
- Output contract 是给 LLM 的格式指令，不是 deterministic renderer；v1 不会在 task 执行后重写最终消息。
- `output_contract.validator` 预留 runtime validation。v1 只支持 `none`，但 hook 会在 task result 成功后、extra delivery、attachment delivery 和 provider commit callback 之前运行。
- `cron.active_window` 是全局 scheduled-dispatch guard。窗口外 MiniClaw 写入 `error_category=outside_active_window` 的 skipped `cron_runs` row，不调用 script、provider 或 task runtime。
- Missed-run audit 会忽略 `cron.active_window` 之外的 expected schedules，避免睡眠/离线时段产生误报 missed-run incident。
- 手动 `pnpm cron:test` 会绕过 `cron.active_window`，因为它是显式 operator action。
- Cron run record 是 Auto Doctor 和 recovery workflow 的运维证据。
- Script job 和 task job 共享 delivery semantics，但不共享 prompt/provider handling。

## Memory 与 Prompt 上下文

Owner code paths:

```text
src/memory/**
src/agent/prompts.ts
src/routing/*context*.ts
src/cron/runner-task.ts
```

Prompt/context contract:

- Chat、task、cron、provider、memory 和 runtime adapter context 必须作为显式 component 组装。
- 不可信 user/provider content 应与 system/developer instruction 隔离。
- Provider payload 进入 prompt 前应 schema-aware 且经过 compact。
- Memory injection 应有用但有界；route 不需要时，task prompt 不应收到无关的 always-on memory。
- 完整 cron prompt 和 provider payload 都是高敏数据，不应过度持久化。

Memory lifecycle:

```mermaid
flowchart LR
  Conversation[Conversation / task output] --> Candidate[Memory candidate]
  Candidate --> Validate[Validation and dedupe]
  Validate --> Store[Markdown memory store]
  Store --> Inject[Context injection]
  Store --> Maintenance[Maintenance / archive / metadata]
```

## 连接性与恢复

Owner code paths:

```text
src/monitoring/connectivity-core.ts
src/monitoring/connectivity-monitor.ts
src/monitoring/recovery-outbox.ts
src/monitoring/pre-client-ready-watchdog.ts
src/monitoring/weixin-alert.ts
src/runtime/discord-login.ts
src/im/adapters/weixin/transport.ts
src/notifications/smtp-email.ts
```

Operations contract:

- Connectivity check 会分别分类 Discord、network、SMTP fallback 和 startup readiness。
- Discord/VPN/proxy outage alert 在 general network 仍可达时通过 Weixin 发送；SMTP 保留为诊断 probe 和独立 operations notifier 能力。
- Discord startup login failure 会在 Weixin direct 启用时发送 Weixin ops alert，然后按 10 分钟、20 分钟、40 分钟 backoff 重试；重试预算耗尽后才 fallback 到非 Discord IM gateway。
- Recovery outbox 应在 Discord connectivity 恢复后回填失败的 cron/task delivery。
- Pre-clientReady watchdog failure 应在本机可见，并且输出经过 redaction。

## Auto Doctor 诊断器

Owner code paths:

```text
src/ops/doctor.ts
src/ops/doctor/**
src/ops/doctor-scheduler/**
src/ops/doctor-repair/**
src/ops/doctor-ship.ts
scripts/doctor.ts
scripts/doctor-repair.ts
scripts/doctor-ship.ts
```

Doctor capabilities:

- Diagnose task、cron、PM2、logs、connectivity、third-party health 和 recent incidents。
- 持久化 incident category、status、evidence、summary 和 trace references。
- 在发送 Discord summary 前聚合重复失败。
- 在隔离 worktree 中按 path policy 和 verification 运行 guarded repair。
- 只能通过显式 guarded command preview 和 ship repair branch。

Safety boundary:

- Auto Doctor evidence collection 默认只读。
- Repair execution 必须 path-scoped、verified，并与无关 user changes 隔离。
- Ship flow 不能绕过 review、verification 或 restart policy。
- Secrets、cookies、tokens、account IDs 和 raw private provider payloads 必须从 report 中 redacted。

## Agent Run Manager 管理器

Owner code paths:

```text
src/agent/run-manager/**
src/agent/run-manager/acp/**
src/agent/run-manager/mcp/**
src/agent/runtimes/task-runner-runtime.ts
```

Runtime boundary:

- Agent Run Manager 是 task-scoped orchestration，不是默认 chat path。
- 它负责 managed child runtime scheduling、Agent Bus state、final synthesis、ACP lifecycle 和 managed runtime routing。
- 可选的 `agent_run_manager.model_routing` 可以按 child role 选择 provider/model/reasoning，让 planner 使用更强模型，同时让 generator/evaluator 使用更便宜模型。Escalation 可在 runtime failure 或 evaluator 返回 `FAIL` 后，用更强模型重试后续 generator turn。
- Child runtime 通过受控 adapter 接收 injected task context，不能任意访问 live MiniClaw state。
- Final synthesis 应引用 child outcomes，并保留 failed/partial child state。
- Sweeper 和 guardrails 必须防止 stuck run 和无界 child-runtime 增长。

## 历史遗留清理

上一轮 feature-level runtime stubs 已在迁移完成后删除。本文件现在是这些 runtime 主题的 canonical 中文 mirror。

## 开发检查清单

- Routing 或 Smart Router 行为变化：更新本文件、[`../../bot-routing.md`](../../bot-routing.md) 和 [`../../chat-router-current-logic.md`](../../chat-router-current-logic.md)。
- Task output、task events 或 trace 行为变化：更新 Task Output section。
- Cron execution 或 provider commit semantics 变化：更新 Cron Runtime section 和相关 provider docs。
- Prompt assembly、provider payload compaction 或 memory injection 变化：更新 Memory And Prompt Context section。
- Connectivity、recovery、watchdog 或 SMTP fallback 变化：更新 Connectivity And Recovery section。
- Auto Doctor diagnose/repair/ship 行为变化：更新 Auto Doctor section。
- Agent Run Manager scheduling、bus、ACP lifecycle、child runtime injection 或 final synthesis 变化：更新 Agent Run Manager section。

Verification owner:

```bash
pnpm run quality:docs
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run e2e:cron
```
