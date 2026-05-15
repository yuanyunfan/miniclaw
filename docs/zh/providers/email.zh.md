---
doc_id: email-provider-family
lang: zh
translation_of: docs/providers/email.md
translation_status: pending
---

# Email Provider Family

> 这个中文文档当前是 tracked 摘要，占位对应 `docs/providers/email.md`。英文 source 已合并通用只读 Email capability、`email-query` 和 `cmb-credit-card-email` 两个 legacy feature 文档；完整翻译完成后再把 `translation_status` 改为 `current`。

MiniClaw 的 Email 集成分成三个边界：

- `src/capabilities/email/**`: 通用只读邮箱能力，负责 profile config、secret 分离、IMAP 查询、MIME 正文解析、附件 metadata / allowlisted text extraction、redaction 和 message-level dedupe state。
- `email-query`: 通用 cron `pre_provider`，把受控邮件查询结果注入 task prompt；正文和附件默认不输出，需要显式配置。
- `cmb-credit-card-email`: 招商信用卡邮件业务 provider，从通知邮件中解析消费 / 退款记录，输出 totals、transactions、diagnostics、warnings，并可在没有新交易时跳过下游 LLM task。

核心 contract：

- Email capability 只读；不能 send、delete、move、mark-read、reply 或 forward。
- Secret 只放在用户本机 `~/.miniclaw/secrets/**`，不能写入 repo、Discord、cron YAML 或 provider YAML。
- 原始正文、原始附件正文、邮箱地址、完整卡号、cookie、token 和密码都不能进入 logs、Discord 或 LLM prompt。
- `email-query` 和 `cmb-credit-card-email` 的 dedupe state 只有在下游 task 成功后才 commit。
- CMB provider 不是银行账务 API；邮件延迟、模板变化、退款、撤销、预授权和汇率手续费都可能导致结果与最终账单不同。

迁移状态：

- `docs/features/07-email-capability.md` 已变成兼容 stub，当前事实维护在英文 family doc 的 Shared Email Capability 和 Generic Email Query sections。
- `docs/features/08-cmb-credit-card-email-provider.md` 已变成兼容 stub，当前事实维护在英文 family doc 的 CMB Credit-card Email Provider section。
- 中文完整翻译仍是 pending；在此之前，英文 `docs/providers/email.md` 是该 family 的实现事实来源。
