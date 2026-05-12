# MiniClaw 下一阶段持续优化报告

日期：2026-05-11

## TLDR

本报告只保留下一阶段仍需提升的内容，不再展开历史 WIP 收敛、已有能力清单或正向评价段落。对齐当前代码后，最值得优先推进的是任务执行展示边界、trace 用户视图、Smart Router 评估闭环、provider framework、DB/config 治理、incident center 和 docs drift 防护。

短期第一优先级是 `TaskViewEvent + Discord view reporter + trace export`。现在 `TaskReporter` 已经承担 SQLite 观测写入，但 SDK 事件归一化、Discord progress/final 渲染和用户可导出的完整 trace 还没有形成清晰边界，这会继续放大 `src/agent/task.ts` 的复杂度。

第二优先级是把运行态数据变成可评估闭环：Smart Router 不能只记录 classifier 结果，还要能关联用户按钮选择、实际创建 task、最终 task outcome 和 route correction；Auto Doctor 不能只产生 incident，还要让 incident、trace、repair run、ship preview 和 restart decision 可以被连续追踪。

不建议把 MiniClaw 扩展成通用 Agent 平台，也不建议默认把所有任务多 agent 化。正确方向是围绕个人自动化、私有数据、Discord-native delivery 和可替换 runtime adapter 做运行系统治理。

## 本次对齐范围

本次只对齐当前代码实现，不修改业务代码；文档以代码证据作为风险判断依据。

用于判断剩余改进项的代码证据：

- 本次复核发现并修正了 `docs/architecture.md` 的 DB schema version / Smart Router 字段 drift，并新增了 `quality:docs` 的第一层检查；剩余问题是 changed-path 到 docs path 的语义映射仍未脚本化。
- `src/agent/task-reporter.ts` 和 `src/store/task-events.ts` 负责写入 `task_events`，但仓库里没有真正的 `TaskViewEvent` source file 或 Discord view reporter。
- `src/agent/task.ts` 仍直接消费 Claude/Codex SDK 事件、格式化 tool progress、更新 Discord progress，并发送最终结果。
- `src/bot.ts` 仍集中处理 Discord message、Smart Router、chat、task、button 和 slash command 事件。
- `src/providers/types.ts` 的 provider contract 仍主要是 `PreProviderResult`：`text`、`attachments`、`skipTask`、`commit`。
- `src/config.ts` 仍集中处理 YAML/env loading、validation、path resolution、agent provider、doctor、connectivity、routing 和 attachment 配置。
- 最大复杂度热点仍集中在 `src/providers/market-intel/collectors/official.ts`、`src/agent/task.ts`、`src/ops/doctor-scheduler.ts`、`src/bot.ts`、`src/ops/doctor-repair.ts`、`src/store/db.ts`、`src/config.ts` 和 `src/ops/doctor.ts`。

## P1: 任务展示边界仍未拆开

### 当前问题

`src/agent/task.ts` 仍同时承担这些职责：

- active task lifecycle、cancel、interrupt、drain。
- Claude Agent SDK 和 Codex SDK 分支执行。
- SDK 原始事件解析。
- tool progress line 格式化。
- Discord progress update。
- final embed/raw result 发送。
- DB task 状态更新。
- `TaskReporter` 观测事件写入。

`TaskReporter` 现在是 observability reporter，不是 view reporter。它把事件写入 `task_events`，但不应该继续承载 Discord 展示职责。下一阶段需要明确区分：

- `TaskTraceReporter` 或保留现名 `TaskReporter`：只负责结构化观测写入。
- `TaskViewEvent`：统一 Claude/Codex/fake runtime 的用户可见事件。
- `DiscordTaskViewReporter`：只负责把 `TaskViewEvent` 渲染成 Discord status、progress、final output 和附件。

### 建议改动

