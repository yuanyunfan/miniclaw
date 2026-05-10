# MiniClaw 深度解析与持续优化报告

日期：2026-05-10

## TLDR

MiniClaw 现在已经不是一个简单的 Discord bot，而是一个面向单用户的 personal AI operations hub。它的核心价值不在于替代 Claude Code、Codex、OpenClaw 或 Hermes，而在于把这些 runtime 变成可切换后端，并在本机掌握 Discord 入口、私有数据 provider、cron、task state、记忆、诊断、重启安全和质量门禁。

后续把 Claude Code / Codex / 第三方 Agent、普通 AI API、Discord / 其他 IM 抽象出来是合理的，而且应该做。但抽象边界要分成三层：`AgentRuntime`、`ModelClient`、`IMTransport`。不要把它们都塞进一个泛化的 `provider`，因为它们的权限、状态、成本、流式事件和故障模式完全不同。

未来最值得持续投入的是运行系统能力：provider framework、task event/reporting、incident center、Smart Router 评估闭环、Auto Doctor 的受控修复链路，以及围绕私有数据的 zero-touch 自动化。最不值得投入的是复刻通用 coding agent、把所有任务强行多 agent 化、或者让主进程自动修改并重启自己。

当前仓库的基础很强：测试密度高，质量门禁完整，runtime 边界逐步清晰。但复杂度中心已经很明显，尤其是 `src/agent/task.ts`、`src/bot.ts`、`src/config.ts`、`src/store/db.ts` 和 `src/ops/*`。下一阶段应优先做边界拆分和运行态可观测性，而不是继续堆 feature。

## 分析范围与当前基线

本报告基于当前工作区快照进行静态代码审计、文档审计和基础验证。当前分支为 `main`，remote 指向个人仓库 `git@github-personal:yuanyunfan/miniclaw.git`。

工作区在分析时已有未提交改动，主要集中在 Auto Doctor、Smart Router capability classifier、config、ops repair 相关文件。本报告没有修改这些代码改动，只新增本分析文档和 docs 索引。

代码规模：

- production TypeScript 文件：143 个，约 22079 行。
- test 文件：97 个，约 9813 行。
- docs Markdown 文件：33 个。
- 最大复杂度中心：`src/agent/task.ts` 859 行、`src/bot.ts` 780 行、`src/ops/doctor-repair.ts` 705 行、`src/config.ts` 689 行、`src/ops/doctor.ts` 647 行、`src/store/db.ts` 607 行。

验证基线：

- `pnpm run typecheck`：通过。
- `pnpm run lint`：通过。
- `pnpm test`：通过，97 个 test files、485 个 tests passed。

## 当前系统画像

### 1. 产品定位

MiniClaw 的 README 对定位已经非常准确：

- Discord 是入口和交付层。
- Claude Code / Codex 是可切换执行引擎。
- 用户配置、cron、provider state 和 secrets 放在 `~/.miniclaw/`。
- 微信公众号、邮件、信用卡、股票账户等数据先由只读 provider 结构化采集，再交给 LLM 总结。
- 敏感能力默认只读、脱敏、不写入 Git。

这个定位是正确的。MiniClaw 不应该发展成“另一个 OpenClaw”或“另一个 Hermes”，而应该成为用户自己的 AI automation control plane。

### 2. 运行链路

当前主要入口包括：

- Discord `MessageCreate`：thread continuation、task channel、auto-reply chat、Smart Router。
- Discord `InteractionCreate`：cron retry button、Smart Router button、slash commands。
- Slash commands：`/task`、`/status`、`/health`、`/doctor`、`/incidents`、`/agent-config`、`/cancel`、`/resume`、memory commands。
- cron scheduler：从 `~/.miniclaw/cron/*.yaml` 加载 job，支持 `task`、`script`、`skill`、`message`。
- Stage CLI：独立 Ink/TUI 多 agent 控制台。

核心执行路径：

