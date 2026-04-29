# `src/bot.ts` 消息路由全解析

> 整个文件只注册了 **3 个 Discord 事件监听器**，每个负责一类事件。
> 看完这一篇你就能改触发词 / 加新命令 / 调整路由规则。

---

## 全景图

```mermaid
flowchart TD
    Discord[Discord Gateway WebSocket]

    Discord --> ME[MessageCreate<br/>普通文本消息]
    Discord --> IC[InteractionCreate<br/>Slash Command 等交互]
    Discord --> CR[ClientReady<br/>登录成功一次性事件]

    ME --> F1{author 是 bot?}
    F1 -->|是| X1[丢弃]
    F1 -->|否| F2{user_id<br/>== allowedUserId?}
    F2 -->|否| X2[静默丢弃]
    F2 -->|是| P1{Path 1?<br/>消息在真正的<br/>Discord thread 内<br/>且对应 task 存在<br/>且非 cron 触发}

    P1 -->|是| RES[加 🔄 reaction<br/>resume 上次 session<br/>executeTask 续话]
    P1 -->|否| F3{Path 2?<br/>channel ∈ auto_reply_list<br/>OR 被 @mention?}
    F3 -->|否| X3[忽略]
    F3 -->|是| F4{message_id<br/>已处理过?}
    F4 -->|是| X4[去重丢弃]
    F4 -->|否| ROUTE[进入 Path 2 内部分流]

    ROUTE --> R0{content 为空?<br/>(仅 @ 没正文)}
    R0 -->|是| GREET[reply 你好]
    R0 -->|否| R1{记忆指令?<br/>'记住:' 'remember' '/memory'}
    R1 -->|是| MEM[addMemory + reply ✅]
    R1 -->|否| CHAT[chat 主流程<br/>👀 → typing → SDK → ✅]

    IC --> IS{isChatInputCommand?}
    IS -->|否| X5[忽略]
    IS -->|是| SW{commandName<br/>switch}
    SW --> T[/task → handleTask/]
    SW --> S[/status → handleStatus/]
    SW --> C[/cancel → handleCancel/]
    SW --> RS[/resume → handleResume/]
    SW --> RM[/remember → handleRemember/]
    SW --> FG[/forget → handleForget/]
    SW --> MM[/memories → handleMemories/]
    SW --> UN[未知 → 回复'未知命令']

    CR --> RECOV[recoverInterruptedTasks]
    CR --> SCHED[startScheduler<br/>注册 ~/.miniclaw/cron/*.yaml]

    classDef filter fill:#fff7e6,stroke:#fa8c16
    classDef route fill:#e6f7ff,stroke:#1890ff
    classDef drop fill:#fff1f0,stroke:#cf1322,color:#a8071a
    class F1,F2,F3,F4,P1,R0,R1,IS,SW filter
    class CHAT,RES,MEM,GREET,T,S,C,RS,RM,FG,MM,RECOV,SCHED route
    class X1,X2,X3,X4,X5 drop
```

---

## 三个监听器分别在哪

| 行号 | 事件 | 干什么 |
|------|------|--------|
| `bot.ts:32` | `MessageCreate` | 处理普通消息（thread 续话 / @mention / 自动频道 / 记忆指令） |
| `bot.ts:158` | `InteractionCreate` | 处理 7 个 slash commands |
| `bot.ts:203` | `ClientReady` | 启动 scheduler + 恢复中断任务 |

---

## MessageCreate 决策链

### 闸 1+2：硬过滤（行 33-34）

```ts
if (message.author.bot) return;                       // bot 不互回
if (message.author.id !== config.allowedUserId) return; // 单用户白名单
```

### Path 1: Thread Continuation（行 36-66）

> 设计意图：你 `/task` 创建过的 thread 里，再发任何文字 = 续话。

**3 个守卫同时满足才进入**：

```ts
const isInThread = "isThread" in message.channel && message.channel.isThread();
const continuableTask = isInThread ? getTaskByThreadId(message.channel.id) : undefined;
if (continuableTask && continuableTask.session_id && continuableTask.discord_user_id !== "cron") {
```

| 守卫 | 防什么 |
|------|--------|
| `isThread()` | 防普通 channel 命中 thread 续话逻辑 |
| `getTaskByThreadId(channel.id)` 命中 | 这个 thread 必须真的有 task 历史 |
| `discord_user_id !== "cron"` | cron 触发的 task 不算用户的"上次会话" |

匹配则：
1. 加 `🔄` reaction（视觉提示"识别为续话"）
2. 新建 task row（同 thread + 新 prompt）
3. `executeTask({ ..., resumeSessionId: continuableTask.session_id })`
4. SDK 接住上次的完整 transcript，不需要 prompt 里重复上下文

