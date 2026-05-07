# WeChat MP Provider

MiniClaw 通过内置 `wechat-mp` pre-provider 采集微信公众号文章元数据，再交给 cron `task` 汇总并推送到 Discord。

这个方案复用的是 `mp.weixin.qq.com` 微信公众平台后台登录态，也就是公众号后台账号的 web session。它不读取个人微信聊天记录，但 session 文件本身等价于后台登录凭据，必须按敏感凭据处理。

## 工作流

```text
cron daily-wechat-mp
  -> runPreProvider("wechat-mp")
  -> 使用 auth_path 中的 token/cookies 调用公众号后台接口
  -> 按固定时间窗口过滤文章
  -> 按 state_path 去重
  -> 把 JSON 注入 LLM prompt
  -> executeTask(outputMode="raw")
  -> LLM 总结后推送到 Discord
  -> 下游 task 成功后才提交 dedupe state
```

关键点：

- provider 只采集文章列表元数据：公众号、标题、摘要、发布时间、链接等。
- 摘要任务只能基于 `title` / `digest` / metadata，不应编造正文内容。
- `state_path` 保存 fakeid cache 和已发送文章，用于 9:00 / 17:00 两次任务去重。
- provider 运行失败时不提交 dedupe state，避免把未成功推送的文章标记为已发送。

## Provider Config

创建 `~/.miniclaw/providers/wechat-mp/daily-ai-wechat.yaml`：

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
  - name: 量子位
    query: 量子位
    alias: QbitAI
  - name: InfoQ
    query: InfoQ
    alias: infoqchina
  - name: DataFunTalk
    query: DataFunTalk
    alias: datafuntalk
  - name: AIGC开发社区
    query: AIGC开发社区
    alias: AIGCOPEN
```

固定窗口语义：

- 北京时间 9:00 运行：采集昨天 17:00 到今天 9:00 之间发布的文章。
- 北京时间 17:00 运行：采集今天 9:00 到今天 17:00 之间发布的文章。
- 时间窗口是左闭右开：`start <= publish_time < end`。例如刚好 9:00 的文章由 17:00 任务处理。

参数说明：

- `max_pages_per_account`: 每个公众号最多翻多少页文章列表。
- `page_size`: 每页向微信后台接口请求多少篇文章。
- `dedupe`: 是否使用 `state_path` 中的已发送记录过滤重复文章。

## Session Refresh

启动可见浏览器登录并保存 session：

```bash
pnpm wechat-mp:login -- --config daily-ai-wechat
```

扫码并确认登录后，MiniClaw 只保存 `mp.weixin.qq.com` 的 token 和 cookies 到 `auth_path`，文件权限应为 `600`。

检查 session 是否仍可用，且不会打印敏感 token/cookie：

```bash
pnpm wechat-mp:check -- --config daily-ai-wechat
```

不更新 dedupe state 的试采集：

```bash
pnpm wechat-mp:collect -- --config daily-ai-wechat --dry-run
```

## Cron Job

创建 `~/.miniclaw/cron/daily-wechat-mp.yaml`，把 `channel` 设置为目标 Discord 频道 ID，例如 `#daily-wechat-article`：

```yaml
name: daily-wechat-mp
schedule: "0 9,17 * * *"
timezone: Asia/Shanghai
enabled: true
type: task
channel: "REPLACE_WITH_DISCORD_CHANNEL_ID"
pre_provider: wechat-mp
pre_provider_config: daily-ai-wechat
prompt: |
  你是中文 AI/数据技术信息编辑。上方 JSON 是当前固定时间段内尚未推送过的微信公众号文章列表。

  请生成一份 Discord 友好的中文日报：
  1. 开头给出 3-5 条今日重点
  2. 按公众号分组
  3. 每篇保留标题、发布时间、链接
  4. 摘要只能基于 title/digest，不要编造正文
  5. 如果没有新文章，明确说明没有更新
```

立即触发一次 cron 测试：

```bash
pnpm cron:test daily-wechat-mp
```

## 安全边界

- `auth_path` 不要放进 git，不要贴到 Discord 或日志里。
- 这个 token 的能力来自微信公众号后台 web session，不是个人微信聊天 session。
- provider 不具备读取个人微信聊天记录的入口；风险主要在公众号后台功能被滥用、session 泄露、或微信侧频控。
- 如果出现 `invalid session` / `frequency control`，先运行 `pnpm wechat-mp:check`，必要时重新 `pnpm wechat-mp:login`。