- chat 路径：`src/bot.ts` -> `src/agent/chat.ts` -> Claude messages stream 或 Codex read-only thread。
- task 路径：`src/commands/handlers.ts` / `src/discord/task-intake.ts` / `src/bot.ts` -> `src/agent/task.ts` -> Claude Agent SDK 或 Codex SDK。
- cron task 路径：`src/cron/scheduler.ts` -> `src/cron/runner-task.ts` -> pre_script / pre_provider -> `executeTask(outputMode=raw)`。
- runtime ops 路径：connectivity monitor、Auto Doctor、incident DB、safe restart、repair worker。

### 3. 数据与状态

MiniClaw 当前有三类状态：

- SQLite：tasks、chat_history、scenes、scene_messages、smart_router_decisions、incidents、incident_events、repair_runs。
- Markdown memory：`~/.miniclaw/memories/MEMORY.md`。
- JSON/YAML runtime state：`~/.miniclaw/cron/state.json`、provider state、config、connectivity state。

这个结构符合 local-first。真正要加强的是 state lifecycle：保留多久、如何清理、如何导出诊断 bundle、如何避免敏感 prompt 和 provider 原始数据长期沉积。

### 4. 抽象边界

MiniClaw 确实应该减少对 Claude Code、Codex 和 Discord 的直接绑定。原因不是为了做成通用平台，而是为了避免未来每接一个 Agent 或 IM 都要改核心 task、cron、doctor、routing 和 store 逻辑。

建议把外部依赖拆成四类：

- `AgentRuntime`：Claude Code、Codex、Hermes Agent、OpenClaw 或未来其他可执行任务的 agent。它的特点是长任务、可写工作区、可 resume/cancel、有工具调用、有会话 id、有 token/cost/trace。
- `ModelClient`：OpenAI API、Anthropic API、本地 LLM、router LLM 等普通 AI API。它的特点是轻量、短链路、适合分类/总结/诊断/格式化，不应该默认拥有工作区写权限。
- `IMTransport`：Discord、Telegram、Slack、飞书、Teams、邮件 thread 等交互入口。它的特点是 message、thread、reply、edit、button、attachment、permission、rate limit 和 user identity。
- `DataProvider`：WeChat、email、Futu、Eastmoney、stock portfolio 等私有或公开数据源。它不等于 AI provider，主要职责是采集、脱敏、结构化和 dedupe state。

这四层不要混在一起。尤其是 `AgentRuntime` 和 `ModelClient` 必须分开：Codex/Claude Code 这种 coding agent 是“执行器”，OpenAI/Anthropic API 是“模型能力”。前者可以改文件、调用工具、跨轮恢复；后者更适合 Smart Router、Auto Doctor classifier、report summarizer 和 cheap fallback。

目标抽象可以是：

```ts
interface AgentRuntime {
  id: string;
  capabilities: AgentRuntimeCapabilities;
  runTask(request: AgentTaskRequest, sink: AgentEventSink): Promise<AgentTaskResult>;
  continueTask?(request: AgentContinueRequest, sink: AgentEventSink): Promise<AgentTaskResult>;
  cancel?(taskId: string): Promise<void>;
  validateSession?(sessionId: string): boolean;
}

interface ModelClient {
  id: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
  stream?(request: ModelRequest): AsyncIterable<ModelEvent>;
}

interface IMTransport {
  id: string;
  sendMessage(target: MessageTarget, message: OutboundMessage): Promise<MessageRef>;
  editMessage(ref: MessageRef, message: OutboundMessage): Promise<void>;
  createThread?(source: MessageRef, title: string): Promise<MessageTarget>;
  sendFile?(target: MessageTarget, file: OutboundFile): Promise<MessageRef>;
}
```

接口里应该表达 MiniClaw 真正需要的能力，而不是表达某个 SDK 的对象模型。比如 Discord 有 thread 和 button，但 Telegram/Slack 未必完全一致；所以核心层应该使用 `MessageTarget`、`MessageRef`、`ActionRef`、`AttachmentRef` 这类中性对象，再由 adapter 做降级或映射。