1. 新增 `src/agent/task-view-events.ts`，定义最小 `TaskViewEvent` union。
2. 拆出 `src/agent/runners/claude-task-runner.ts` 和 `src/agent/runners/codex-task-runner.ts`，只负责 SDK -> `TaskViewEvent` + `TaskResult`。
3. 新增 `src/discord/task-view-reporter.ts`，负责 Discord progress/final rendering。
4. 保留 `src/agent/task-reporter.ts` 作为 SQLite trace writer，避免和 Discord reporter 混名。
5. 让 `executeTask` 逐步退化成 orchestration shell，而不是继续承载 SDK 和 Discord 细节。

### 验收标准

- `src/agent/task.ts` 不再直接格式化大部分 tool progress line。
- Claude/Codex SDK event schema 变化时，只影响对应 runner。
- Discord 展示策略变化时，不需要改 Claude/Codex runner。
- `TaskReporter` 和 Discord view reporter 的职责在文件名、类型和测试里都清楚。

## P1: Trace 已有结构化事实源，但缺用户可读出口

### 当前问题

`task_events` 已经能记录 task accepted、context captured、session/turn/tool/provider error、Discord delivery failure 和 final status。Auto Doctor 和 `/incident view` 也能读取部分 trace。

剩余缺口是用户视图：

- 没有 `/task-log` 或 `/task trace`。
- 没有 `task-<id>-trace.md` 导出。
- 长任务完成后，Discord 里仍主要依赖 tail summary 和 final message。
- trace retention、redaction、附件大小阈值还没有明确策略。

### 建议改动

1. 新增 `src/store/task-trace-export.ts`，从 `task_events` 生成用户可读 Markdown。
2. 新增 slash command：`/task-log id:<prefix>` 或 `/task trace id:<prefix>`。
3. 长任务按阈值自动附加 trace 文件，例如事件数、耗时或错误 severity 达到阈值才上传。
4. trace export 默认脱敏 provider payload，只保留 event type、severity、message、关键 ids、耗时和错误类型。
5. Auto Doctor 的 incident detail 链接到同一 trace exporter，避免 incident view 和 task-log 各自实现一套格式。

### 验收标准

- 任意最近 task 都能从 Discord 查询到可读 trace。
- provider/tool error 能在 trace 中定位到时间、provider、event type 和简短 message。
- trace 文件不会暴露完整 prompt、cookie、token、邮箱正文或账户原始数据。

## P1: Smart Router 需要评估闭环

### 当前问题

`smart_router_decisions` 已经记录 prompt hash、preview、capability JSON、classifier timing/error、`action_result` 和 `created_task_id`。这足够做单次 route debugging，但还不足以回答长期质量问题：

- 用户点击了“转为 task / 继续 chat / 取消”之后，选择没有被建模成独立 feedback 字段。
- router decision 和 created task 的 final status 没有形成固定 report。
- 没有 route correction 机制，比如用户在 chat 中纠正“这个应该走 task”。
- 没有 `/router-review` 或本地 report 来聚类 false positive / false negative / classifier failure。

### 建议改动

1. 在 `smart_router_decisions` 或关联表中记录 `user_choice`、`final_route`、`task_final_status`、`correction_type`。
2. 给 Smart Router button handler 补充 choice 更新，区分推荐、确认、用户选择和最终动作。
3. 新增 `scripts/router-review.ts` 或 `/router-review`，按 channel、route、classifier error type、task outcome 聚合。
4. 把高频真实 prompt 固化成 fixture，覆盖 current info、multi-step research、file/code change、runtime inspection 和普通解释。
5. 本地 deterministic policy 继续作为最终权限边界；LLM classifier 只提供 capability hint。

### 验收标准

- 能回答“某类 prompt 最近 7 天被误路由了多少次”。
- 能看到 classifier failure 是否真的导致用户体验下降。
- 能区分 classifier 判错、policy 拦截、用户选择变化和 task 执行失败。

## P1: Docs drift 需要进入质量门禁

### 当前问题

代码已经推进到 DB schema v8，本次复核也修正了 `docs/architecture.md` 的 schema version 和 Smart Router classifier 字段说明，并加入 `quality:docs` 第一层检查。剩余问题是 D1 仍只覆盖少数高价值 invariant，还没有根据 changed paths 判断哪些文档必须同步。

