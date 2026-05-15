---
doc_id: connectivity-monitor-email-fallback-plan
lang: zh
translation_of: docs/plans/2026-05-08-connectivity-monitor-email-fallback.md
translation_status: current
source_sha256: 0e45b0fbf6cd69a67b27f363db2abd28f5c5adbab7a0605feeb1b28e34f5b63f
---
# 带电子邮件回落的连接监视器

现况:已完成
日期:2026-05-08

## 背景情况

MiniClaw cron/任务输出取决于Discord. 用户经常需要VPN/代理连接Discord;当该链接下降时,cron任务可能仍然在本地运行,但Discord发送会失败. 现有的 crund 失败提醒也使用 Discord,因此无法报告 Discord 退出 。

## 目标

1. 增加一个每30-60秒运行一次的流程内连接显示器。
2. 检查Discord网关准备情况、Discord REST可达性、一般HTTPS可达性以及SMTP可达性。
3. 长期消毒状态`~/.miniclaw/runtime/connectivity.json`.
4. 在连续三次失败后,当一般网络和SMTP可以达到但Discord不能达到时,发送波段外电子邮件提醒。
5. 一旦Discord连接恢复,就发送恢复邮件。
6. 将此与 cron 工作和只读的电子邮件查询能力分开。

## 非目标

- 切片中不要执行启动/pm2外部监视器。
- 不要自动重联VPN。
- 不要定期发送Discord心跳信息。
- 不将 SMTP 证书保存在运行时状态或日志中。
- 不更改 cron YAML 格式。

## 现有建筑证据

- `src/index.ts`启动 Discord 机器人和调度器后`ClientReady`.
- `src/cron/scheduler.ts`处理 crun 重试和 Discoord 失败按钮。
- `src/capabilities/email`被故意只读,并且应当保持只读。
- 项目已经支持分层`~/.miniclaw/config.yaml`配置通过`src/config.ts`.

## 执行计划

1. 扩展配置`connectivity`和`notifications.email`设置,包括后向兼容`email.smtp_*`键。
2. 增加通用SMTP通知模块`src/notifications/`.
3. 添加纯连接核心职能,用于分类、状态持久性和电子邮件主题/机构生成。
4. 添加运行时显示器,将核心绑定在Discord客户端检查和SMTP/HTTPS探测器上.
5. 启动/停止监视器`src/index.ts`;默认跳过 E2E 模式。
6. 添加配置解析、分类、提醒/恢复电子邮件和SMTP消息行为的单位测试。
7. 更新架构/电子邮件文件。

## 核查计划

- `pnpm vitest run src/monitoring src/notifications src/__tests__/config.test.ts`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run e2e:cron`

## 风险 倒车

- 风险:如果检查过于严格,SMTP认证或供应商费率限制。
– 缓解:默认间隔为60s;SMTP检查是只可达的,而实际的auth只在发出警报时使用.
- 风险:在短时间VPN重联时出现假阳性.
- 缓解:只有在可预知的连续失败,默认3之后才发出警报。
- 风险:缺少电子邮件配置使得无法回落.
- 缓解:显示器仍然写有状态和日志的消毒警告;没有启动失败。
- 回滚: 禁用`connectivity.enabled: false` or `MINICLAW_CONNECTIVITY_MONITOR_ENABLED=false`.

## 文档同步

- `docs/architecture.md`: 监视和运行时状态.
- `docs/archive/features/07-email-capability.md`:澄清SMTP通知符与只读的电子邮件功能是分开的.
- 必要时为连通性监测器添加特性文件。

## 执行笔记

- 已执行`connectivity`和`notifications.email`配置,包括向后兼容的顶级`email.smtp_*`设置。
- 已经添加了`src/notifications/smtp-email.ts`作为系统警报的通用SMTP通知符. 它与只读的电子邮件能力是分开的.
- 已经添加了`src/monitoring/connectivity-core.ts`纯粹的分类/状态/警戒逻辑。
- 已经添加了`src/monitoring/connectivity-monitor.ts`并开始/停止整合`src/index.ts`.
- 为配置解析、连接分类/待命和SMTP信息帮助者增加单元测试。
- 核实:
  - `pnpm run typecheck`
  - `pnpm vitest run src/monitoring src/notifications src/__tests__/config.test.ts`
  - `pnpm run lint`
  - `pnpm run e2e:cron`
  - `pnpm run quality:g0`
  - `pnpm run quality:secrets`