合理的目录方向：

- `src/runtime/agent-runtime.ts`：Agent runtime contract。
- `src/runtime/model-client.ts`：普通 AI API contract。
- `src/im/transport.ts`：IM transport contract。
- `src/adapters/agent-codex/*`：Codex adapter。
- `src/adapters/agent-claude/*`：Claude adapter。
- `src/adapters/im-discord/*`：Discord adapter。
- `src/adapters/model-openai/*`、`src/adapters/model-anthropic/*`：普通 model API adapter。

短期不要一次性重写。更稳的迁移顺序是：先抽 `TaskViewEvent`，再让 Claude/Codex runner 产出统一事件，然后让 Discord reporter 消费这些事件。等 task event/reporting 稳定后，再把 Discord message/thread 操作下沉到 `IMTransport`。

## 已经做得好的地方

### Discord-native workflow 是真实优势

MiniClaw 的 task thread、progress message、final Markdown 分片、cron 失败按钮、incident notification 都很贴合 Discord。这个方向比做一个新 Web dashboard 更符合当前使用场景。

建议继续把 Discord 当成 primary UX。Web/dashboard 可以后置，优先保证 Discord 里的状态、回溯、retry、resume、诊断都好用。

### chat 和 task 的权限边界清晰

当前设计坚持：

- chat：轻量、只读、短链路。
- task：可写、有状态、可 resume、可观测。

Smart Router 的价值是降低用户选择成本，而不是抹掉边界。这个判断非常重要，应继续保持。

### provider-driven reports 是长期护城河

`pre_provider` + `PreProviderResult` 的抽象已经抓住了 MiniClaw 的核心方向：先结构化采集，再让 LLM 做总结。当前已有 WeChat、email、CMB credit card、Futu、Eastmoney、stock portfolio、stock pulse 等 provider，这比单纯 chat bot 更有长期价值。

下一阶段不应只增加更多 provider，而应提升 provider 框架本身。

### 运行态安全意识已经成体系

当前已经有：

- graceful shutdown drain。
- `safe-restart` 拒绝有 running task 时重启。
- interrupted task 持久化和 startup recovery。
- connectivity monitor + Email fallback。
- Auto Doctor read-only diagnosis。
- repair worker 使用 isolated worktree。

这说明 MiniClaw 正在从“能跑”走向“能长期值守”。这条线应继续加强。

### 质量门禁强于一般个人项目

已有质量基础包括：

- `pnpm run typecheck`、`lint`、`test`、`build`。
- G0 safety check。
- secret scan。
- dependency scan。
- coverage ratchet。
- cron E2E fixture。
- Discord E2E workflow。
- fake agent runtime。

这对 AI 参与维护的项目尤其重要。持续优化时不要绕过这些 gate。

## 主要问题与风险

### P0: 当前 Smart Router/DB WIP 需要收敛成原子变更

当前工作区仍有多处未提交改动，集中在 Smart Router capability classifier、router eval fixture/tests、DB schema、`bot.ts` 和对应文档。这些改动已经通过 `typecheck/lint/test`，但还没有形成清晰的提交边界。

建议：

1. 先确认 Smart Router capability classifier、router eval、DB schema 和 docs 是否属于同一个独立改动。
2. 如果其中混有不相关行为，拆成多个原子 commit。
3. 保留当前已通过的验证基线：`pnpm run typecheck`、`pnpm run lint`、`pnpm test`。
4. 如果 schema 或 routing 行为继续变化，同步 `docs/bot-routing.md` 和 Smart Router feature 文档。

### P1: 复杂度中心开始接近 god module

`task.ts` 同时负责：

- active task registry。
- cancellation/interruption/drain。
- Codex SDK event consumption。
- Claude Agent SDK event consumption。
- tool display formatting。
- progress rendering。
- DB update。
- final result sending。
- attachment cleanup。

`bot.ts` 同时负责：

