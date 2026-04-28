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

## Session Workflow (MANDATORY)

> 每次 Claude Code session 处理 miniclaw 代码时**必须**遵守。

**Session 开始时**：
1. 读 `git log --oneline -10` 看最近改动
2. 读 `CHANGELOG.md` 顶部的 [Unreleased] 段了解当前在做什么
3. 跑 `pnpm test` 验证当前 main 是绿的（红的话先修再动手）

**每次代码改动后**：
4. 跑 `pnpm exec tsc --noEmit` 确保类型通过
5. 改了被测函数 → 跑相关测试 `pnpm test src/<dir>/`
6. 加了新函数/新行为 → 补单测（不要让测试覆盖率倒退）

**Session 结束前**：
7. 显著架构变更或踩坑 → 追加一条到 `## Retrospective`（格式：`[YYYY-MM-DD] 问题简述` → 根因 → 修复 → 教训）
8. 完成完整 feature → 在 `CHANGELOG.md` 的 [Unreleased] 段加一条

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
