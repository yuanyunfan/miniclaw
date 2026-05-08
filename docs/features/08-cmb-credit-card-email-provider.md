# CMB Credit Card Email Provider

> 结论：招商信用卡消费分析应该作为 Email capability 的业务 consumer 实现。它只解析招商信用卡通知邮件，输出结构化消费记录，再由 cron task 汇总到 Discord。

## 架构

```text
招商信用卡邮件通知
        ↓
src/capabilities/email
        ↓
src/providers/cmb-credit-card-email
        ↓
cron pre_provider
        ↓
LLM 生成 Discord 摘要
```

Email capability 负责读邮箱，CMB provider 负责解析消费。

## 配置

业务配置目录：

```text
~/.miniclaw/providers/cmb-credit-card-email/default.yaml
```

示例：

```yaml
email_profile: cmb-notify
folders:
  - INBOX
from:
  - "cmbchina.com"
  - "cmbchina.com.cn"
subject_includes:
  - 招商
  - 信用卡
  - 消费
  - 账单
window_hours: 24
max_results: 50
currency: CNY
large_transaction_threshold: 1000
dedupe: true
state_path: "~/.miniclaw/providers/cmb-credit-card-email/default-state.json"
```

邮箱连接配置放在：

```text
~/.miniclaw/capabilities/email/config.yaml
```

邮箱 secret 放在：

```text
~/.miniclaw/secrets/email/cmb-notify.json
```

## Cron 示例

```yaml
name: daily-cmb-credit-card
schedule: "30 22 * * *"
timezone: Asia/Shanghai
enabled: true
type: task
channel: "<private-discord-channel-id>"
pre_provider: cmb-credit-card-email
pre_provider_config: default
prompt: |
  根据上方招商信用卡邮件解析结果，生成今日消费摘要。

  要求：
  - 不输出邮箱地址、完整卡号、原始邮件正文。
  - 先给总消费、退款、净消费和交易笔数。
  - 列出大额消费和可能异常项。
  - 说明结果基于邮件通知解析，最终以银行账单为准。
```

## 输出字段

Provider 输出 JSON 包含：

- `transaction_count`
- `total_spend`
- `total_refund`
- `net_spend`
- `large_transactions`
- `transactions`
- `warnings`

单笔交易包含：

- `occurred_at`
- `direction`: `spend` 或 `refund`
- `amount`
- `currency`
- `merchant`
- `card_tail_hash`
- `message_id_hash`

不会输出：

- 邮箱地址。
- 原始邮件正文。
- 完整卡号。
- 卡尾号明文。
- 邮箱密码、token、cookie。

## 准确性限制

这不是银行账务 API，而是邮件通知解析。

可能的偏差：

- 招商邮件模板变化导致解析失败。
- 邮件延迟或漏发。
- 退款、撤销、预授权、分期、汇率和手续费可能与最终账单不同。
- 如果每日通知邮件只含总览，不含每笔交易，只能按总览能力解析。

建议后续增加月度 reconciliation：用电子账单和每日邮件流水对账。

## 当前解析策略

第一版 parser 支持常见中文通知文本：

- 金额：`人民币68.50元`、`¥68.50`、`68.50元`
- 时间：`2026年05月07日 19:31`、`05月07日 19:31`
- 卡尾号：`尾号****` 这类末四位字段；实现中只保留 hash，不输出明文尾号。
- 商户：`商户：星巴克`
- 方向：命中 `退款/退货/冲正/返还/撤销/退回/收入` 视为 refund，否则视为 spend。

真实样例到位后，应通过单元测试持续补 parser。

## 验证

```bash
pnpm vitest run src/providers/cmb-credit-card-email
pnpm build
pnpm test
```