- Discord client construction。
- route resolution。
- Smart Router confirmation UI。
- task auto creation。
- thread continuation。
- attachment processing。
- chat progress display。
- button dispatch。
- slash command switch。

这些模块现在还能维护，但继续增长会产生两个问题：

- 任何改动都容易误伤多个运行路径。
- AI agent 后续改代码时容易在错误层级修问题。

建议优先拆：

- `src/agent/task-events.ts`：统一 `TaskViewEvent`。
- `src/discord/task-reporter.ts`：Discord status/progress/final output。
- `src/agent/provider-runner-codex.ts` 和 `src/agent/provider-runner-claude.ts`：只负责 SDK -> TaskViewEvent。
- `src/bot/message-handlers/*`：thread continuation、task channel、chat path、smart router path 分文件。

### P1: 外部依赖抽象还停留在品牌分支

当前 `src/config.ts` 里的 `AgentProvider = "claude" | "codex"`、`src/agent/task.ts` 里的 Claude/Codex 分支、`src/bot.ts` 里的 Discord client wiring，说明系统已经支持多个后端，但抽象还偏“品牌切换”，不是“能力契约”。

这个阶段还能接受，因为目前只有 Claude/Codex + Discord。但如果后续接入 Hermes Agent、OpenClaw、Telegram、Slack、Teams 或普通 AI API，继续用品牌分支会很快失控。

建议：

1. 把 `agentProvider` 逐步升级为 `runtime.default_agent`，值可以仍然是 `claude` / `codex`，但核心代码依赖 `AgentRuntime` contract。
2. 把 Smart Router、Auto Doctor diagnosis、report summarizer 使用的 LLM 抽成 `ModelClient`，不要复用 coding agent runtime。
3. 把 Discord send/edit/thread/button/file 操作集中到 `DiscordTransport`，核心 task 只面对 `IMTransport`。
4. adapter 要声明 capability，而不是让核心层猜。例如 `supportsResume`、`supportsFiles`、`supportsThreads`、`supportsButtons`、`supportsToolEvents`、`maxMessageLength`。
5. 不要强求所有 transport 支持 Discord 的完整体验。核心层给出理想事件和动作，adapter 负责 best-effort degrade。

这类抽象的价值很高，但要跟着现有痛点推进。第一刀仍然应该落在 `TaskViewEvent + TaskReporter`，因为它天然就是 `AgentRuntime` 和 `IMTransport` 之间的边界。

### P1: config 已经过于集中

`src/config.ts` 现在承载 YAML loading、env parsing、validation、path resolution、E2E guard、doctor config、connectivity config、codex/claude config、smart router config。继续扩展会让新配置很难 review。

建议拆成：

- `src/config/load.ts`：YAML/env loading。
- `src/config/schema.ts`：Zod 或 typed validators。
- `src/config/resolve.ts`：home path、default、inherit resolution。
- `src/config/runtime.ts`：最终 `config` 对象。
- `src/config/e2e-guards.ts`：E2E path isolation。

Zod 已经是依赖，可以逐步用于新配置，不必一次性重写所有字段。

### P1: DB schema 和 store API 需要进入 migration discipline

`src/store/db.ts` 已经包含多张表和 4 个 schema version。继续增长后，把 migration 写在一个大函数里会变得难审。

建议：

- 建立 `src/store/migrations/`。
- 每个 version 一个 migration function。
- 新增 `schema_audit` 或 `schema_version_history` 记录迁移执行时间。
- 给 `tasks`、`incidents`、`repair_runs` 分离 repository module。
- 为 state retention 增加清理策略：chat_history、smart_router_decisions、incident_events、old repair_runs。

### P1: task trace 还没有成为一等公民

当前 Discord progress 只保留 tail lines，DB 只保存 result summary。长任务完成后，用户能看到摘要，但无法完整复盘 agent 到底做了什么。

建议：

