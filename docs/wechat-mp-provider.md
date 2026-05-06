# WeChat MP Provider

MiniClaw can collect recent WeChat Official Account article metadata through an internal `wechat-mp` pre-provider, then let a cron `task` summarize the result and post it to Discord.

This provider uses a WeChat Official Platform web session from `mp.weixin.qq.com`. Treat the session file as a sensitive credential.

## Provider Config

Create `~/.miniclaw/providers/wechat-mp/daily-ai-wechat.yaml`:

```yaml
auth_path: "~/.miniclaw/secrets/wechat-mp-session.json"
state_path: "~/.miniclaw/providers/wechat-mp/state.json"
window_hours: 24
max_pages_per_account: 1
page_size: 10
dedupe: true
accounts:
  - name: 阿里云开发者
    query: 阿里云开发者
    alias: ali_tech
  - name: 机器之心
    query: 机器之心
    alias: almosthuman2014
  - name: 新智元
    query: 新智元
    alias: AI_era
  - name: AI寒武纪
    query: AI 寒武纪
    alias: agihwj
  - name: DataFunSummit
    query: DataFunSummit
    alias: DataFunSummit
```

## Session Refresh

Run a visible browser login:

```bash
pnpm wechat-mp:login -- --config daily-ai-wechat
```

After scanning and confirming login, MiniClaw saves only the `mp.weixin.qq.com` token and cookies to the configured `auth_path` with file mode `600`.

Check the session without printing secrets:

```bash
pnpm wechat-mp:check -- --config daily-ai-wechat
```

Dry-run collection without updating dedupe state:

```bash
pnpm wechat-mp:collect -- --config daily-ai-wechat --dry-run
```

## Cron Job

Create `~/.miniclaw/cron/daily-wechat-mp.yaml` and set `channel` to the target Discord channel ID:

```yaml
name: daily-wechat-mp
schedule: "0 10 * * *"
timezone: Asia/Shanghai
enabled: true
type: task
channel: "REPLACE_WITH_DISCORD_CHANNEL_ID"
pre_provider: wechat-mp
pre_provider_config: daily-ai-wechat
prompt: |
  你是中文 AI/数据技术信息编辑。上方 JSON 是最近 24 小时微信公众号文章列表。

  请生成一份 Discord 友好的中文日报：
  1. 开头给出 3-5 条今日重点
  2. 按公众号分组
  3. 每篇保留标题、发布时间、链接
  4. 摘要只能基于 title/digest，不要编造正文
  5. 如果没有新文章，明确说明没有更新
```

Test the cron job immediately:

```bash
pnpm cron:test daily-wechat-mp
```

The provider updates dedupe state only after the downstream LLM task completes successfully.
