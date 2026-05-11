# MiniClaw 测试与质量门禁方案

> 结论：MiniClaw 采用 `G0/G1/G2 + L1/L2/L3/L4 + D1` 的分层体系。`L*` 负责验证行为，`G*` 负责阻止坏改动进入 commit/push/CI，`D1` 负责阻止架构文档漂移。真实 Discord E2E 已有 harness 和 workflow，但日常 gate 默认只跑 deterministic fake/fixture；真实 Claude/Codex 仍只放在 manual/nightly。

## 背景

MiniClaw 不是普通 TypeScript library。它同时包含：

- Discord Gateway / slash command / message routing / thread continuation
- Claude 与 Codex provider
- cron scheduler / retry / provider pre-context
- SQLite task、chat history、scene state
- 本机 `~/.miniclaw/` 用户配置、secrets、memory、scripts、providers
- 长期运行进程和 PM2 日志

所以测试体系不能只看 coverage，也不能把真实 Discord、真实 LLM、真实 cron 全塞进每次 commit。正确策略是分层：越靠近 commit 越快、越确定；越接近真实生产链路越慢、越隔离、越适合 manual/nightly。

## 当前基线

当前已经具备的基础：

- `package.json` 已有 `build`、`lint`、`typecheck`、`test`、`test:cov`、`quality:commit`、`quality:push`、`quality:g0`、`quality:secrets`、`quality:deps`、`quality:coverage`、`e2e:cron` 和 `e2e:discord`。
- `scripts/git-hooks/pre-commit` 调用 `pnpm run quality:commit`；实际顺序是 staged G0、staged secret scan、lint、typecheck、Vitest。
- `scripts/git-hooks/pre-push` 调用 `pnpm run quality:push`；实际顺序是 build、coverage、coverage ratchet、lint、cron E2E、full-tree G0、full-tree secret scan、dependency scan，并可用 `MINICLAW_RUN_DISCORD_E2E=1` 显式开启真实 Discord E2E。
- `.github/workflows/quality.yml` 在 push / pull request 上运行 Node 22、frozen install、G0、gitleaks、typecheck、lint、coverage、coverage ratchet、cron E2E、dependency scan 和 build。
- `.github/workflows/discord-e2e.yml` 是独立 manual/nightly workflow；默认 fake agent，可通过 input/nightly 配置扩展 cases 或跑真实 agent。
- `eslint.config.js` 对 `src/**/*.ts` 强制 `no-console` 和 `@typescript-eslint/no-floating-promises`，CLI/stdio 入口按例外处理。
- `scripts/quality-coverage-ratchet.ts` 已设置分模块 coverage ratchet，不设置全局 80%。

当前仍需注意：

- D1 文档漂移目前是人工/process gate；`package.json` 和 GitHub Actions 还没有独立的 `quality:docs` 或 changed-path docs drift 脚本。
- 真实 Discord E2E 依赖 test Discord secrets 和网络稳定性，不进入普通 pre-commit / pre-push / CI 默认路径。
- coverage ratchet 只覆盖第一批纯逻辑/formatter/provider 模块；I/O-heavy 入口仍以 targeted tests + E2E fixture 保护。

## 命名原则

`L*` 是测试层级，回答“行为是否正确”。

`G*` 是质量门禁，回答“这次 commit/push/CI 是否允许通过”。

`D*` 是文档门禁，回答“代码和长期文档是否还一致”。

不要把三者混在一起。比如 `pnpm test` 是 L1 测试；pre-commit 调用它时，它才成为 G1/G0 gate 的一部分。

## G0：环境与提交安全门禁

目标：挡住最基础但高破坏性的错误。

应该检查：

- Node 版本符合 `package.json` engines。
- `package.json` 和 `pnpm-lock.yaml` 一致。
- staged 文件不包含 `.env`、SQLite DB、coverage HTML、大 binary、token dump。
- 如果依赖文件变更，运行 `pnpm install --frozen-lockfile`。
- 禁止 `git add .` 式误提交的常见产物进入 staged set。

MiniClaw 为什么需要：

- MiniClaw 持有 Discord token、LLM API key、邮箱/微信/股票等本机配置。
- 很多用户级文件在 `~/.miniclaw/`，AI 很容易误把本地配置或输出复制进 repo。

建议执行位置：

- pre-commit 必跑。
- CI 必跑。

## G1：静态正确性门禁