当前 docs 数量继续增长，feature docs、plans、architecture 和 bot-routing 之间容易重复描述同一事实。一旦 schema、route behavior、quality gate 或 provider contract 改动，只靠人工记忆同步会持续失效。

### 建议改动

1. 扩展 `quality:docs`，增加 changed-path 到 docs path 的轻量映射。
2. Smart Router action/result 字段变更时，要求同步 `docs/bot-routing.md` 或 feature doc。
3. provider contract 变更时，要求同步 provider framework 文档。
4. 对历史 plan 文档保持归档，不再让它们承担当前 source of truth。

### 验收标准

- 核心文档不会继续引用过期 schema version。
- 新增/修改 route、DB schema、provider contract 时，有自动检查或固定 review checklist。
- feature doc 中的 “待实现” 不再长期漂移成过期 backlog。

## P1: 复杂度热点需要拆分

### 当前问题

当前文件规模显示复杂度中心仍然集中，但 bot/task/doctor scheduler 已完成第一轮边界拆分，剩余热点应继续按职责推进：

- `src/store/db.ts`：930 行。
- `src/config.ts`：811 行。
- `src/ops/doctor-repair.ts`：775 行。
- `src/providers/market-intel/collectors/official.ts`：739 行，已把 source-specific parsing 拆到 `collectors/parsers/*`，collector orchestration 仍集中。
- `src/ops/doctor.ts`：734 行。
- `src/agent/task.ts`：367 行，已保留 task lifecycle orchestration，provider runners 和 Discord view reporter 已外置。
- `src/ops/doctor-scheduler.ts`：310 行，已保留 scan orchestration，grouping/notification/repair-policy/state 已外置。
- `src/bot.ts`：116 行，已保留 Discord event registration 和 route shell，message/interaction path 已外置。

这些不是单纯“行数太多”的问题，而是职责集中导致变更风险升高。AI agent 后续参与维护时，也更容易在错误层级修问题。

### 建议改动

`src/bot.ts` 拆成：

- `src/bot/message-thread-continuation.ts`
- `src/bot/message-task-channel.ts`
- `src/bot/message-chat.ts`
- `src/bot/message-smart-router.ts`
- `src/bot/button-dispatch.ts`
- `src/bot/slash-dispatch.ts`

`src/agent/task.ts` 拆成：

- task lifecycle registry。
- Claude/Codex/fake runners。
- `TaskViewEvent` normalization。
- Discord view reporting。
- DB persistence and recovery glue。

`src/ops/doctor-scheduler.ts` 拆成：

- scan loop。
- candidate grouping。
- notification formatting。
- auto repair trigger policy。
- scheduler state/update side effects。

`src/providers/market-intel/collectors/official.ts` 拆成：

- 已完成：source-specific parsers and fixtures（`collectors/parsers/shared.ts`、`macro.ts`、`filings.ts`、`risk.ts`）。
- 后续：macro/news/filings/risk collector orchestration 继续按 source family 拆分。
- 后续：format drift、staleness、redaction 继续在 parser fixture 层先复现，再改 network-facing collector。

### 验收标准

- 每个拆分后的文件都有单一职责和独立测试入口。
- 新增一个 provider、route 或 repair policy 时，不需要同时改多个 god module。
- 复杂路径的测试 fixture 可以直接定位到对应模块，而不是只能跑全量 task/bot tests。

## P1: 外部依赖抽象仍偏品牌分支

### 当前问题

当前配置和运行路径仍围绕 `AgentProvider = "claude" | "codex"` 展开。`src/agent/task.ts`、`src/agent/chat.ts`、`src/stage/*`、`src/routing/llm.ts` 等位置都直接依赖 `config.agentProvider`。

