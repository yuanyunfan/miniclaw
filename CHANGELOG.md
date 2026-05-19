# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

### Added
- 新增 cron task `result_delivery.mode: daily_message_group`，可按本地日期复用并编辑同一组 Discord result messages；`browser-tabs-hourly` 可保留完整 Markdown 分块展示，同时避免每小时刷出一批新消息。
- 新增 Weixin 官方协议漂移治理：代码内标记当前对齐 `tencent-weixin-openclaw-weixin 2.4.3` / `@tencent-weixin/openclaw-weixin@2.4.3`，提供 `pnpm weixin:drift-check` 对比官方关键协议文件，并新增 `pnpm weixin:smoke` 操作辅助覆盖登录、文字/媒体收发和升级后 live smoke。
- 新增 Weixin 官方 payload fixture 回归，覆盖官方形状的入站图片、入站语音、媒体上传、QR expired、`-14` session pause 和 chat/task y/n 确认。
- 新增 Weixin direct channel：支持 `pnpm weixin:login` 保存个人微信 bot token、`im.transports.weixin` opt-in 长轮询、文字/语音/图片输入、独立 chat/task 入口、Smart Router y/n 文本确认转 task，以及 cron `delivery_route` 结果额外投递到微信 direct user。
- 新增 `auth:refresh` / `wechat-mp:refresh` 登录态续期入口：WeChat MP 使用专用 persistent browser profile 做 headless refresh，Eastmoney JYWG 使用只读 `/Trade/Buy` 轻量刷新并原子写回 session secret，遇到扫码、验证码、短信或设备确认时 fail closed 并提示人工恢复。
- 扩展 `third-party-health` hourly script，覆盖 provider health、Yahoo 行情 canary、WeChat MP 搜索、email IMAP、market-intel 官方源和 stock-portfolio 聚合配置，并在异常通知中保留分类、延迟和修复建议。
- 新增 stock provider 数据层迁移计划，明确 Source Adapter、Data Domain、Signal / Intelligence、Report Composer / Cron Provider 四层结构，并同步英文 canonical docs、中文 mirror、migration map 和 stock provider 入口链接。
- 新增全局 `cron.active_window` 配置，可在 `config.yaml` 中按时区设置 scheduled cron 活动时间；窗口外会记录 skipped，不执行 script、provider 或 task runtime。
- 新增 `eastmoney-etf-premium` public provider，从 Eastmoney fund selector 读取 ETF `PREMIUM_DISCOUNT_RATIO`，并让 `stock-portfolio` 只在 JYWG 持仓行存在时按代码合并折溢价数据。
- 新增 `quality:changelog` gate，并接入 `quality:commit`、`quality:push` 和 CI；`src/**`、`scripts/**`、`.github/workflows/**`、`docs/**`、`website/**`、`prompts/**` 等 release-visible 变更必须同 patch 更新 `CHANGELOG.md`。
- 强化 `quality:docs-i18n`：所有非 archive/private 的 canonical docs 必须在 `docs/documentation-migration-map.md` 中声明中文 mirror，中文 mirror 必须带 `source_sha256`，并检查英文 prose 不含 CJK、中文 prose 含 CJK、heading shape parity 和 orphan `docs/zh/**`。
- 继续收紧 `quality:docs-i18n`：阻止 canonical English prose 中的 CJK/fullwidth punctuation，并要求中文 mirror 具备实质中文正文，避免只靠少量中文标题绕过检查。
- 补齐 `docs/zh/**` 中文镜像树，以 `docs/` 英文 canonical docs 为准维护当前 source hash 和 frontmatter parity。
- 清理 `docs/plans/2026-05-14-agent-run-manager.md` 的机器翻译噪音，重写英文 canonical 版本并同步中文 mirror。
- 文档策略收尾：`docs/zh/**` required 中文 pair 全部提升为 `translation_status: current`，并让 `quality:docs-i18n` 阻止 missing / pending required translations。
- `quality:website-docs` 收紧为 blocking gate：canonical docs 变更影响 website page 时，必须同 patch 更新对应 website page、显式标记 unaffected reason，或使用紧急 bypass。
- 文档迁移收尾：`docs/features/*.md` 统一归档到 `docs/archive/features/`，早期平铺中文翻译迁移到 `docs/zh/plans/` 或 `docs/zh/archive/**`，并补齐标准 frontmatter。
- GitHub Pages workflow 增加 Pages 配置 preflight；仓库未启用 Pages 时保留 website build/artifact 成功路径，跳过 deploy 而不是在 `actions/configure-pages` 阶段失败。

