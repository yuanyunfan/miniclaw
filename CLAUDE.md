# MiniClaw

极简 AI 助手 — Discord 消息 → Claude Code / Codex provider 执行任务 → Discord 回复结果。

## 项目定位

个人单用户使用的 AI 助手，通过 Discord 沟通、通过 `.env` 选择 Claude Code 或 Codex 执行任务，本地 Mac 常驻运行。

## 架构概览

Discord Bot (discord.js v14) → Orchestrator → provider（Claude Code/Anthropic API 或 Codex SDK）

- @mention → provider chat：Claude 下走 @anthropic-ai/sdk `messages.stream()` + 手写工具 loop；Codex 下走 read-only Codex thread
- /task → provider task：Claude 下是 Supervisor + claude-agent-sdk；Codex 下是 workspace-write Codex thread + progress event 映射
- /status, /cancel, /resume → 任务管理

## 运行命令

| 用途 | 命令 |
|------|------|
| 开发 | pnpm dev |
| 构建 | pnpm build |
| 启动 | pnpm start |
| 注册命令 | pnpm register |
| pm2 常驻 | pm2 start ecosystem.config.cjs |

## 技术栈

- TypeScript (ESM) + Node.js 22+
- discord.js v14
- @anthropic-ai/claude-agent-sdk（任务执行）
- @anthropic-ai/sdk（轻量对话）
- @openai/codex-sdk（Codex provider）
- better-sqlite3（持久化）
- pm2（进程管理）

## 目录结构