这说明 MiniClaw 已经支持多个 agent 后端，但抽象仍是品牌切换，不是能力契约。后续如果接 Hermes Agent、OpenClaw、Telegram、Slack、Teams 或普通 AI API，继续扩大品牌分支会失控。

### 建议改动

1. 把 `agentProvider` 逐步升级为 runtime 配置，例如 `runtime.default_agent`，值可以继续是 `claude` / `codex`。
2. 定义 `AgentRuntime`：长任务、workspace 权限、session、resume/cancel、tool events、trace。
3. 定义 `ModelClient`：短链路分类、总结、诊断和格式化，不拥有 workspace 写权限。
4. 定义 `IMTransport`：send/edit/thread/button/file/rate limit/permission。
5. 保持 `DataProvider` 独立，不把 WeChat、email、Futu、Eastmoney 这类数据采集误归到 AI provider。

### 验收标准

- 新增普通 LLM API 用于 router/doctor 时，不需要伪装成 coding agent runtime。
- 新增一个 Agent runtime 时，不需要改 Discord rendering。
- 新增一个 IM transport 时，不需要改 Claude/Codex runner。

## P1: DB migration 和 state lifecycle 需要治理

### 当前问题

`src/store/db.ts` 仍集中处理多张表创建、migration、schema version、task、chat history 和 Smart Router helper。随着 `task_events`、incidents、repair runs、market forecasts 继续增长，单文件 migration 会越来越难 review。

state lifecycle 也需要明确：

- `chat_history` 保留多久。
- `task_events` 保留多久。
- `smart_router_decisions` 是否保留 prompt preview。
- `incident_events`、`repair_runs` 和 market forecast evaluation 如何归档。
- 导出诊断 bundle 时哪些字段必须脱敏。

### 建议改动

1. 新增 `src/store/migrations/`，每个 schema version 一个 migration function。
2. 增加 `schema_version_history` 或 `schema_audit`，记录迁移执行时间和版本。
3. 把 `tasks`、`smart_router_decisions`、`incidents`、`task_events`、`market_forecasts` 拆成 repository module。
4. 增加 state retention 配置和清理命令。
5. 对 prompt preview、provider payload、email/account data 做明确 redaction policy。

### 验收标准

- 新 schema 变更不再需要在一个大函数里插入多段 SQL。
- migration 可以单测从旧版本升级。
- 长期运行后 DB 不会无限积累敏感 trace 和 prompt preview。

## P1: Config 需要 schema-first 拆分

### 当前问题

`src/config.ts` 仍集中处理：

- YAML/env loading。
- type coercion。
- validation。
- path resolution。
- E2E isolation guard。
- agent runtime config。
- doctor/connectivity config。
- Smart Router config。
- attachments/audio transcription config。

虽然项目已经依赖 `zod`，但主配置还没有形成 schema-first 分层。继续添加 provider、runtime、transport 和 doctor 配置会让 review 成本继续升高。

### 建议改动

1. 新增 `src/config/load.ts`：只负责 YAML/env/source loading。
2. 新增 `src/config/schema.ts`：集中 Zod schema 或 typed validators。
3. 新增 `src/config/resolve.ts`：统一 home path、default 和 inherit resolution。
4. 新增 `src/config/runtime.ts`：输出最终 readonly config object。
5. 新配置先进入 schema，再进入 runtime config，不再直接追加到单一 `config.ts`。

### 验收标准

- 新增配置字段时有 schema、默认值、env key 和测试。
- E2E guard 能独立测试，不依赖全量 config import side effect。
- provider/doctor/runtime 配置可以分文件 review。

## P1: Provider Framework 还不是统一 SDK

### 当前问题

`PreProviderResult` 能满足当前 cron/report 需求，但 provider framework 仍偏薄。现在各 provider 已经各自具备 config、collector、format、redaction、health-like 能力的一部分，但没有统一 manifest、health check、dry-run、structured output 和 replay fixture 协议。

继续按单个 provider 增量扩展会带来这些问题：