### Security
- 收窄 npm publish 打包边界，避免 `.claude/`、`.github/`、测试 fixtures、`docs/plans/` 和本机 review copy 被意外发布。
- 公开 docs/config 示例改用占位 channel ID 和通用路径，并让 G0 阻止 raw Discord snowflake 或本机用户目录路径进入公开文档。

### Changed
- Connectivity monitor 的 Discord/VPN/proxy outage/recovery alert 改为在 general network 仍可达时通过 Weixin direct channel 发送，SMTP 仅保留为诊断 probe/独立 notifier。
- Weixin Smart Router 的 chat 分支改为优先走轻量 LLM API path，先尝试 Anthropic/OpenAI-compatible chat completions，再 fallback 到配置的 agent runtime，避免普通聊天加载完整 Codex task 上下文。
- 将 stock provider 文档重组为压缩的 data-system 结构：`README`、`data-and-sources`、`workflows`、`operations-and-security` 四篇文档统一描述数据源、标准数据语义、数据产品、cron workflow、运维与账号安全边界，并同步中文 mirror、migration map 和 website trace docs。
- 以 English canonical 重写当前核心 docs：`docs/README.md`、`docs/architecture.md`、`docs/bot-routing.md`、`docs/chat-router-current-logic.md`、`docs/install-distribution-strategy.md`、`docs/prompts.md` 和 `docs/quality-gates.md`；对应中文 mirror 同步为 `docs/zh/**`。
- 润色 `docs/zh/**` 中文 mirror 的章节标题和高频机器翻译术语，并标记受影响中文 website summary 为语义未变。
- 扩展 stock provider 数据层迁移计划，补充 ownership cleanup 的分阶段执行清单、验收标准、验证命令和回滚策略，并同步中文 mirror。
- 新增股票 `market-context` rolling memory provider，用于每日维护 A 股、港股、美股和跨市场长期摘要，并通过 cron `pre_context_providers` 注入股票任务。
- 股票 provider 实现迁移到 `src/stock/` 四层结构：`src/providers/*/index.ts` 保持 cron 兼容入口，Source Adapter、Data Domain、Signal / Intelligence 和 Report Composer 逻辑进入 `src/stock/sources`、`src/stock/data`、`src/stock/signals` 和 `src/stock/reports`。
- 继续收敛股票 provider 数据边界：`stock-pulse` universe/watchlist source、market-intel calendar/quotes/portfolio/official collectors、Eastmoney ETF premium client 和 Yahoo watchlist research client 从 `src/providers/*` 迁入 `src/stock/data` 与 `src/stock/sources`。
- 完成 stock provider ownership cleanup：provider-owned stock types、portfolio/market-intel/broker formatters、portfolio chart、market-intel calibration 和 forecast calibration 迁入 `src/stock/data`、`src/stock/signals`、`src/stock/reports`，provider 侧保留 config 与兼容 re-export facades。
- 删除最终 stock provider compatibility facades：`src/providers/*` 顶层只保留 stock provider 的 `index.ts` 和 `config.ts` 边界，cron/store/config/tests 改为直接引用 `src/stock/data`、`src/stock/signals` 和 `src/stock/reports`。
- coverage ratchet 的 stock 阈值同步迁到 `src/stock/reports`，避免继续以已删除的 provider compatibility facades 作为质量门目标。
- `quality:website-docs` 支持 `trace_docs` 和集中 unaffected ack，让内部 docs 小改不再默认牵引 website 正文更新。
- App Trending 默认频道从 `daily-app-trending` 改为 `weekly-app-trending`，频道初始化脚本会把旧频道原地重命名并清理旧 channel-map key。

