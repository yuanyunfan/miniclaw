# Content Provider Family

> Conclusion: content providers collect external article/content metadata, dedupe it, and format prompt-ready context for cron tasks. The current content provider is `wechat-mp`; it reads WeChat Official Account backend article metadata through a user-controlled web session and must treat the session file as a sensitive credential.

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

- Collect article list metadata from configured WeChat Official Accounts.
- Filter articles by fixed Beijing-time slots.
- Dedupe already-sent articles across morning/evening runs.
- Inject metadata into an LLM task for a Discord-friendly summary.

Non-goals:

- Does not read personal WeChat chat history.
- Does not fetch or summarize full private article bodies unless a future provider explicitly adds a safe body contract.
- Does not expose WeChat session token/cookies to Discord, logs, repo docs, or LLM prompts.

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

- Beijing 09:00 run: previous day 17:00 through current day 09:00.
- Beijing 17:00 run: current day 09:00 through current day 17:00.
- Windows are left-closed, right-open: `start <= publish_time < end`.

## Session Refresh

Commands:

```bash
pnpm wechat-mp:login -- --config daily-ai-wechat
pnpm wechat-mp:check -- --config daily-ai-wechat
pnpm wechat-mp:collect -- --config daily-ai-wechat --dry-run
```

Session contract:

- Login uses a visible browser and saves only the `mp.weixin.qq.com` token/cookies to `auth_path`.
- `auth_path` should have `0600` permissions and must not be committed.
- Check and collect commands must redact token/cookie values.
- A dry run must not commit dedupe state.

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

- `auth_path` is equivalent to an Official Account backend web session credential.
- Provider output should contain article metadata, account names, titles, digests, publish times, and links only.
- Provider failures must not mark articles as sent.
- Frequency control or invalid-session errors should surface as provider failures with redacted diagnostics.
- Website pages may summarize WeChat ingestion, but implementation facts should use this page as `source_docs`.

## Legacy Compatibility

The previous feature-level doc is a compatibility stub for one migration cycle:

- [`../archive/features/02-wechat-mp-provider.md`](../archive/features/02-wechat-mp-provider.md)

New implementation facts should be added here instead of the stub.

Verification owner:

```bash
pnpm vitest run src/providers/wechat-mp
pnpm run quality:docs
pnpm run typecheck
```
