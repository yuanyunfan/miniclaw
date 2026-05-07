# MiniClaw Email Capability

> 结论：Email 是 MiniClaw 的基础只读数据能力，不属于某个具体日报业务。招商信用卡消费分析、发票归档、账单汇总、订阅邮件摘要都应该复用这一层。

## 设计边界

`src/capabilities/email` 只负责邮箱基础能力：

- 读取邮箱 profile 配置。
- 读取独立 secret 文件。
- 只读查询邮件。
- 解析 MIME 正文和附件元数据。
- 维护 message-level dedupe state。
- 对日志和 provider 输出做脱敏。

它不负责：

- 招商银行/信用卡业务解析。
- Discord 文案生成。
- 发送、删除、移动、标记已读、回复或转发邮件。

## 当前支持

第一版只实现 IMAP adapter：

```text
src/capabilities/email/
  config.ts
  query.ts
  state.ts
  redaction.ts
  clients/imap.ts
```

Gmail API 和 Microsoft Graph 适合后续增加 adapter，但不在第一版实现中。

## 配置

邮箱 profile 配置文件：

```text
~/.miniclaw/capabilities/email/config.yaml
```

示例：

```yaml
profiles:
  cmb-notify:
    provider: imap
    account_alias: cmb-notify
    secret_path: "~/.miniclaw/secrets/email/cmb-notify.json"
    folders:
      - INBOX
    allowed_senders:
      - "cmbchina.com"
      - "cmbchina.com.cn"
    subject_allowlist:
      - 信用卡
      - 消费
      - 账单
    max_lookback_days: 7
    max_results: 50
    body_max_bytes: 512000
    raw_body_retention: none
    attachment_policy: none
    redaction: strict
    state_path: "~/.miniclaw/capabilities/email/cmb-notify-state.json"
    imap:
      host: "imap.example.com"
      port: 993
      secure: true
```

Secret 文件：

```text
~/.miniclaw/secrets/email/cmb-notify.json
```

示例：

```json
{
  "username": "your-dedicated-mailbox@example.com",
  "password": "<mail-app-password>"
}
```

不要把 secret 写入 repo、Discord、cron YAML 或 provider YAML。

## 通用 Email Query Provider

`email-query` 是一个通用 `pre_provider`，适合受控地把邮件查询结果注入 cron task。

配置目录：

```text
~/.miniclaw/providers/email-query/default.yaml
```

示例：

```yaml
email_profile: cmb-notify
folders:
  - INBOX
from:
  - "*.cmbchina.com"
subject_includes:
  - 信用卡
window_hours: 24
max_results: 20
include_body: false
include_attachments: false
dedupe: true
state_path: "~/.miniclaw/providers/email-query/default-state.json"
```

Cron 示例：

```yaml
name: daily-email-digest
schedule: "30 22 * * *"
timezone: Asia/Shanghai
enabled: true
type: task
channel: "<discord-channel-id>"
pre_provider: email-query
pre_provider_config: default
prompt: |
  根据上方邮件元数据生成简洁摘要。
  不要输出邮箱地址、原始正文、验证码或 token。
```

## 安全策略

- 只读 IMAP：连接 mailbox 时使用 `readOnly: true`。
- 不提供写操作：没有 send/delete/move/mark-read/reply/forward API。
- Secret 和配置分离。
- 默认 `raw_body_retention: none`。
- 默认 provider 输出不包含正文。
- `email-query` 在 `include_body: false` 时也不会输出正文派生的 `snippet`。
- state 只保存 hash、UID、subject hash 和时间。

## 验证

相关测试：

```bash
pnpm vitest run src/capabilities/email src/providers/email-query
```

完整验证：

```bash
pnpm build
pnpm test
```
