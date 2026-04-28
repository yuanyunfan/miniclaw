# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

### Changed
- **memories 存储从 SQLite 迁移到 markdown**（`~/.miniclaw/memories/MEMORY.md`）
  - 用户可直接 `vim` 编辑、`git diff` 跟踪、跨工具复用
  - 4 个固定 section：user / project / feedback / reference（emoji 标题）
  - 每条用 `§` 分隔，末尾 `<!-- id=xxxx -->` 注释含 4 字符 hex ID
  - SQLite `memories` 表保留作冷备但不再读写
  - `/forget` 命令的 id 参数从 INTEGER 改 STRING（需重跑 `pnpm register`）
- `src/store/memory.ts` 改成 re-export from `memory-md.ts`，旧 import 路径不变
- 新增 `scripts/migrate-memories.ts`：SQLite → MEMORY.md 一次性迁移（带 `--dry-run` / `--backup`）

### Added
- 单元测试基础设施（vitest）+ 48 个测试覆盖 8 个核心模块（含 memory-md 10 用例）
- `init.sh` 一键环境初始化（Node/pnpm 检查 + 依赖 + hooks + 类型检查 + 测试）
- `scripts/git-hooks/pre-commit` + `scripts/install-hooks.sh` —— commit 前强制 tsc
- `.claude/settings.json` 项目级 SessionStart hook（自动注入 CLAUDE.md + 最近 commit）
- `CHANGELOG.md`（本文件）
- CLAUDE.md 补 `Session Workflow` / `Git Quality Gates` / `Retrospective` 三章节

### Changed
- `src/agent/mcp.ts` 重构 env 读取到函数内（支持测试隔离）+ 暴露 `resetMcpCache()`
- `src/agent/subagents.ts` 暴露 `parseFrontmatter` 给单测
- `src/agent/task.ts` 暴露 `__testables.{fmtTokens, formatUsage}` 给单测

---

## [0.4.0] — 2026-04-28

### Added
- 4 角色 subagent prompt 全面重写（Researcher / Planner / Generator / Evaluator）
  - 物理工具隔离（SDK `tools` 字段白名单）
  - 输入契约 + 失败处理表 + few-shot 示例
  - Evaluator 输出 `## Machine-Readable Verdict` YAML 块（verdict + fix_list + escalate）
  - Generator 加 Contract 模式 + Fix 模式
- Supervisor system prompt 重写（`task.ts`）：编排纪律 + verdict 路由 + 自动迭代（MAX_ITER=2）+ 文件即真相 + Contract 触发
- `canUseTool` gate 拦截 `Skill(triad)` / `Skill(triad-resume)`（避免 Supervisor 跑 CLI-only slash command）
- Thread continuation：`/task` 创建的 Discord thread 内任意消息自动 resume session
- MCP loader（`src/agent/mcp.ts`）：零 key 维护读 `~/.claude.json` 的 mcpServers
- 累积式 Discord 进度（去重 ×N + 工具图标 + 参数预览）+ 任务结束追发"📋 执行轨迹"总结
- embed 加 Tokens 字段（in/out/cache hit/cache write 分项）
- `subagents.ts` parser 支持 YAML 块标量（`|`）+ flow 数组（`[a, b, c]`）
- `docs/architecture.md` + `docs/bot-routing.md`

---

## [0.3.0] — 2026-04-27

### Added
- 任务状态机 + pm2 重启恢复（中断任务持久化、启动时自动恢复）
- 角色化 subagent 体系初版（4 个 markdown 文件 + loader）

---

## [0.2.0] — 2026-04-26

### Added
- 跨 session 内存系统（SQLite + 启动时注入 system prompt）
- @mention 多轮对话上下文持久化

---

## [0.1.0] — 2026-04-25

### Added
- MiniClaw 首版 Discord bot
- `/task` slash command + `/status` `/cancel` `/resume`
- @mention 轻量对话（Anthropic Messages API）
- HTTP 代理 + WebSocket 代理双通道（中国大陆网络）