### Fixed
- 修复 Weixin 官方 CDN 媒体协议兼容：入站图片/语音会读取 `media.full_url`、`media.encrypt_query_param` 和 `aes_key`，下载后按 AES-ECB 解密，语音尽量从 SILK 转 WAV 后再送入附件处理链路。
- Weixin outbound `sendFile` 改为官方 `getuploadurl -> CDN AES upload -> sendmessage` 链路，并把 caption 与媒体按官方行为拆成独立 `sendmessage` item。
- Weixin `getupdates` 遇到 `errcode=-14` / session expired 时会暂停该账号 1 小时，不再按普通 poll failure 每 30 秒持续重试。
- 关闭 Discord transport 时 runtime config 不再强制要求 `DISCORD_TOKEN`、`DISCORD_CLIENT_ID`、`DISCORD_GUILD_ID` 和 `MINICLAW_ALLOWED_USER_ID`，Weixin 可作为独立 IM 入口启动。
- Weixin QR 登录会带上本地最近 bot token，二维码过期后自动刷新，登录成功后清理同一 `ilink_user_id` 的旧账号 state。
- Weixin chat 在长回复期间会通过 `getconfig` 获取 typing ticket，并用 `sendtyping` 发送/取消输入状态，避免用户在等待 LLM 回复时完全无反馈。
- Weixin task view 的 start/progress/final/error 投递改为 best-effort：发送失败只记录 warning 并重试一次，不再把微信发送错误抛回 agent runtime 导致 task 被标记失败。
- Weixin task 结果投递遇到 `sendmessage -2` 时会对失效 context token 做无 context 重试；final 仍失败时写入 recovery outbox，并在下一次 Weixin 入站消息刷新 context 后自动补发，同时 task 执行期间持续发送 typing keepalive 降低长任务 context 过期概率。
- 修复 `market-calibration` CLI 的 import 漂移，改为引用迁移后的 `src/stock/signals/forecast-calibration` 和 `market-intel-calibration`。
- 移除 website landing page 中过细的内部 Discord channel slug，让 website 保持对外项目窗口定位。
- 精简 website runtime/landing 文案，让公开网站只保留高层能力说明。
- 修复根 README 的文档漂移：同步当前 slash commands、provider 列表、`docs/providers/**` 链接和最新项目结构。
- 修复 `stock-watchlist-research` 对 Futu broker watchlist 的采集：同一 profile/groups 只抓取一次后按市场分流，避免 CN source 为空或 OpenD 限频时吞掉 HK/US watchlist，并把 broker source 不可用与真实空 watchlist 区分为不同 skip reason。
- Discord 消息分块现在会保留 `<https://...>` no-embed 链接语义，不再把 browser tabs cron 的 no-embed 链接重新收集成裸 URL 预览区。
- Discord IM fanout、recovery outbox 和 script cron 直发路径统一使用延后链接预览分块，避免长 cron 报告被中途展开的链接卡片切断。

---

## [1.0.0] — 2026-05-13

### Added
- 新增 `~/.miniclaw/config.yaml` 分层配置支持和 `config.example.yaml` 模板，推荐把结构化 MiniClaw 设置从扁平 `.env` 迁移到 YAML。
- `MINICLAW_TASK_CHANNELS` 支持专用 Discord task intake 频道：频道内普通消息无需 `@MiniClaw`，会自动创建 task thread 并走 `/task` 同一套执行和输出链路。
- `CLAUDE.md` 增加 docs-first development planning 规则，要求非平凡开发先在 `docs/plans/` 写计划文档，再改业务代码；新增 `docs/plans/README.md` 模板。
- 新增 `README.en.md` 英文版 README，并在中文 `README.md` 顶部加入语言切换入口。
- `wechat-mp` pre-provider 文档同步到当前实现：9:00 / 17:00 固定窗口、9 个公众号账号列表、登录态刷新、dry-run 采集和 dedupe state 说明。
- Discord `/task` 输出文档增加当前落地状态和 E2E 回归记录：状态 embed、persistent progress message、普通 Markdown 最终结果三层输出。
- README 增加 `/agent-config`、Codex `inherit`、Claude setting sources / hooks、MCP allowlist、WeChat 频道配置入口说明。
- 新增 Smart Task Router：chat 入口可识别自然语言 task prompt，使用确认按钮升级到 `/task` 线程；支持 per-channel cwd、LLM classifier、内存确认态和 SQLite redacted decision log。