目标：不运行真实业务，只验证代码能编译、能构建、符合静态规则。

应该包含：

```bash
pnpm run typecheck
pnpm run build
pnpm run lint
```

其中：

- `typecheck` 应等价于 `tsc --noEmit`。
- `build` 应等价于 `tsc`，验证实际 emit、module resolution、dist 输出。
- `lint` 应覆盖 TypeScript 质量规则和项目约束。

MiniClaw 特有 lint 规则：

- 源码禁止直接 `console.*`，只能通过 `src/lib/log.ts`。
- 禁止 floating promise，除非显式 `void` 且是可解释的 fire-and-forget。
- 禁止把 secrets、full prompt、raw email、token-like 字段写入日志。
- 对测试文件可以放宽部分规则，但不能放宽 secret 规则。

实际执行位置：

- pre-commit 跑 `lint + typecheck`。
- pre-push 跑 `build + lint`。
- CI 跑 `typecheck + lint + build`。

## L1：快速单元测试

目标：纯逻辑、无网络、无真实 Discord、无真实 LLM、可重复、快速。

应该覆盖：

- cron 纯逻辑：`loader`、`state`、`template`、retry 算法。
- routing 纯逻辑：intent、context、confirmation token。
- Discord formatter/chunking：embed 字段、2000 字限制、代码块切分。
- provider parser/formatter/redaction：微信、email、futu、stock 等。
- prompt snapshot：prompt 模板变更必须可见。
- task helper/session/usage：session id、token summary、status summary。

作用：

- 挡住 AI 最常见的局部误改。
- 为 refactor 提供快速反馈。
- 适合每次 commit 前运行。

建议执行位置：

- pre-commit 必跑 `pnpm test`。
- CI 必跑。

## L2：内部集成测试

目标：多个 MiniClaw 模块连起来测，但外部系统用 fake。

典型测试：

- fake Discord channel/thread：测试 task intake 是否创建 task、发送 start embed、调用 fake executeTask。
- temp SQLite DB：测试 task 状态从 `running` 到 `completed/failed/cancelled`。
- fixture cron directory：测试 scheduler、runner、retry、state 文件。
- fake slash interaction：测试 `/task`、`/status`、`/health`、`/resume` handler 输出。
- fake pre-provider：测试 cron `pre_provider` 输出如何注入 prompt。
- fake logger sink：验证关键路径有开始/结束日志和错误日志。

作用：

- L1 只能证明单个函数正确；L2 证明 MiniClaw 内部链路没断。
- 对 MiniClaw 来说，L2 比单纯提高全局 coverage 更有价值，因为实际风险经常发生在路由、DB、Discord 输出、cron 状态的交界处。

建议执行位置：

- pre-push 必跑。
- CI 必跑。
- pre-commit 默认不跑，除非 L2 后续足够快且稳定。

## L3：真实 Discord E2E，fake agent

目标：真实 Discord Gateway、真实 channel、真实 thread、真实 message output，但不调用 Claude/Codex。

这是 MiniClaw 最需要新增的一层。

推荐设计：

- 使用 dedicated Discord test application，不复用生产 bot token。
- 使用 dedicated Discord test guild/channel。
- 测试 harness 用第二个 Discord bot 作为 sender。
- MiniClaw 在 `MINICLAW_E2E_MODE=true` 下允许指定 sender bot ID 通过 message author guard。
- MiniClaw 使用 `MINICLAW_E2E_FAKE_AGENT=true`，chat/task 固定返回可匹配文本。
- 使用临时 `MINICLAW_CONFIG`、临时 `MINICLAW_DB_PATH`、临时 memory path、临时 cwd。
- 设置 `MINICLAW_DISABLE_SCHEDULER=true`，避免 E2E 启动真实 cron。
- 设置 `MINICLAW_LOG_FORMAT=json`，harness 从 stdout/stderr 解析结构化日志。

必须覆盖的 case：

- mention chat：发送 `<@MiniClawTestBot> e2e chat <runId>`，验证回复包含 `E2E_CHAT_OK <runId>`。
- task channel intake：在 task channel 发 `e2e task <runId>`，验证创建 thread。
- task completion：验证 thread 中有 start embed、progress/final message、complete embed。
- DB 状态：验证临时 DB 中 task 变为 `completed`。
- thread continuation：在 task thread 发送 follow-up，验证 resume 路径触发。
- logs：验证 JSON logs 中出现 `main`、`bot`、`task`、`chat` 或 fake agent 的关键事件。