- 引入 normalized task trace。
- 写入 SQLite 或 `~/.miniclaw/tasks/<task-id>/trace.jsonl`。
- Discord 主消息继续只展示 tail summary。
- 长任务完成后按阈值上传 `task-<id>-trace.md` 或提供 `/task-log <id>`。
- Auto Doctor 应优先读取 normalized trace，而不是只 tail pm2 log。

### P1: provider contract 还太薄

当前 `PreProviderResult` 只有 `text`、`skipTask`、`commit`。这已经能工作，但随着 provider 变多，会缺少统一治理能力。

建议把 provider 升级为 manifest-driven：

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

每个 provider 应有固定能力：

- `healthCheck()`：检查配置、secret、登录态、网络，不执行下游 task。
- `dryRun()`：采样输出，默认脱敏。
- `run()`：生成结构化结果。
- `format()`：从结构化结果到 prompt block。
- `commit()`：仅在下游 LLM task 成功后更新 dedupe state。

这样 cron/report pipeline 会更可诊断，也更适合 Auto Doctor 判断 provider auth、provider data、network、third_party。

### P2: Smart Router 需要评估闭环，而不只是 classifier

当前 Smart Router 正在从 intent classifier 转向 capability classifier，这是对的。更长期的问题不是 classifier prompt 怎么写，而是如何知道它是否判对。

建议：

- 扩展 `smart_router_decisions`：记录 final action、user button choice、task success/fail、route correction。
- 增加 `/router-review` 或本地 report：按 false positive / false negative 聚类。
- 对固定高频 prompt 建 snapshot fixtures。
- 对 channel policy 做显式配置：哪些频道允许 auto task，哪些只允许 confirm，哪些永远 chat。
- LLM classifier 只能做 capability hint，最终权限决策必须由本地 deterministic policy 做。

### P2: Auto Doctor 要保持“修复分支优先”，不要太快进 main

Auto Doctor 已经进入 repair branch commit 阶段，这是很有价值的方向，但它也是风险最高的方向。

建议保持以下硬边界：

- 主进程只做 diagnosis，不直接改 live main worktree。
- repair worker 只在 isolated worktree 修改。
- auto commit 只提交 repair branch。
- auto push 初期只 push repair branch。
- main merge、live restart、credential refresh 永远需要显式操作或强约束。
- provider auth、network、Discord outage、third-party failure 不进入 auto repair。

最终目标不是“MiniClaw 自己随便修自己”，而是“MiniClaw 自动准备一个可 review、可验证、可 revert 的 repair proposal”。

### P2: Stage 子系统需要明确是核心还是实验场

Stage 是有价值的，但它和 Discord bot 的主路线不同。当前它共享 DB、config、chat-tools，也有独立 persona/orchestrator/TUI。长期需要明确：

- 如果 Stage 是实验场：不要让它牵动主 runtime 架构。
- 如果 Stage 是核心能力：要纳入 docs index、quality gates、runtime health、usage accounting。

当前建议把 Stage 定为 experimental playground，主要用于 persona/multi-agent workflow 研究，不要让它成为 MiniClaw 必须维护的第二产品面。

## 推荐路线图

### 近期：稳定当前主干

目标：恢复可提交、可部署的稳定基线。

建议任务：

1. 明确当前 Smart Router/DB/docs WIP 是一个还是多个原子改动。
2. 若继续修改 router schema 或 decision log，补齐 migration 和 docs drift。
3. 保持 `pnpm run typecheck && pnpm run lint && pnpm test` 全绿。
4. 必要时跑 `pnpm run build` 和 `pnpm run e2e:cron`。
5. 更新对应 docs：Smart Router、bot routing、quality gates。

完成标准：

- 本地 G1/L1 全绿。
- 当前 WIP 不再混杂多个独立主题。
- `docs/README.md` 能找到最新设计文档。

### 30 天：Task Reporter 和 Trace 一等化

目标：降低 `task.ts` 复杂度，并让长任务可审计；同时建立 `AgentRuntime` 和 `IMTransport` 之间的第一条稳定边界。