### Changed
- 配置加载优先级调整为“内置默认值 < YAML < env override”；旧 `MINICLAW_*` env 继续兼容，MCP config path / allowlist 也收敛到主配置对象。
- `/task`、task intake channel、smart-router 确认升级共用 `src/discord/task-intake.ts`，减少任务线程创建链路重复。
- `docs/architecture.md` 同步当前架构：`/agent-config` runtime summary、Codex/Claude 本机配置继承、cron `pre_provider` 链路、`~/.miniclaw/providers` 与 `secrets` 用户级目录。

### Fixed
- `/cancel` 后任务最终状态不再被 `executeTask()` 收尾逻辑覆盖成 `failed`；取消路径统一落库为 `cancelled`。
- Thread continuation 查询同一线程最近 session 时增加 `rowid DESC` 兜底排序，避免同一秒内多条 task 造成恢复到旧 session。
- Claude 轻量 chat 的 memory extraction 现在尊重 `ANTHROPIC_BASE_URL`，与主 chat 路径代理行为一致。

### Security
- 收紧 `chat` 路径的 `bash` 工具：拒绝重定向、文件写入/删除、`sudo`、修改 git 状态和包管理器执行/安装命令，避免轻量对话承担 `/task` 的写权限职责。
- 强化 `web_fetch` 内网地址识别：补充 IPv6 bracket、尾点 localhost、ULA IPv6 等私网形式。

### Changed
- 配置解析对 `MINICLAW_MAX_CONCURRENT_TASKS` / `MINICLAW_MAX_ATTACHMENTS` 使用正整数校验，对 `MINICLAW_MAX_ATTACHMENT_MB` 使用正数校验，避免非法 env 静默变成 `NaN`。