不能这么做：

- 不能用生产 Discord bot token 跑测试。
- 不能让 E2E 读真实 `~/.miniclaw/cron`。
- 不能让 E2E 写真实 `~/.miniclaw/data.db`。
- 不能默认调用真实 Claude/Codex。

建议执行位置：

- 本地手动：`pnpm e2e:discord`。
- CI manual workflow：`workflow_dispatch`，需要 test Discord secrets。
- 不放进普通 pre-commit。
- pre-push 可以通过环境变量开启，例如 `MINICLAW_RUN_DISCORD_E2E=1`。

## L4：真实 Agent E2E

目标：真实 Discord + 真实 Claude/Codex + 真实 SDK streaming。

适合验证：

- provider 初始化。
- Codex/Claude SDK streaming event schema。
- sandbox / cwd / tool 调用。
- task progress message 是否能在真实长链路下更新。
- token/cost summary 是否能正常出现。

限制：

- 慢。
- 花钱。
- 依赖网络和模型稳定性。
- 失败不一定代表代码错误。

建议执行位置：

- manual。
- nightly。
- release 前。
- 不进入日常 pre-commit/pre-push。

## G2：安全与供应链门禁

目标：阻止 secrets、敏感日志、依赖漏洞进入 main。

应该包含：

- `gitleaks`：扫描 staged changes 和 CI full tree。
- GitHub Actions 中 `gitleaks/gitleaks-action` 依赖完整 git history 判断 push range；`actions/checkout` 必须设置 `fetch-depth: 0`，否则 shallow checkout 可能导致 secret scan 在进入 typecheck/lint/test 之前失败。
- `pnpm audit --prod` 或 OSV scanner：扫描生产依赖。
- 禁止提交 `.env`、`*.db`、`*.sqlite`、`~/.miniclaw` dump、Discord transcript 中的 token。
- 对 JSON logs / E2E artifact 做 redaction 检查。

实际执行位置：

- pre-commit 跑 staged secret scan。
- pre-push 跑 full-tree secret scan 和 dependency scan。
- CI 用 `gitleaks/gitleaks-action@v2` 跑 full secret scan，并跑 `pnpm run quality:deps`。

## D1：文档漂移门禁

目标：防止 AI 基于过期文档继续改错。

MiniClaw 是 docs-first 项目，长期维护依赖 `docs/architecture.md`、`docs/bot-routing.md`、`docs/prompts.md`、`docs/features/*.md` 和 plan 文档。代码改了但 docs 不变，是后续 AI 误判的主要来源。

建议规则：

- 改 `src/bot.ts`：必须同步 `docs/bot-routing.md`。
- 改 `src/cron/*`：必须同步 `docs/architecture.md` 中 cron 部分。
- 改 `src/agent/*` 或 provider 行为：必须同步 `docs/architecture.md` 或 `docs/features/` 下的对应 provider 文档。
- 改 `prompts/*.md`：必须跑 prompt snapshot，并同步 `docs/prompts.md`。
- 改 DB schema：必须同步 `docs/architecture.md` ER 图。
- 改 `~/.miniclaw/` 文件布局：必须同步 `docs/architecture.md` 用户级目录布局。

当前执行方式：

- 目前还没有脚本化 changed-path docs drift check；执行者需要在改动完成前按下面映射人工核对。
- 对紧急修复可以允许暂不改文档，但必须在 commit body、PR 或后续 plan 中写明原因和补文档路径。
- 后续如果新增 `quality:docs`，应先实现 changed paths 到 docs paths 的轻量映射，再接入 pre-push/CI。

## 推荐执行矩阵

pre-commit：

- G0 staged safety check
- G2 staged secret scan
- G1 `lint + typecheck`
- L1 `pnpm test`

pre-push：

- G1 `build + lint`
- `test:cov`
- coverage ratchet
- cron E2E fixture
- G0 full-tree safety check
- G2 full-tree secret scan / dependency scan
- 可选 L3 Discord E2E，通过 env 显式开启

CI：

- G0 install / lockfile / environment
- G1 typecheck / lint / build
- coverage run + coverage ratchet
- cron E2E fixture
- G2 full secret scan / dependency scan
- D1 docs drift 仍为人工/process gate，尚未脚本化

manual/nightly：