- src/index.ts — 入口
- src/bot.ts — Discord 事件监听 + 路由
- src/config.ts — 配置加载
- src/agent/chat.ts — 轻量对话（@mention，Claude/Codex provider）
- src/agent/chat-tools.ts — 4 个 chat 工具的 schema + executor（read_file / bash / web_search / web_fetch）
- src/agent/codex.ts — Codex SDK 封装
- src/agent/session.ts — provider-prefixed session id
- src/agent/task.ts — 任务执行（/task，Claude/Codex provider）
- src/agent/subagents.ts — 加载 agents/*.md 注册角色化 subagent
- agents/*.md — 角色化 subagent 定义（researcher / code-investigator / planner / generator / evaluator），YAML frontmatter + 系统 prompt
- src/commands/register.ts — Slash command 注册
- src/commands/handlers.ts — 命令处理逻辑
- src/discord/chunks.ts — 消息分片（2000 字符限制）
- src/discord/attachments.ts — Discord 附件 → Claude content blocks + Codex local image/text inputs
- src/discord/formatter.ts — Embed 格式化
- src/discord/progress.ts — 进度更新推送
- src/store/db.ts — SQLite 存储

## 配置

复制 .env.example → .env，填写 Discord Bot Token、Client ID、Guild ID、允许的用户 ID；`MINICLAW_AGENT_PROVIDER=claude` 时填 Anthropic API Key，`codex` 时可填 OpenAI API Key 或复用本机 `codex login`。

**Provider 切换与 Session 恢复**：
- 切换 `MINICLAW_AGENT_PROVIDER` 后必须重启 bot（`.env` 不在 `tsx --watch` 监听范围）
- session id 自带 provider 前缀（`claude:xxx` / `codex:xxx`），由 `src/agent/session.ts:assertProviderSession()` 强校验
- **跨 provider 不能 `/resume`**：claude 下创建的 session 切到 codex 后再 `/resume` 会拒绝，反之亦然。需要重新 `/task` 起一个新 session

## 测试

```bash
pnpm test       # 跑所有单元测试（vitest）
pnpm test:watch # 改文件自动重跑
pnpm test:cov   # 带覆盖率报告
```

测试文件按模块分布在 `src/**/__tests__/*.test.ts`。

| 模块 | 测试覆盖 |
|------|----------|
| `agent/subagents` parseFrontmatter | YAML 块标量 / flow 数组 / 缺失字段 |
| `agent/mcp` loadMcpServers | allowlist / 缺文件 / 坏 JSON |
| `agent/task` formatUsage / fmtTokens | 全部 token 字段 / 部分 / 空 |
| `store/db` createTask / getTaskByThreadId / markTaskInterrupted | CRUD + thread 续话查询 |
| `discord/chunks` chunkMessage | 长文分片 / 代码围栏平衡 |
| `discord/formatter` taskCompleteEmbed | tokens 字段 / 错误 embed |
| `memory/parse` parseExplicitMemory | 中文/英文/slash 前缀 |

`executeTask()` 是 I/O heavy（调 Claude/Codex SDK），不在单测覆盖。端到端走 Discord 真实测。

## Docs-First Development Planning

> 非平凡开发任务必须先把计划写进 `docs/`，再开始改业务代码。

MiniClaw 的长期维护依赖文档和代码同步。LLM 在开发时不能只把计划留在对话里；对后续 session 有价值的设计、取舍、验证标准，都要沉淀到 repo 文档中。

**什么时候必须先写计划文档**：
- 涉及新功能、跨模块改动、公共 API/schema/auth/权限、cron/provider/task 执行链路、Discord 输出行为、Agent/Codex/Claude runtime、Stage、数据库、配置语义或安全边界。
- 需要多步实现、存在架构取舍、风险不确定、或预计会修改 3 个以上文件。

**什么时候可以跳过计划文档**：
- 纯 typo、README 小修、测试快照更新、显然局部的一行 bug fix。
- 即便跳过计划文档，仍要在最终回复说明验证证据；如果改动影响现有架构文档，仍必须同步 docs。

**计划文档位置**：
- 默认写到 `docs/plans/YYYY-MM-DD-<short-slug>.md`。
- 如果已有专题文档更合适，可以直接更新对应 `docs/**/*.md`，但必须包含计划、范围、验证和文档影响。

**`plans/` 与 `features/` 的定位**：
- `docs/plans/` 是实施过程文档：记录为什么做、怎么做、范围/非目标、验证计划、风险、rollback 和 execution notes。它是 RFC + implementation log，不是长期唯一说明书。
- `docs/features/` 是落地后的能力文档：记录这个 feature 当前是什么、如何工作、如何配置、如何验证、如何排障、安全边界是什么。
- 新 feature 或非平凡变更必须先写/更新 `docs/plans/YYYY-MM-DD-<short-slug>.md`；实现完成后，把长期有效的信息沉淀到对应 `docs/features/NN-*.md`。
- `docs/features/` 保持扁平目录，不建子目录；文件名使用两位阿拉伯数字前缀，按实现顺序从 `01-` 开始递增。
- `docs/README.md` 是文档入口和放置规则。LLM 不确定文档应该放哪里时，先读 `docs/README.md`，不要凭直觉新建散乱路径。
- 不要让 completed plan 成为唯一真相；后续维护应优先读 `docs/features/NN-*.md` 和全局 design 文档，再回看 plan 了解历史取舍。

**计划文档至少包含**：
- 背景和目标：用户要解决什么问题，当前系统哪里相关。
- 范围和非目标：明确本次不做什么，避免任务膨胀。
- 现有架构证据：关键文件、数据流、配置或命令入口。
- 实施计划：分步骤列出要改哪些模块、为什么这样改。
- 验证计划：需要跑哪些测试、type check、cron test、Discord/Playwright E2E 或人工检查。
- 风险和回滚：可能破坏什么，失败时如何止损。
- 文档同步清单：完成后要更新哪些 README / docs / CHANGELOG。

**执行纪律**：
1. 先探索代码和现有 docs，确认 root cause 与改动边界。
2. 先读 `docs/README.md` 判断文档归属；必要时再读 `docs/architecture.md`、`docs/bot-routing.md`、对应 `docs/features/NN-*.md`。
3. 写或更新计划文档，并在对话里指出文档路径。
4. 再开始改业务代码。
5. 实现过程中如果设计变化，先更新计划文档，再继续改代码。
6. 结束前把计划文档状态改为 completed / superseded，并同步 `CHANGELOG.md`、相关全局 design 文档和对应 feature 文档。

## 用户级扩展（`~/.miniclaw/`）

| 目录 | 用途 |
|---|---|
| `memories/MEMORY.md` | 长期记忆（4 个 section + `§` 分隔，可直接 vim 编辑） |
| `cron/*.yaml` | 定时任务（type=task / script / skill / message） |
| `skills/*.md` | 用户级 subagent（同名覆盖 repo `agents/`） |
| `scripts/*` | 可执行脚本（仅由 cron `type=script` 调用） |
| `data.db` | SQLite（tasks + chat_history） |

cron job 示例（YAML）：
```yaml
name: morning-brief
schedule: "0 9 * * *"        # crontab 5 字段
timezone: Asia/Shanghai
enabled: true
type: task                   # task | script | skill | message
channel: "<your-discord-channel-id>"
prompt: 扫描 ~/Code 项目仓库的 git status
```

CLI：
- `pnpm cron:list` — 列出所有 job + 状态
- `pnpm cron:test <name>` — 立刻试跑某 job（不影响调度）

scheduler 在 miniclaw 启动时随 ClientReady 一起 start，SIGTERM 时 stop。

## Stage（CLI 多 agent 控制台）

平行于 Discord bot 的另一个子系统：终端里跑多 agent 群聊，按需召唤角色（CEO/Engineer/Tester），自由 @ 分派任务，做观察者看 agent 互相讨论。

- 入口：`pnpm stage`（Ink 4-pane TUI）/ `pnpm stage:repl`（无 TUI 兜底）
- Persona 定义：`personas/<id>.md`（repo 默认）+ `~/.miniclaw/personas/<id>.md`（user 覆盖）
- 持久化：`~/.miniclaw/scenes/<name>.md` 双轨 markdown + DB（`scenes` / `scene_messages` 表）
- 反失控：env `MINICLAW_STAGE_BUDGET_USD`（默认 $2）/ `TURN_CAP`（默认 30）/ `SAME_SPEAKER_CAP`（默认 3）
- 详细架构 + 命令清单见 `docs/features/01-stage.md`

Stage 完全复用 `chat-tools` / `memory` / `log` / `db` / `config`，但路径独立 (`src/stage/`)，不与 `src/agent/` (Discord chat) 耦合。

## 日志

统一走 `src/lib/log.ts`，**禁止在源码里直接用 `console.*`**（除了 logger 自己内部）。

```ts
import { createLogger } from "./lib/log.js";  // 路径相对调整
const log = createLogger("模块名");           // tag 显示在 [...] 里

log.info("普通信息");
log.warn("可恢复的异常");
log.error("失败 + 上下文:", err);
log.debug("调试信息");                         // 默认不输出
```

输出格式：`2026-04-29T07:40:51.795Z [INFO ] [模块名] 内容`

| 配置 | 含义 | 默认 |
|---|---|---|
| `MINICLAW_LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` |
| `MINICLAW_LOG_DIR`（pm2 模式） | 日志目录 | `~/.miniclaw/logs/` |

**输出去向**：
- `pnpm dev` → 直接 stdout/stderr，不落盘
- `pm2 start ecosystem.config.cjs` → `~/.miniclaw/logs/miniclaw-{out,error}.log`（由 ecosystem.config.cjs 重定向）
- 长期常驻必须装 `pm2 install pm2-logrotate` + `pm2 set pm2-logrotate:max_size 10M` + `retain 7` 否则会撑爆

**写日志的纪律**：
- 模块名用短小写串：`bot` / `chat` / `task` / `cron` / `cron-state` / `mcp` / `subagents` / `handlers` / `recovery` / `register` / `config` / `proxy` / `memory-extract` / `main`
- task / cron 等长链路必须有"开始"和"结束"对称日志（含耗时 / cost / turns），单边日志失去回溯价值
- error 一定带 err 对象（`log.error("xxx failed:", err)`），别只打 message string
- info 是正常运行可见的高频路径；warn 是"非崩溃但需要注意"；debug 留给手动排错时打开

## Session Workflow (MANDATORY)

> 每次 Claude Code session 处理 miniclaw 代码时**必须**遵守。

**Session 开始时**：
1. 读 `git log --oneline -10` 看最近改动
2. 读 `CHANGELOG.md` 顶部的 [Unreleased] 段了解当前在做什么
3. 跑 `pnpm test` 验证当前 main 是绿的（红的话先修再动手）
4. 读 `docs/README.md` 确认 docs 目录定位、`plans/` vs `features/` 规则和专题文档入口
5. **如果是不熟悉的领域改动**（cron / Supervisor / thread continuation / provider / feature docs 等），先看 `docs/architecture.md` + `docs/bot-routing.md` + 对应 `docs/features/NN-*.md` 对齐心智模型，避免读源码盲改
6. **非平凡开发必须先写 docs 计划**：按 `Docs-First Development Planning` 创建或更新 `docs/plans/YYYY-MM-DD-<short-slug>.md`，明确背景、范围、实施步骤、验证计划、风险和文档同步清单；计划文档落盘后再开始改业务代码

**每次代码改动后**：
7. 跑 `pnpm exec tsc --noEmit` 确保类型通过
8. 改了被测函数 → 跑相关测试 `pnpm test src/<dir>/`
9. 加了新函数/新行为 → 补单测（不要让测试覆盖率倒退）
10. **改了下列任一 → 必须同步更新 `docs/architecture.md` 或 `docs/bot-routing.md` 或 `docs/features/NN-*.md` 或 `docs/prompts.md`**：
   - `src/bot.ts` 路由逻辑（事件监听 / 守卫 / Path 分支）→ `bot-routing.md`
   - `src/agent/{chat,task,subagents,mcp}.ts` 任一架构改动 → `architecture.md` 图 1+2+3
   - `src/cron/*` 调度引擎或新 type / runner 模式 → `architecture.md` 图 4
   - `src/store/db.ts` schema → `architecture.md` 末尾 ER 图
   - `~/.miniclaw/` 新增子目录 / 文件类型 → `architecture.md` 图 1+5
   - `src/stage/*` 路由 / orchestrator / persona / 命令 / TUI 改动 → `docs/features/01-stage.md`
   - `src/providers/*` 或 `src/capabilities/*` 行为改动 → 对应 `docs/features/NN-*.md`
   - `prompts/*.md` 任一改动 → 跑 `pnpm test prompt-snapshot`，确认 diff 有意后 `vitest -u` 更新 hash；新增 prompt 文件还要更 `docs/prompts.md` 的清单
   不更新 docs 等于"代码漂移"，下次 session 开局看到的图就是错的，会基于错信息做决策
11. 如果本次有计划文档，结束前把实际执行结果、验证证据、偏离原计划的原因写回该文档
12. 如果本次实现或改变了长期功能行为，必须更新对应 `docs/features/NN-*.md`；不要只把最终状态留在 plan 里

**Session 结束前**：
13. 显著架构变更或踩坑 → 追加一条到 `## Retrospective`（格式：`[YYYY-MM-DD] 问题简述` → 根因 → 修复 → 教训）
14. 完成完整 feature → 在 `CHANGELOG.md` 的 [Unreleased] 段加一条

## Git Quality Gates

`scripts/git-hooks/pre-commit` 在每次 commit 前自动跑：
- `pnpm exec tsc --noEmit` —— 类型检查必须通过

新机器 clone 后跑 `bash scripts/install-hooks.sh` 安装。

**禁止**：
- `git commit --no-verify` 绕过 hook（除非生产事故紧急修复且事后立刻补测试）
- `git add .` / `git add -A`（防止误提交 .env / 大 binary）
- `git push --force` 到 main
- 直接合并未跑测试的代码

## Retrospective

> 每次踩坑或重要决策时追加。格式：`**[YYYY-MM-DD] 问题简述**`：根因 → 修复 → 教训。

**[2026-04-27] /task 中 Supervisor 自动调用了 triad slash command**：
- 根因：Agent SDK 把 `~/.claude/commands/*.md` 当 LLM-invokable Skill 暴露（CLI 里只有用户能 `/triad` 触发，SDK 行为不同）
- 修复：`task.ts` 加 `canUseTool` gate 拦截 `Skill(triad)` / `Skill(triad-resume)`
- 教训：SDK 行为 ≠ CLI 行为，新引入的 settingSources / Skill 等机制要逐项实测

**[2026-04-27] Discord 进度消息任务结束被 delete，看不到执行步骤**：
- 根因：`progress.ts:complete()` 主动 `await statusMessage.delete()`
- 修复：保留 edit-in-place 实时进度（任务结束时仍 delete 避免堆积），任务结束 embed 后追发"📋 执行轨迹"总结消息（永久保留）
- 教训：UI 设计时区分"实时反馈"vs"历史回看"——前者要节流不刷屏，后者必须持久

**[2026-04-28] Researcher 误判 README 长度（130 行被当成 1 行）**：
- 根因：Read 工具默认 limit，subagent 看了前 N 行就推断"文件只有 N 行"
- 修复：`agents/researcher.md` + `agents/generator.md` 加规则——位置敏感操作必须先 `wc -l` 确认真实长度
- 教训：subagent prompt 要把"模型容易踩的隐含假设"显式禁掉，光靠"模型聪明"靠不住

**[2026-04-28] memories 从 SQLite 迁到 markdown（`~/.miniclaw/memories/MEMORY.md`）**：
- 根因：SQLite 的 type/name/timestamps 字段实际只用了 type 一个（4 段分组渲染），用户却失去了"vim 编辑/git diff/跨工具复用"
- 修复：迁到 markdown 单文件，`§` 分隔条目，每条带 `<!-- name="xxx" id=hex -->` 元数据；SQLite 表保留作冷备
- 教训：如果**结构化字段没产生实际查询/筛选价值**，就别为了"看起来灵活"付出存储复杂度

**[2026-04-28] cron script 里 `${VAR:-~/path}` 的 `~` 没被展开**：
- 根因：bash 的 tilde expansion **只在 word 起始位置生效**，`${VAR:-...}` 的 default 值里 `~` 是字面量
- 现象：`MINICLAW_DB_PATH=~/.miniclaw/data.db` 的 env 传到子进程后，`[ -f "$DB" ]` fail（路径含字面 `~`）
- 修复：bash 脚本里手动展开 `DB="${DB/#\~/$HOME}"`；shell 脚本应避免依赖外层 env 的 tilde
- 教训：spawn 子进程 + 字符串 path 总要假设 `~` 是字面量；要么提前 resolve 后再传，要么子进程显式 expand

**[2026-04-29] docs/ 跟代码漂移 1 周**：
- 根因：CLAUDE.md 的 Session Workflow 没列"改架构必同步 docs"，导致 cron 子系统、verdict YAML、thread continuation 守卫等 ~10 处大改全部没进 docs
- 现象：用户问"现在 docs 是不是过时？"——是的。架构图里还在画 `!task` 临时 hook、subagents 工具集描述太简、缺整个 cron 子图
- 修复：bot-routing.md / architecture.md 重写；CLAUDE.md Session Workflow 加规则 7（哪些文件改动 → 必须同步哪个 docs）
- 教训：**自动化做不到的事，靠 prompt + checklist 兜底**。Claude Code 不会主动跑去改 docs，必须在 CLAUDE.md 里明确写"改 X 文件 → 必更 Y 文档"

**[2026-04-29] @mention 上传 PDF 被丢，LLM 反问"哪个文档"**：
- 根因：`bot.ts` MessageCreate 只读 `message.content`，`message.attachments` 完全未使用；`chat()`/`executeTask()` prompt 入参是 `string`，没法塞 image/document content blocks
- 现象：用户上传 5MB PDF + "整理这个文档"，bot 反复反问"指的是哪个文档"——不是幻觉，LLM 真没收到 PDF
- 修复：新增 `src/discord/attachments.ts`（图片/PDF 下载 → base64 image/document block，文本内联，二进制落盘），chat/task prompt 切到 `AsyncIterable<SDKUserMessage>` 模式，`/task` 加 `file1/file2/file3` 三个 attachment slot
- 教训：**SDK 的 prompt: string 是最简陷阱**。Anthropic API 早就支持多模态 content blocks，但用 string 形式调 SDK 会让人忘记这件事；只要触发渠道（Discord/Slack 等）支持文件，就要把 prompt 改成 content blocks 模式
- 副产物教训：**raven → Copilot proxy 不支持 URL 源**（"URL sources are not supported"），即便 Anthropic 原生 API 支持。多模态附件**必须** base64 编码后传，不能图省事用 Discord CDN URL 直传

**[2026-04-29] chat 路径切 Hermes 模式（messages.stream + 手写 tool loop）**：
- 根因：chat.ts 用 claude-agent-sdk 的 query() + claude_code preset，TTFT 2-5s，每条多耗 3-5K tokens 的编码 agent 指令——对闲聊/问答是负收益；hermes-agent 和 openclaw 都不用 preset，明确佐证 preset 是"只为编码任务而生"
- 修复：chat.ts 重写为 `@anthropic-ai/sdk` 的 `messages.stream()` 直接调用 + 4 个手写工具（read_file/bash/web_search/web_fetch）+ 自写 tool loop（MAX_ITERATIONS=10）；自定义短 system prompt 替代 claude_code preset；task.ts **完全不动**（Supervisor 模式仍用 SDK + preset）
- 工具白名单物理隔离：chat 没有 Edit/Write/Agent/MCP，模型若被要求"修代码/重构/调度 subagent"会主动回"请用 /task"；不靠 prompt 提醒
- 预期收益：TTFT 降到 ~500-800ms（5x），每条省 3-5K tokens；chat 失去 cost 数字（messages.create 不返回 total_cost_usd），改用 token 数审计
- 教训：**preset 是双刃剑** —— claude_code preset 对 task 是杀手锏，对 chat 是负担。不要把"工具的默认值"当真理，**判断你的真实需求和 preset 的设计意图是否匹配**

**[2026-04-30] Supervisor prompt 把"流水线"硬编码成 IF/ELSE，调研类任务质量被锁死**：
- 根因：task.ts:144-178 的 supervisorBlock 写死"推荐工作流 1.Researcher → 2.Planner → 3.Generator → 4.Evaluator"+ "任何代码改动必须 Evaluator 验收"+ Verdict YAML 强制，4 个 agent.md 又互相假设上下游存在；researcher.md 还硬性 cap 工具调用 ≤15 次 + 输出格式锁死简短 Findings。结果是用户让调研 GitHub 项目（warpdotdev/warp）时，Supervisor 派 researcher，researcher 没 Bash 不能 git clone，3 轮 134s 出二手资料拼的浅层报告
- 修复：(a) Supervisor prompt 改成"角色能力速查 + 选择原则"，删强制流程；(b) Verdict YAML 改 opt-in；(c) 4 个 agent.md 解上下游硬绑定；(d) researcher 解 15 次上限 + 输出格式可选；(e) 新增 `agents/code-investigator.md` 带 Bash 的深度调研角色；(f) canUseTool 加高风险 Bash 守卫（rm -rf / / sudo / publish / push --force）
- 教训：**prompt 里写"流程图"是反模式**。LLM 看到 1→2→3 会机械执行；正确做法是描述每个角色的能力和适用场景，把组合权交给 LLM。安全网应放代码层（canUseTool / 工具白名单），不要靠 prompt 自律
