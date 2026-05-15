---
doc_id: content-provider-family
lang: zh
translation_of: docs/providers/content.md
translation_status: current
---

# Content Provider Family

> 结论：content providers 采集外部文章/内容 metadata、做 dedupe，并把可进入 prompt 的 context 格式化给 cron tasks。当前 content provider 是 `wechat-mp`；它通过用户控制的 web session 读取微信公众号后台文章 metadata，并且必须把 session file 当作敏感凭据。

## Data Flow

```mermaid
flowchart LR
  Session[mp.weixin.qq.com session] --> Collector[wechat-mp collector]
  Collector --> Accounts[Configured account queries]
  Accounts --> Normalize[Normalize article metadata]
  Normalize --> Window[Fixed time window filter]
  Window --> Dedupe[Dedupe state]
  Dedupe --> Payload[Provider payload]
  Payload --> Cron[Cron task prompt]
  Cron --> Discord[Discord delivery]
```

## WeChat MP Provider

Runtime name: `wechat-mp`.

Owner code paths:

```text
src/providers/wechat-mp/
  auth.ts       # session loading/redaction
  client.ts     # mp.weixin.qq.com backend calls
  collector.ts  # account query, window, dedupe orchestration
  config.ts     # ~/.miniclaw/providers/wechat-mp/<name>.yaml
  format.ts     # prompt/Discord-safe provider text
  parser.ts     # article metadata normalization
  state.ts      # fakeid cache and sent-article dedupe

scripts/wechat-mp-login.ts
scripts/wechat-mp-check.ts
scripts/wechat-mp-collect.ts
```

Purpose:

- 从配置的微信公众号采集文章列表 metadata。
- 按固定北京时间 slots 过滤文章。
- 在早/晚运行之间 dedupe 已发送文章。
- 把 metadata 注入 LLM task，生成适合 Discord 阅读的总结。

Non-goals:

- 不读取个人微信聊天记录。
- 不抓取或总结完整私有文章正文，除非未来 provider 显式增加安全的 body contract。
- 不把 WeChat session token/cookies 暴露到 Discord、logs、repo docs 或 LLM prompts。

## Config Shape

User config lives under `~/.miniclaw/providers/wechat-mp/<name>.yaml`:

```yaml
auth_path: "~/.miniclaw/secrets/wechat-mp-session.json"
state_path: "~/.miniclaw/providers/wechat-mp/state.json"
window:
  mode: fixed_slots
  timezone_offset_hours: 8
  slots:
    - at_hour: 9
      start_day_offset: -1
      start_hour: 17
      end_day_offset: 0
      end_hour: 9
    - at_hour: 17
      start_day_offset: 0
      start_hour: 9
      end_day_offset: 0
      end_hour: 17
max_pages_per_account: 5
page_size: 10
dedupe: true
accounts:
  - name: 机器之心
    query: 机器之心
    alias: almosthuman2014
```

Fixed window semantics:

- 北京时间 09:00 run：前一天 17:00 到当天 09:00。
- 北京时间 17:00 run：当天 09:00 到当天 17:00。
- Window 左闭右开：`start <= publish_time < end`。

## Session Refresh

Commands:

```bash
pnpm wechat-mp:login -- --config daily-ai-wechat
pnpm wechat-mp:check -- --config daily-ai-wechat
pnpm wechat-mp:collect -- --config daily-ai-wechat --dry-run
```

Session contract:

- Login 使用可见浏览器，并且只把 `mp.weixin.qq.com` token/cookies 保存到 `auth_path`。
- `auth_path` 应使用 `0600` 权限，且绝不能提交到 git。
- Check 和 collect commands 必须 redact token/cookie values。
- Dry run 不能提交 dedupe state。

## Cron Usage

Example cron job:

```yaml
name: daily-wechat-mp
schedule: "0 9,17 * * *"
timezone: Asia/Shanghai
enabled: true
type: task
channel: "<discord-channel-id>"
pre_provider: wechat-mp
pre_provider_config: daily-ai-wechat
prompt: |
  You are a Chinese AI/data technology editor. The provider JSON above contains article metadata for the current fixed window.
  Summaries must be based only on title, digest, and metadata. Do not invent article body details.
```

Provider commit semantics:

```text
cron task
  -> runPreProvider("wechat-mp")
  -> collect metadata and filter/dedupe
  -> inject JSON into task prompt
  -> execute LLM task
  -> commit dedupe state only after downstream task success
```

## Safety Contract

- `auth_path` 等价于 Official Account backend web session credential。
- Provider output 只能包含 article metadata、account names、titles、digests、publish times 和 links。
- Provider failure 不能把 articles 标记为 sent。
- Frequency control 或 invalid-session errors 应作为带 redacted diagnostics 的 provider failures 暴露。
- Website pages 可以总结 WeChat ingestion，但实现事实应把本页作为 `source_docs`。

## Legacy Compatibility

上一轮 feature-level doc 会作为兼容 stub 保留一个迁移周期：

- [`../../features/02-wechat-mp-provider.md`](../../features/02-wechat-mp-provider.md)

新的实现事实应写到这里，而不是写到 stub。

Verification owner:

```bash
pnpm vitest run src/providers/wechat-mp
pnpm run quality:docs
pnpm run typecheck
```