- L3 Discord E2E fake agent
- L4 Discord E2E real agent
- production smoke

## Coverage 策略

不要立刻设置全局 80% threshold。

原因：

- `bot.ts`、`agent/task.ts`、`agent/chat.ts`、真实 provider client、CLI/e2e entry path 都是 I/O-heavy。
- 当前总体覆盖率主要反映“入口和外部系统未 mock”，不等于纯逻辑质量差。
- 直接设全局高阈值会鼓励无意义测试和 coverage gaming。

推荐做法：

- 对纯逻辑模块先设硬阈值。
- 对 I/O-heavy 模块先拆出可测逻辑，再逐步 ratchet。
- coverage gate 采用“不得下降 + 关键模块阈值”的组合。

当前已设 ratchet 的模块：

- `src/store/memory-md.ts`
- `src/discord/chunks.ts`
- `src/cron/template.ts`
- `src/lib/markdown.ts`
- `src/routing/intent.ts`
- `src/providers/futu-stock/format.ts`
- `src/providers/stock-portfolio/index.ts`

下一批适合纳入 ratchet 的模块：

- `src/cron/loader.ts`
- `src/cron/state.ts`
- `src/routing/context.ts`
- `src/discord/formatter.ts`
- `src/store/db.ts`
- provider parser/formatter/redaction 模块

第一批需要重构后再提高覆盖的模块：

- `src/bot.ts`
- `src/commands/handlers.ts`
- `src/agent/task.ts`
- `src/agent/chat.ts`
- real provider clients

## 实施任务清单

### P0：建立基本门禁和最小 Discord E2E

`P0-00` 创建质量门禁计划文档 ✅

- 新增或维护 `docs/plans/YYYY-MM-DD-quality-gates-and-discord-e2e.md`。
- 明确本轮范围、风险、验证计划、文档同步清单。

`P0-01` 标准化 npm scripts ✅

- 增加 `typecheck`。
- 增加 `quality:commit`。
- 增加 `quality:push`。
- 增加 `e2e:discord`。

`P0-02` 强化 pre-commit ✅

- 跑 staged safety check。
- 跑 `pnpm run typecheck`。
- 跑 `pnpm test`。
- 对 prompt 文件变更跑 prompt snapshot。

`P0-03` 新增 pre-push ✅

- 跑 `pnpm run build`。
- 跑 `pnpm test:cov`。
- 预留 lint/security hooks。
- 支持通过 env 开启 Discord E2E。

`P0-04` 新增基础 GitHub Actions ✅

- Node 22。
- pnpm install frozen。
- typecheck。
- test。
- build。

`P0-05` 新增 E2E 安全配置 ✅

- `MINICLAW_E2E_MODE`。
- `MINICLAW_E2E_SENDER_USER_IDS`。
- `MINICLAW_DISABLE_SCHEDULER`。
- 临时 DB / memory / cwd 强制检查。

`P0-06` 新增 fake agent ✅

- chat fake 固定返回 `E2E_CHAT_OK <runId>`。
- task fake 固定返回 `E2E_TASK_OK <runId>`。
- 输出 fake usage、duration、session id，确保 formatter 和 DB 链路可测。

`P0-07` 新增 Discord E2E harness ✅

- `scripts/e2e-discord.ts`。
- spawn MiniClaw test process。
- sender bot 发送测试消息。
- 监听 Discord 输出、thread、embed、logs、DB。
- 失败时保留 artifact。

`P0-08` 新增最小 E2E cases ✅

- mention chat。
- task channel 创建 thread。
- task completed embed。
- thread follow-up resume。

### P1：补齐 lint、安全和更强集成测试

`P1-01` 引入 ESLint ✅

- TypeScript 基础规则。
- `no-console`，仅允许 logger 内部。
- floating promise 规则。

`P1-02` 引入 secret scan ✅

- gitleaks pre-push staged scan。
- CI full tree scan。

`P1-03` 引入 dependency scan ✅

- `pnpm audit --prod` 或 OSV scanner。
- CI 中硬 fail。
- 本地 pre-push 可先 warn，再逐步 hard fail。

`P1-04` bot routing integration tests ✅

- 把 `bot.ts` 路由判断拆成可测函数。
- 覆盖 bot author guard、allowed user、task channel、mention、thread continuation、smart router 入口。

`P1-05` E2E artifact ✅

