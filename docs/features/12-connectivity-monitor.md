# Connectivity Monitor 与 Email Fallback

> 结论：Connectivity Monitor 用来发现 “MiniClaw 还活着但 Discord 链路不可用” 的问题。它不会在 Discord 里刷心跳消息，而是在本机后台探测 Discord / 普通网络 / SMTP，并在 Discord 不通但邮件可用时用 Email 发送 out-of-band 告警；Discord 恢复后会补发 outage 期间错过的 cron 失败汇总和 pending task 结果。

## 目标

- 每隔一段时间轻量检查 Discord gateway、Discord REST、普通 HTTPS 网络和 SMTP reachability。
- 把最近状态写入 `~/.miniclaw/runtime/connectivity.json`。
- 连续失败达到阈值后，如果普通网络和 SMTP 可用但 Discord 不可用，发送邮件告警。
- Discord 恢复后发送一次恢复邮件。
- Discord 可用时 flush `recovery_outbox`：补发 missed cron failure summary 和 raw task result delivery。

## 非目标

- 不实现 launchd / pm2 外部 watchdog。
- 不自动重连 VPN。
- 不定时往 Discord 频道发心跳消息。
- 不把 SMTP 密码写入 runtime state、日志或 Discord。

## 配置

推荐配置放在 `~/.miniclaw/config.yaml`：

```yaml
connectivity:
  enabled: true
  interval_ms: 60000
  failure_threshold: 3
  request_timeout_ms: 10000
  general_test_url: "https://www.qq.com"
  state_path: "~/.miniclaw/runtime/connectivity.json"

startup_watchdog:
  enabled: true
  client_ready_timeout_ms: 60000
  macos_notification_enabled: true

notifications:
  email:
    enabled: true
    smtp_host: "smtp.qq.com"
    smtp_port: 465
    use_ssl: true
    username: "your@qq.com"
    password: "<mail-app-password>"
    from: "your@qq.com"
    to: "your@qq.com"
```

兼容旧配置：

```yaml
email:
  smtp_host: "smtp.qq.com"
  smtp_port: 465
  use_ssl: true
  username: "your@qq.com"
  password: "<mail-app-password>"
  to: "your@qq.com"
```

对应环境变量：

- `MINICLAW_CONNECTIVITY_MONITOR_ENABLED`
- `MINICLAW_CONNECTIVITY_INTERVAL_MS`
- `MINICLAW_CONNECTIVITY_FAILURE_THRESHOLD`
- `MINICLAW_CONNECTIVITY_REQUEST_TIMEOUT_MS`
- `MINICLAW_CONNECTIVITY_GENERAL_TEST_URL`
- `MINICLAW_CONNECTIVITY_STATE_PATH`
- `MINICLAW_STARTUP_WATCHDOG_ENABLED`
- `MINICLAW_STARTUP_WATCHDOG_CLIENT_READY_TIMEOUT_MS`
- `MINICLAW_STARTUP_WATCHDOG_MACOS_NOTIFICATION_ENABLED`
- `MINICLAW_NOTIFY_EMAIL_ENABLED`
- `MINICLAW_NOTIFY_EMAIL_SMTP_HOST`
- `MINICLAW_NOTIFY_EMAIL_SMTP_PORT`
- `MINICLAW_NOTIFY_EMAIL_USE_SSL`
- `MINICLAW_NOTIFY_EMAIL_USERNAME`
- `MINICLAW_NOTIFY_EMAIL_PASSWORD`
- `MINICLAW_NOTIFY_EMAIL_FROM`
- `MINICLAW_NOTIFY_EMAIL_TO`

## 状态分类

- `discord_ok`: Discord gateway 和 REST 都可用。
- `vpn_or_proxy_suspected`: 普通网络和 SMTP 可用，但 Discord 不可用；最常见原因是 VPN/proxy 链路断开。
- `discord_unreachable`: Discord 不可用，且 SMTP 未配置或不可用于判断。
- `general_network_down`: 普通 HTTPS 网络不可用。
- `smtp_unreachable`: Discord 可用但 SMTP 不可用；表示备用邮件通道不可用。
- `recovered`: 前一轮处于 outage，当前 Discord 恢复。

## 告警策略

默认 `failure_threshold=3`，即连续 3 次失败才发送邮件，避免 VPN 短暂重连造成误报。

邮件告警只在以下条件同时满足时发送：

- Discord gateway 或 REST 失败。
- 普通网络探测成功。
- SMTP reachability 探测成功。
- 已达到连续失败阈值。
- 当前 outage 尚未发过告警。

恢复邮件只在当前 outage 已发过告警，并且 Discord 恢复后发送一次。

## Recovery Outbox

`recovery_outbox` 是 Discord delivery 的恢复队列：

- `cron_failure_alert`: cron run 已失败，但失败 alert 没有成功投递到 Discord。记录条件包括 `alert_message_id IS NULL`，以及失败发生在 connectivity outage 窗口内，或当场发送 failure alert 时 Discord delivery 报错。
- `task_result_delivery`: raw task 已经完成并写入 `tasks.result_summary`，但最终结果投递 Discord 失败。此时 task 仍按 agent 执行结果结算，delivery 失败只进入 outbox。
- Connectivity Monitor 每次确认 `discord_ok` 或 `recovered` 时都会尝试 flush pending outbox；cron failure 按频道聚合成一条汇总，task result 按原 channel 补发。

这条路径解决的是“MiniClaw 运行中网络断开，恢复后补通知”。如果机器睡眠、进程未运行、或 cron scheduler 尚未启动，则不会凭空生成 cron run。

## Pre-clientReady Watchdog

Startup Watchdog 在 Discord `clientReady` 之前启动。它覆盖 bot 还没上线时的启动失败：

- `bot.login` 抛错时立即触发。
- `clientReady` 超过 `startup_watchdog.client_ready_timeout_ms` 未到达时触发。
- 当前 out-of-band 通道是本地 macOS notification，不依赖 Discord channel。

这条路径解决的是“MiniClaw 还没成功上线，所以内部 cron/connectivity/doctor 都还没启动”的盲区。

## 安全边界

- `connectivity.json` 只保存状态、时间、latency 和脱敏后的错误。
- SMTP 密码只从 `~/.miniclaw/config.yaml` 或环境变量读入内存，不写入 runtime state。
- Email fallback 是 `src/notifications/smtp-email.ts`，不属于 `src/capabilities/email` 只读邮箱查询能力。
- SMTP reachability 只检查连接/EHLO/STARTTLS；真正发送告警时才执行 SMTP AUTH。
- macOS notification 通过 `osascript display notification` 发送，只包含启动失败摘要，不包含 token/session/cookie。

## 验证

```bash
pnpm vitest run src/monitoring src/notifications src/__tests__/config.test.ts
pnpm run typecheck
pnpm run lint
```