- cron 失败很难稳定区分 auth、data absence、network、format drift 和 provider bug。
- Auto Doctor 难以判断 provider failure 是否可修。
- 新 provider 接入缺少固定测试模板。
- zero-touch 报告失败后，用户看到的诊断不够可执行。

### 建议改动

定义 provider manifest：

```ts
interface ProviderManifest {
  name: string;
  kind: "email" | "stock" | "wechat" | "web" | "custom";
  privacy: "public" | "private" | "sensitive";
  sideEffects: "none" | "state_commit_after_success";
  supportsDryRun: boolean;
  supportsHealthCheck: boolean;
  outputSchemaVersion: string;
}
```

每个 provider 应提供：

- `healthCheck()`：只检查配置、secret、登录态、网络，不触发下游 LLM task。
- `dryRun()`：采样结构化输出，默认脱敏。
- `run()`：生成结构化结果。
- `format()`：从结构化结果生成 prompt block。
- `commit()`：只在下游 LLM task 成功后更新 dedupe state。
- `fixtures/`：覆盖 replay、format drift 和 redaction。

### 验收标准

- provider failure 可以稳定归类为 auth、network、data absence、format drift、provider bug。
- 新 provider 接入有固定目录和测试模板。
- cron/report pipeline 能在不跑 LLM 的情况下做 provider health preflight。

## P2: Auto Doctor 和 Incident Center 需要从告警走向运维入口

### 当前问题

`/incident view`、repair run、ship preview、approve ship 和 safe restart 相关路径已经存在，但仍缺一个更完整的 incident center 体验：

- incident search/filter 还不够强。
- incident 和 task/cron/trace/log/repair run 的链接还不够连续。
- repair branch review report 还不够像一个可审查变更包。
- promotion blockers、rollback command、post-ship monitoring 还没有形成统一视图。

### 建议改动

1. 强化 `/incident view`：展示 task trace link、cron run、repair run、ship preview、restart status。
2. 增加 incident search/filter：按 type、category、route、provider、repair status、severity 聚合。
3. 增加 repair branch review report：diff 摘要、changed paths、验证命令、测试输出、风险和回滚命令。
4. 保持主进程 read-only diagnosis；repair worker 只在 isolated worktree 写代码。
5. main merge、live restart、credential refresh 继续需要显式审批或强约束。

### 验收标准

- 用户能从一个 incident id 追到原始 task、trace、repair run、验证结果和 ship decision。
- 可修复 bug 能生成可 review、可验证、可 revert 的 repair proposal。
- Auto Doctor 不会自动修改 live main worktree 或未经确认重启生产进程。

## P2: Cron 运行历史和 per-job 控制需要增强

### 当前问题

cron 当前支持 task/script/skill/message、pre_script、pre_provider、retry button 和 skipTask。下一步问题不再是能不能跑，而是长期运行时能不能诊断和治理：

- cron run history 仍主要依赖 state/log/task，而不是一张可查询的 run table。
- job-level timeout 只覆盖 pre_script 等局部，不是完整 task run SLA。
- job-level max concurrency、backoff、cooldown 和 circuit breaker 还不够系统化。
- provider health preflight 还没有成为统一入口。

### 建议改动

1. 新增 `cron_runs` 表或等价 repository，记录每次 job run 的 status、duration、attempt、task_id、incident_id、provider summary。
2. 增加 job-level timeout 和 max concurrency。
3. 增加 retry/backoff/cooldown 配置。
4. pre_provider 先走 provider health/dry-run，再决定是否触发 LLM task。
5. cron failure 通知链接到 run detail、task trace 和 incident detail。

### 验收标准

- 任意 cron job 能回答最近 N 次运行成功率、失败分类和平均耗时。
- provider auth/session 问题不会反复触发无意义 LLM task。
- cron failure 能自动给出下一步诊断入口，而不是只给一条错误文本。

## P3: Stage 子系统保持实验边界

### 当前问题

Stage CLI 有独立 persona、orchestrator、TUI 和 smoke/e2e，但它和 Discord bot 主路线不是同一个产品面。若继续和主 runtime 深度耦合，会让 MiniClaw 同时维护两个入口和两套 UX。