- `artifacts/e2e/<runId>/logs.jsonl`。
- `artifacts/e2e/<runId>/discord-transcript.md`。
- `artifacts/e2e/<runId>/db-summary.json`。

`P1-06` manual Discord E2E workflow ✅

- GitHub Actions `workflow_dispatch`。
- 只在配置 test Discord secrets 后启用。

`P1-07` cron E2E fixture ✅

- 使用测试 cron config。
- 验证 message/script/task runner 输出。
- 不读真实 `~/.miniclaw/cron`。

### P2：coverage ratchet 和真实 Agent E2E

`P2-01` 分模块 coverage threshold ✅

- 先覆盖纯逻辑模块。
- 不设全局 80%。
- 后续按模块 ratchet。

`P2-02` 提高入口模块覆盖 ✅

- `bot.ts`。
- `commands/handlers.ts`。
- `agent/task.ts`。
- `agent/chat.ts`。

`P2-03` 真实 Codex/Claude E2E ✅

- manual/nightly。
- 限制 budget、turns、timeout。
- 使用 temp cwd。

`P2-04` 附件 E2E ✅

- 文本附件。
- 图片/PDF 下载。
- 过大文件提示。
- cleanup。

`P2-05` smart router E2E ✅

- 自动 task 路径可自动化。
- 按钮交互优先 handler integration test，真实按钮点击作为人工 checklist。

`P2-06` flaky 管理 ✅

- 记录 timeout、Discord API error、network error。
- 区分代码回归和外部系统抖动。
- 对 L3/L4 失败输出可诊断 artifact。

## 当前实施状态

截至 2026-05-08：

- `P0-00` 到 `P0-08` 已落地：plan 文档、npm quality scripts、G0 safety check、pre-commit/pre-push、基础 GitHub Actions、E2E 安全配置、fake agent、Discord E2E harness、最小 E2E cases。
- `P1-01` 到 `P1-07` 已落地：ESLint、secret scan、dependency scan、bot routing integration tests、E2E artifact、manual Discord E2E workflow、cron E2E fixture。
- `P2-01` 到 `P2-06` 已落地：coverage ratchet、入口风险覆盖提升、真实 Agent E2E 开关、附件 E2E、smart router E2E、flaky 分类 artifact。

## 当前实现映射

- fake agent：`src/e2e/fake-agent.ts`，通过 `MINICLAW_E2E_FAKE_AGENT=true` 固定输出 `E2E_CHAT_OK <runId>` / `E2E_TASK_OK <runId>`。
- Discord E2E：`scripts/e2e-discord.ts`，默认跑 `chat,task,followup`；可通过 `MINICLAW_E2E_CASES=attachment,smart-router` 扩展；`MINICLAW_E2E_FAKE_AGENT=false` 可跑真实 Codex/Claude。
- E2E artifacts：`artifacts/e2e/<runId>/logs.jsonl`、`discord-transcript.md`、`db-summary.json`、`summary.json`、失败时 `failure.json`。
- cron E2E fixture：`scripts/e2e-cron-fixture.ts`，使用临时 cron dir / scripts dir / DB / memory，不读取真实 `~/.miniclaw/cron`。
- lint：`eslint.config.js`，对 `src/**/*.ts` 启用 `no-console` 和 `@typescript-eslint/no-floating-promises`，CLI/stdio 入口按例外处理。
- secret scan：本地 `scripts/quality-secrets.ts` 优先用 gitleaks，未安装时 fallback 到 G0；CI 使用 `gitleaks/gitleaks-action@v2`。
- dependency scan：`scripts/quality-deps.ts` 使用 `pnpm audit --prod --audit-level high`。
- coverage ratchet：`scripts/quality-coverage-ratchet.ts` 对纯逻辑和高覆盖 provider 模块设置分模块阈值，不设置全局 80%。

## 后续维护 loop

P0、P1、P2 已完成。后续新增 gate、提高 coverage threshold 或扩展 E2E case 时，按这个 loop 执行：

1. 在 plan 文档中记录目标、风险和验证方式。
2. 做最小代码改动，优先扩展已有 scripts / harness / workflow。
3. 跑对应验证命令，必要时跑 `pnpm run quality:push`。
4. 更新本文件的实现映射或新增任务状态。
5. 如果改了架构入口，同步对应架构文档。
6. 每个 commit 保持原子，只包含一个独立 gate、测试能力或文档同步。