### 闸 3+4：Path 2 入口（行 68-79）

```ts
const isAutoChannel = config.autoReplyChannelIds.includes(message.channel.id);
const isMentioned = message.mentions.has(client.user!);
if (!isAutoChannel && !isMentioned) return;
// 然后 processed 去重 Map（5 分钟 TTL，500 条做老化）
```

### Path 2 内部分流（按优先级 if-else）

| 优先级 | 行 | 判断 | 走向 |
|--------|----|------|------|
| **高** | `:85-88` | content 为空（仅 @ 没正文） | `reply("你好！...")` → return |
| **中** | `:90-95` | `parseExplicitMemory` 命中"记住:" / "remember" / "/memory" | `addMemory` + reply ✅ → return |
| **低** | `:97+` | 其他所有内容 | chat 主流程 |

### chat 主流程（视觉反馈完整链）

```
react(👀)              ← 立即反馈
  ↓
sendTyping() 每 8s     ← Discord "正在输入..." 循环刷新
  ↓
chat() 调 Anthropic SDK
  ├─ onToolUse 回调 → flushSteps() 编辑"步骤消息"（节流 600ms）
  └─ 返回最终文本
  ↓
chunkMessage 切 2000 字  ← Discord 单消息上限
  ↓
逐块 reply()
  ↓
移除 👀 + 加 ✅          ← 完成态
```

异常路径：catch → 移除 👀 + 加 ❌ + reply "回复出错"。

---

## InteractionCreate 的简单 switch（`:158`-）

只处理 `isChatInputCommand`（slash command），其他交互（按钮、菜单）目前不处理。

7 个 case **直接转发到 `commands/handlers.ts`** 的对应 handler，`bot.ts` 不做业务逻辑。

错误处理（`:204+`）有个细节：要根据 `cmd.deferred || cmd.replied` 决定用 `editReply` 还是 `reply` —— 因为 handler 可能已经 `deferReply()` 过了（耗时任务必须在 3 秒内 defer）。包了 `try-catch` 防错误回复本身又抛异常导致进程崩。

---

## ClientReady 启动逻辑（`:203-205`）

```ts
client.once(Events.ClientReady, (c) => {
  console.log(`[MiniClaw] Logged in as ${c.user.tag}`);
  void recoverInterruptedTasks(c);     // 把 status='running' 但进程已死的任务标 'interrupted'
});
```

另外 `src/index.ts` 也注册了一个 `ClientReady`：
```ts
bot.once(Events.ClientReady, (client) => startScheduler(client));
```
启动时载入 `~/.miniclaw/cron/*.yaml`，注册到 `node-cron`，到点自动 dispatch。SIGTERM 时 `stopScheduler()` 优雅退出。

---

## 路由设计的几个聪明决定

1. **Path 1 三重守卫** —— 防 cron 在普通 channel 留下的 fake `discord_thread_id` 误命中
2. **去重 Map 在内存里** —— 单进程单机简单粗暴够用；分布式才需要 Redis
3. **记忆指令短路** —— "记住 xxx" 直接进 markdown 文件不调 LLM，零延迟、零费用
4. **chat 默认走 chat 而非 task** —— 默认轻量回答，要执行任务必须显式 `/task`
5. **scheduler 跟随 ClientReady** —— bot 没登录前不调度（避免 "channel not found"）

---

## 想改路由时的常见场景

| 想做什么 | 改哪里 |
|----------|--------|
| 加**新触发词**（如 `/search`） | `register.ts` 加定义 → `handlers.ts` 加 handler → `bot.ts:158+` 加 case |
| 让 bot **不响应某频道** | 把该频道 ID 从 `MINICLAW_AUTO_REPLY_CHANNELS` 拿掉，且别 @ 它 |
| 加**多用户支持** | 把 `config.allowedUserId` 改成数组，`:34` 改 `includes` |
| 让 bot 响应**按钮点击** | `InteractionCreate` 加 `interaction.isButton()` 分支 |
| **关掉 thread 续话** | `bot.ts:36+` 整段 if 注释掉（保留 Path 2） |
| 加**新 cron job** | 不改代码，写 `~/.miniclaw/cron/<name>.yaml` 重启 bot |

---

## 相关文档

- [`architecture.md`](architecture.md) — 系统架构图 + 整体时序图
- `src/agent/chat.ts` — chat 主流程的 LLM 调用细节
- `src/agent/task.ts` — `/task` Supervisor 模式细节
- `src/cron/scheduler.ts` — cron 调度引擎
- `src/commands/handlers.ts` — 7 个 slash command 的实现
