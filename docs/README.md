# MiniClaw Docs Index

> 结论：顶层文档只保留 MiniClaw 的整体设计入口；具体能力、子系统、provider 和业务 feature 统一放到 `docs/features/` 下。历史实施计划保留在 `docs/plans/`，过期审计/报告保留在 `docs/archive/`，私有调研保留在 `docs/private/`。

## Core Design

- [`architecture.md`](architecture.md): MiniClaw 全局架构、数据流、cron、DB、用户级目录。
- [`bot-routing.md`](bot-routing.md): Discord Gateway、message、slash command、thread continuation、chat/task routing。
- [`chat-router-current-logic.md`](chat-router-current-logic.md): 当前 chat router 的代码级判断逻辑、capability 映射、确认按钮和真实误分流边界。
- [`install-distribution-strategy.md`](install-distribution-strategy.md): 面向外部用户的安装、配置向导、Release artifact 和本机 Deploy 改造建议。
- [`prompts.md`](prompts.md): 框架级 prompt 资产管理。
- [`quality-gates.md`](quality-gates.md): 测试分层、质量门禁、Discord E2E 方案。

## Features

- [`features/01-stage.md`](features/01-stage.md): Stage 实验性 CLI 多 agent 控制台及 Discord runtime 边界。
- [`features/02-wechat-mp-provider.md`](features/02-wechat-mp-provider.md): 微信公众号文章采集 pre-provider。
- [`features/03-discord-task-output.md`](features/03-discord-task-output.md): Discord task 输出、进度和 embed 设计。
- [`features/04-smart-task-router.md`](features/04-smart-task-router.md): Smart Task Router 中文设计。
- [`features/05-smart-task-router.en.md`](features/05-smart-task-router.en.md): Smart Task Router English design.
- [`features/06-futu-stock.md`](features/06-futu-stock.md): 富途股票账户只读查询 MCP / provider。
- [`features/07-email-capability.md`](features/07-email-capability.md): 通用只读 Email capability。
- [`features/08-cmb-credit-card-email-provider.md`](features/08-cmb-credit-card-email-provider.md): 招商信用卡邮件消费解析 provider。
- [`features/09-eastmoney-jywg-readonly-provider.md`](features/09-eastmoney-jywg-readonly-provider.md): 东方财富 JYWG 只读查询 provider。
- [`features/10-stock-portfolio-provider.md`](features/10-stock-portfolio-provider.md): 多券商股票账户聚合 provider。
- [`features/11-stock-pulse-provider.md`](features/11-stock-pulse-provider.md): 股票盘中 hourly 异动扫描 provider。
- [`features/12-connectivity-monitor.md`](features/12-connectivity-monitor.md): Discord / 网络 / SMTP 链路探测与 Email fallback 告警。
- [`features/13-auto-doctor.md`](features/13-auto-doctor.md): task / cron / PM2 / 日志 / connectivity 的只读运行态诊断。
- [`features/14-market-intel-provider.md`](features/14-market-intel-provider.md): CN/US 盘前市场情报、forecast persistence、盘后评价与 calibration loop。
- [`features/15-ralph-controller.md`](features/15-ralph-controller.md): plan-based fresh-context Codex execution controller。
- [`features/16-provider-framework.md`](features/16-provider-framework.md): provider manifest、health check、dry-run、structured output 和兼容 adapter。
- [`features/17-eastmoney-myfavor-watchlist.md`](features/17-eastmoney-myfavor-watchlist.md): 东方财富 MyFavor 自选股只读源，接入 stock-pulse universe。
- [`features/18-stock-watchlist-research-provider.md`](features/18-stock-watchlist-research-provider.md): 券商 watchlist stock 盘前/每日深度研究 provider，独立推送到 daily-watchlist-stock。
- [`features/19-agent-prompt-context-audit.md`](features/19-agent-prompt-context-audit.md): Codex / Claude Code chat、task、cron prompt 与上下文注入审计。
- [`features/20-memory-curation-lifecycle.md`](features/20-memory-curation-lifecycle.md): memory 自动抽取候选校验、去重合并、生命周期 metadata 和定期 maintenance。
- [`features/21-agent-run-manager.md`](features/21-agent-run-manager.md): task-scoped Agent Run Manager、Agent Bus、ACP lifecycle、managed runtime routing 与 guardrails。

## Plans

- [`plans/README.md`](plans/README.md): 非平凡开发任务的 plan 文档规范。
- [`plans/2026-05-15-documentation-strategy.md`](plans/2026-05-15-documentation-strategy.md): `docs/` 作为 LLM 维护的 docs-driven development source of truth，GitHub Pages 作为 human-facing portal 的分层策略。
- `plans/YYYY-MM-DD-*.md`: 已完成或进行中的实施计划。

## Archive

- [`archive/2026-05-11-continuous-improvement-report.md`](archive/2026-05-11-continuous-improvement-report.md): 2026-05-11 架构审计和持续优化历史报告；不再作为当前 source of truth。

## Runbooks

- [`runbooks/install.md`](runbooks/install.md): MiniClaw 1.0 面向技术用户的安装、配置和故障排查流程。
- [`runbooks/local-deploy.md`](runbooks/local-deploy.md): 本机 PM2 runtime 的安全 deploy、safe restart、回滚和验证流程。

## Private

- `private/eastmoney/`: 东方财富相关私有调研和敏感设计边界。

## Placement Rules

- 全局架构、路由、工程治理和 framework-level prompt 文档放在 `docs/` 顶层。
- 用户可见子系统、业务能力、capability 和 provider 文档全部放在 `docs/features/`，不再创建子级目录。
- feature 文件使用两位阿拉伯数字前缀，按实现顺序从 `01-` 开始递增。
- 实施计划只放 `docs/plans/`，不要与当前设计文档混放。
- 过期审计报告、历史复盘和不再维护的全局路线图放在 `docs/archive/`，不能替代当前 source-of-truth 文档。
- 可执行运维流程放在 `docs/runbooks/`。
- 含账户、cookie、交易后台细节的私有调研放 `docs/private/`。