建议任务：

1. 定义 `TaskViewEvent`。
2. 拆出 `TaskReporter`。
3. Codex/Claude runner 只产出 normalized events，不直接关心 Discord 输出。
4. Discord reporter 只消费 `TaskViewEvent`，不直接关心 Claude/Codex SDK event。
5. 完整 trace 写入 JSONL。
6. Discord 完成消息可附 trace/result 文件。
7. Auto Doctor 读取 task trace 做诊断。

完成标准：

- `src/agent/task.ts` 明显变薄。
- provider SDK event schema 改动时，只影响 runner adapter。
- 任何 task 都能定位到完整 trace。
- 新 Agent runtime 接入时，不需要改 Discord reporter。

### 60 天：Provider Framework 2.0

目标：把 provider 从“能用的脚本集合”提升为可靠数据层。

建议任务：

1. 增加 provider manifest。
2. 增加 provider health check。
3. 增加 provider dry-run CLI。
4. 标准化 provider structured output。
5. 标准化 redaction 和 privacy level。
6. 增加 provider replay fixture。

完成标准：

- cron 失败能区分 auth、data absence、network、format drift。
- 新 provider 接入需要遵循统一接口和测试模板。
- zero-touch 报告任务失败后可以自动给出可执行诊断。

### 90 天：Incident Center 和受控自修复

目标：让 MiniClaw 成为自己的值守系统，但不越过安全边界。

建议任务：

1. 增加 `/incident <id>` 详情。
2. 增加 incident -> task/cron/log/trace 的链接。
3. 增加 repair branch review report。
4. repair worker 自动生成 patch + verification report。
5. auto push 只推 repair branch。
6. main merge 和 live restart 保持人工确认。

完成标准：

- 失败出现后，用户不需要手动问“为什么失败”，MiniClaw 主动给 diagnosis。
- 可修复 bug 自动形成 repair proposal。
- 修复链路有 diff、测试、commit SHA、风险和回滚信息。

## 按模块的具体优化建议

### `src/runtime/*` 和 `src/adapters/*`

建议新增 runtime / adapter 分层，但采用渐进迁移：

- 先定义 `AgentRuntime`、`ModelClient`、`IMTransport` 的最小接口。
- 先把 Claude/Codex task runner 包成 `AgentRuntime` adapter。
- 再把 Discord progress/final/thread 操作包成 `DiscordTransport`。
- 最后再把 Smart Router / Auto Doctor 的 LLM 调用迁到 `ModelClient`。

不要一开始就做插件系统、marketplace、动态加载、复杂 adapter registry。MiniClaw 当前需要的是可替换边界，不是生态平台。

### `src/bot.ts`

建议拆分：

- `message-thread-continuation.ts`
- `message-task-channel.ts`
- `message-chat.ts`
- `smart-router-buttons.ts`
- `slash-dispatch.ts`

目标是让 `bot.ts` 只负责 Discord client wiring 和事件分发，不再承载业务逻辑。

### `src/agent/task.ts`

建议拆分：

- task lifecycle：active/cancel/interrupted/drain。
- provider runners：Claude / Codex。
- task event normalization。
- Discord reporting。
- final DB persistence。

这会显著降低未来支持 Hermes/OpenClaw/acpx adapter 的成本。

### `src/config.ts`

建议逐步引入 schema-first 配置。不要一次性重写，但新配置尤其是 `doctor`、`providers`、`routing` 应先有 schema，再进入 `config`。

### `src/store/db.ts`

建议迁移到 versioned migrations。`tasks`、`incidents`、`smart_router_decisions` 应各自有 repository module，避免一个 store 文件无限增长。

### `src/cron/*`

建议增强：

- job-level timeout。
- job-level max concurrency。
- last successful output pointer。
- retry policy 可配置。
- provider health preflight。
- cron run history 表，替代或补充 JSON state。

### `src/providers/*`

建议建立 provider SDK template：