### 建议改动

1. 明确 Stage 是 experimental playground，主要服务 persona/multi-agent workflow 研究。
2. Stage 可复用 AgentRuntime 和 ModelClient，但不要反向牵动 Discord task runtime。
3. 如果 Stage 要成为核心能力，再补 docs index、quality gates、runtime health 和 usage accounting。

### 验收标准

- Stage 改动不会阻塞 Discord bot 的核心运行质量。
- 多 agent 只在复杂 research/design/review/coding 场景启用，不成为默认路径。

## 推荐路线图

### 近期

目标：降低 `task.ts` / `bot.ts` 的运行风险，并把 D1 docs drift 从少数 invariant 扩展到 changed-path 语义检查。

1. 定义 `TaskViewEvent`。
2. 新增 Discord view reporter。
3. 保留 SQLite `TaskReporter` 作为 observability reporter。
4. 新增 trace export 的最小 CLI 或 slash command。
5. 扩展 `quality:docs` 的 changed-path 映射。

### 30 天

目标：让 task 和 router 都能被复盘。

1. `/task-log` 或 `/task trace` 可用。
2. 长任务按阈值自动附 trace/result 文件。
3. Smart Router 记录 user choice、final route、task outcome。
4. 新增 router review report。
5. incident detail 复用同一 trace exporter。

### 60 天

目标：把 provider 和 state 治理从约定变成框架。

1. 写 `docs/features/15-provider-framework.md`。
2. 改造 1 个 provider 作为 manifest + health + dry-run + replay fixture 样板。
3. 建立 `src/store/migrations/`。
4. 拆分 `src/config.ts` 的 load/schema/resolve/runtime。
5. 增加 state retention 和 redaction policy。

### 90 天

目标：把 Auto Doctor 变成可审查的运行态控制面。

1. 强化 `/incident view` 和 incident search/filter。
2. repair branch review report 标准化。
3. promotion blockers、rollback command、post-ship monitoring 进入同一视图。
4. 继续保持 main merge 和 live restart 的显式审批边界。

## 不建议投入的方向

### 不做通用 Agent 平台

MiniClaw 应围绕个人自动化、私有数据入口、Discord-native delivery、runtime switching 和运行态治理。支持多个 Agent runtime 和多个 IM transport 是为了降低耦合，不是为了和 OpenClaw、Hermes、Claude Code、Codex 做通用平台竞争。

### 不默认多 agent 化

多 agent 的价值在复杂任务协议、handoff artifacts 和质量门禁，不在 agent 数量。默认路径应保持单 agent，只有复杂 design、review、long research 和 coding task 再引入角色化分工。

### 不急着上 Web dashboard

当前最重要的 UX 仍在 Discord。只有 incident board、provider health board、跨任务搜索和长期指标需要更强可视化时，Web dashboard 才值得投入。

### 不自动修改 live main worktree

Self-repair 应保持 branch proposal 模式。自动改 main、自动 push main、自动重启 live runtime 都应长期保持高门槛。

## 验收门禁

核心命令：

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm test`
- 涉及 runtime 输出或 build artifact 时加跑 `pnpm run build`
- 涉及 cron 时加跑 `pnpm run e2e:cron`
- 涉及质量门禁时加跑 `pnpm run quality:commit` 或对应 scoped gate

文档验收：

- 改动后的 report 只列剩余提升项，不再维护正向评价清单。
- 新增或修改 feature/source-of-truth 文档时同步 `docs/README.md`。
- schema、route、provider contract、quality gate 变更必须有对应 docs drift 检查或明确 review checklist。

运行态验收：

- 新 task 可在 Discord 中看到清晰状态。
- 出错 task 可通过 trace 定位 provider/tool/Discord delivery failure。
- Smart Router 可通过 report 解释 route decision 和后续 outcome。
- Auto Doctor incident 可追到 task、trace、repair run 和 ship/restart decision。
