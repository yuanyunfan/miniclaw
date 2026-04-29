# MiniClaw

极简 AI 助手 — Discord 消息 → Claude Code Agent SDK 执行任务 → Discord 回复结果。

## 项目定位

个人单用户使用的 AI 助手，通过 Discord 沟通、通过 Claude Code 执行任务，本地 Mac 常驻运行。

## 架构概览

Discord Bot (discord.js v14) → Orchestrator → Claude Code Agent SDK / Anthropic API

- @mention → 轻量对话（Anthropic Messages API 直接回答）
- /task → Supervisor 模式：主 agent 通过 Agent SDK 的 Task tool 分派给角色化 subagent（Researcher / Planner / Generator / Evaluator）
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
- better-sqlite3（持久化）
- pm2（进程管理）

## 目录结构

- src/index.ts — 入口
- src/bot.ts — Discord 事件监听 + 路由
- src/config.ts — 配置加载
- src/agent/chat.ts — 轻量对话（@mention）
- src/agent/task.ts — 任务执行（/task，Agent SDK，Supervisor）
- src/agent/subagents.ts — 加载 agents/*.md 注册角色化 subagent
- agents/*.md — 角色化 subagent 定义（researcher/planner/generator/evaluator），YAML frontmatter + 系统 prompt
- src/commands/register.ts — Slash command 注册
- src/commands/handlers.ts — 命令处理逻辑
- src/discord/chunks.ts — 消息分片（2000 字符限制）
- src/discord/attachments.ts — Discord 附件 → Anthropic ContentBlockParam（图片/PDF 用 URL，文本内联，二进制落盘）
- src/discord/formatter.ts — Embed 格式化
- src/discord/progress.ts — 进度更新推送
- src/store/db.ts — SQLite 存储

## 配置

复制 .env.example → .env，填写 Discord Bot Token、Client ID、Guild ID、Anthropic API Key、允许的用户 ID。

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

`executeTask()` 是 I/O heavy（调 Anthropic SDK），不在单测覆盖。端到端走 Discord 真实测。

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
4. **如果是不熟悉的领域改动**（cron / Supervisor / thread continuation 等），先看 `docs/architecture.md` + `docs/bot-routing.md` 对齐心智模型，避免读源码盲改

**每次代码改动后**：
4. 跑 `pnpm exec tsc --noEmit` 确保类型通过
5. 改了被测函数 → 跑相关测试 `pnpm test src/<dir>/`
6. 加了新函数/新行为 → 补单测（不要让测试覆盖率倒退）
7. **改了下列任一 → 必须同步更新 `docs/architecture.md` 或 `docs/bot-routing.md`**：
   - `src/bot.ts` 路由逻辑（事件监听 / 守卫 / Path 分支）→ `bot-routing.md`
   - `src/agent/{chat,task,subagents,mcp}.ts` 任一架构改动 → `architecture.md` 图 1+2+3
   - `src/cron/*` 调度引擎或新 type / runner 模式 → `architecture.md` 图 4
   - `src/store/db.ts` schema → `architecture.md` 末尾 ER 图
   - `~/.miniclaw/` 新增子目录 / 文件类型 → `architecture.md` 图 1+5
   不更新 docs 等于"代码漂移"，下次 session 开局看到的图就是错的，会基于错信息做决策

**Session 结束前**：
8. 显著架构变更或踩坑 → 追加一条到 `## Retrospective`（格式：`[YYYY-MM-DD] 问题简述` → 根因 → 修复 → 教训）
9. 完成完整 feature → 在 `CHANGELOG.md` 的 [Unreleased] 段加一条

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