- `config.ts`
- `types.ts`
- `collector.ts`
- `format.ts`
- `redaction.ts`
- `health.ts`
- `__tests__/fixtures`

每个 provider 都应能回答三个问题：配置是否健康、今天有没有新数据、输出是否已经脱敏。

### `src/ops/*`

建议把 Auto Doctor 拆成四层：

- evidence collectors。
- diagnosis classifier。
- incident persistence。
- repair worker。

现在这些边界已经开始出现，但还可以进一步减少耦合。尤其是 repair worker 的 policy、workspace、agent、verification、commit 应继续拆分，便于审计。

### `docs/*`

docs 已经很多，下一步重点不是继续增加散文档，而是保持索引、状态和代码一致：

- 每个顶层系统只保留一个 source of truth。
- 已完成 plan 要清楚标注 status。
- feature 文档里的 “待实现” 要定期复核，避免变成过期 backlog。
- D1 docs drift check 应从文档规则进入实际 gate。

## 不建议投入的方向

### 不要做通用 Agent 平台

OpenClaw、Hermes、Claude Code、Codex 会持续快速演进。MiniClaw 不应该在通用 multi-agent runtime 上和它们竞争。

MiniClaw 应该做的是：

- 私有数据入口。
- 本地自动化。
- Discord-native delivery。
- runtime switching。
- 个人 workflow state。

这不等于不要抽象。正确方向是“可替换 adapter”，不是“通用 agent 平台”。MiniClaw 可以支持多个 Agent runtime 和多个 IM transport，但核心仍然围绕个人自动化、私有数据和运行态治理，而不是面向第三方开发者提供一套完整平台。

### 不要把所有任务都多 agent 化

多 agent 的价值在协议、handoff artifacts 和质量门禁，不在 agent 数量。对 MiniClaw 来说，默认单 agent + 必要时 delegated subtask 更稳。只有设计、评审、长期 research、复杂 coding 才值得启用多角色。

### 不要急着上 Web dashboard

当前最重要的 UX 在 Discord。Web dashboard 只有在需要跨任务搜索、incident board、provider health board 时才值得做。否则会分散维护精力。

### 不要自动修改 live main worktree

Self-repair 可以做，但必须是 branch proposal。自动改 main、自动重启 live runtime、自动 push main 都应该长期保持高门槛。

## 成功指标

运行可靠性：

- Discord silent failure 次数下降。
- interrupted task 数量下降。
- cron failure 自动诊断覆盖率上升。
- safe restart 被使用，而不是手动 PM2 restart。

自动化价值：

- 每日/每周报告 zero-touch 成功率。
- provider `skipTask` 和 failure 的分类准确率。
- 私有数据任务中人工导出需求为 0。

工程质量：

- `typecheck/lint/test/build` 长期保持绿。
- coverage ratchet 按模块稳步提高。
- L3 Discord fake E2E 定期运行。
- docs drift 被 gate 或 review 明确捕获。

AI self-improvement：

- incident -> repair proposal 的平均耗时。
- repair proposal verification 通过率。
- 被拒绝的 auto repair 原因可审计。
- 无未经确认的 main push / live restart。

## 建议的下一步

最务实的下一步不是继续加新 provider，而是先稳定当前主干：

1. 把当前 Smart Router/DB/docs WIP 收敛成可验证的原子 commit。
2. 如果 Auto Doctor/repair branch 继续推进，保持它和 routing 变更分离。
3. 设计并实现 `TaskViewEvent` + `TaskReporter`，开始降低 `task.ts` 复杂度。
4. 为 provider framework 写一份 `docs/features/14-provider-framework.md`，再按这个协议改造 1 个 provider 作为样板。
5. 增加 `/incident <id>` 详情视图，让 Auto Doctor 的数据真正变成运维入口。

如果只能选一个方向，我建议优先做 `TaskReporter + trace`。它会直接改善 task 可观测性、Auto Doctor 诊断质量、Discord UX、provider failure analysis，也能降低最核心模块的维护风险。
