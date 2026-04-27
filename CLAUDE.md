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

## 测试状态

| 模块 | 类型检查 |
|------|----------|
| 全部 | ✅ 通过 |

## Retrospective

（空）