### Changed
- **Supervisor 灵活化重构**（task.ts + agents/*.md）—— 把"四阶段流水线"prompt 改成"能力图谱 + 选择原则"
  - 删除 Supervisor prompt 中"推荐工作流 1.Researcher → 2.Planner → 3.Generator → 4.Evaluator"硬编码
  - 删除"任何代码改动必须 Evaluator 验收""复杂度 >3 文件必须 Contract"等强制规则，改为按风险/任务规模自由判断
  - Verdict YAML 改为 **opt-in**：Supervisor 显式要求时 evaluator 才输出，默认自然语言总结
  - 4 个角色的 prompt 解除上下游硬绑定（planner 不再要求"必须有 Researcher Findings"、generator 不再"缺 Plan 立即拒绝"、evaluator 描述去掉"无例外"）
  - researcher 解锁 15 次工具调用硬上限 + 输出格式不再强制简短 Findings 模板
- **canUseTool 扩展**：拦截高风险 Bash（`rm -rf /` / `sudo` / `npm publish` / `git push --force`）；每个 subagent 角色调用 cap（默认 4 次/角色，env `MINICLAW_SUBAGENT_ROLE_CAP` 可调）防失控循环
- **Telemetry**：task 结束日志新增 `subagents=[role1→role2→...]` 字段，便于事后观察 LLM 实际编排路径

### Added
- **Prompt 资产管理体系**（`prompts/` + `src/agent/prompts.ts` 加载器）—— 把硬编码在 .ts 里的长 system prompt 全部搬到 markdown 文件
  - **B 类（中长 system prompt）→ 文件化**：`supervisor.md` / `memory-extractor.md` / `stage-manager.md`
  - **D 类（cron 模板）→ `templates/cron-*.md` + `{{var}}`**：复用 cron 已有 renderTemplate
  - **C 类（极短 / 高度动态片段）→ 留代码但抽常量**：`src/agent/identity.ts` 集中 chat/task identity 文案
  - 加载器特性：mtime cache 热重载 / `MINICLAW_PROMPT_CACHE=strict` 关闭 stat / vars 双向校验（body ⊆ vars && caller ⊆ vars）/ 加载失败 throw 含 hint
  - 用户级覆盖：`~/.miniclaw/prompts/<name>.md` 优先于 repo `prompts/<name>.md`（含子目录）
  - 公共 markdown 解析提到 `src/lib/markdown.ts`，subagents/personas/prompts 三方共用
  - 新增 11 个 sha256 inline snapshot 测试（`prompt-snapshot.test.ts`）锁定字节，防"无意中破坏 prompt 行为"
  - 新增 8 个 prompts.ts unit test（happy path / 缺文件 / vars 校验 / 热重载）
  - 详见 `docs/prompts.md`
- **`agents/code-investigator.md`** —— 带 Bash 的深度调研角色，可 `git clone` + Bash 遍历仓库，补 researcher 工具短板（如调研外部 GitHub 项目）

### Added
- **Stage 子系统**（`pnpm stage` / `pnpm stage:repl`）—— CLI 多 agent 群聊控制台
  - Ink TUI 4 pane（Roster / Stream / Detail / CommandBar），实时 spinner / 状态色 / streaming
  - Persona 角色卡（`personas/*.md` + `~/.miniclaw/personas/*.md`），MVP 自带 CEO / Engineer / Tester
  - @-driven routing：`@persona` 消息自动入队对应 agent；agent 回复内 `@` 自动接力
  - 可选 Stage Manager 自动模式（`/auto`）：独立小成本 LLM 决策 next_speaker（user/persona/end）
  - 三层反失控 cap：连续 same-speaker / total turns / total cost USD（env 可调）
  - 持久化双轨：`~/.miniclaw/scenes/<name>.md` markdown + DB（`scenes` + `scene_messages` 两表）
  - 13 个 slash 命令（/summon /dismiss /say /all /abort /auto /manual /save /load /roster /cost /clear /q）
  - 31 个新单测覆盖 personas/agent/orchestrator/scene-store/stage-manager
  - 完全复用 chat-tools / memory / log / db / config，路径独立不污染 Discord 子系统
  - 详见 `docs/stage.md`
- **Cron 状态持久化**（`~/.miniclaw/cron/state.json`）
  - 每次 dispatch 后自动写入 `last_run_at` / `last_status` / `last_error` / `last_duration_ms` / `completed` 累计计数
  - 重启不丢历史；`pnpm cron:list` 显示 `[✓ ran 35× · last ok 04-28 09:00 12.3s]`
  - 8 个新增测试覆盖 state（read/write/atomic/累加/损坏文件容错/error 截断）
- **第一个 cron job：`github-trending`** —— 9:00 抓 GitHub Trending 生成中文简报到 #常规（照搬 hermes 同款 prompt）

### Added (前次)
- **Cron 定时任务支持**（`~/.miniclaw/cron/*.yaml`）
  - 4 种 type：`task`（跑 /task 流程）/ `script`（执行 ~/.miniclaw/scripts/）/ `skill`（调用用户级 subagent）/ `message`（模板化 Discord 消息）
  - 调度引擎：`node-cron` 进程内，SIGTERM 时优雅关闭
  - 模板变量：`{{date}}` `{{weekday}}` `{{time}}` `{{cron.name}}` + 自定义 args
  - script 安全：仅 `~/.miniclaw/scripts/` 下可执行文件、禁路径分隔符、timeout 默认 5 min/上限 30 min
  - CLI：`pnpm cron:list`（列状态）`pnpm cron:test <name>`（立刻试跑不影响调度）
  - 16 个新增测试覆盖 loader（YAML 解析 / schema 校验 / 错误隔离）+ template
- **用户级 skills 加载**（`~/.miniclaw/skills/*.md`）
  - `loadSubagents()` 现在合并扫 repo `agents/` + user `~/.miniclaw/skills/`
  - 同名 user skill 覆盖 repo subagent（带 console.warn 提示）

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
