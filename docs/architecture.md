# MiniClaw 架构图册

> 三张图，由外到内，10 分钟看懂全局。
> 所有图用 Mermaid 渲染，GitHub 直接显示。

---

## 1. 系统架构 — 整条链路

```mermaid
flowchart LR
    User([用户 yyf])

    subgraph Discord["Discord 平台"]
        DC["#chat 频道"]
        SC["/task /status<br/>/cancel /resume<br/>/remember /forget /memories"]
    end

    subgraph LocalMac["本机 (Mac)"]
        subgraph MiniClaw["MiniClaw bot 进程 (Node 22)"]
            BOT["bot.ts<br/>事件路由"]
            CHAT["agent/chat.ts<br/>@mention 轻量对话"]
            TASK["agent/task.ts<br/>/task Supervisor"]
            HANDLERS["commands/handlers.ts"]
            SUBA["agent/subagents.ts<br/>加载 agents/*.md"]
            MEM["memory/* + store/memory.ts"]
            DB[("SQLite<br/>~/.miniclaw/data.db<br/>tasks · memories · chat_history")]
        end

        subgraph Raven["raven 反代 (:7024)"]
            RAVEN["Anthropic ↔ OpenAI<br/>翻译 + SSE 转换"]
        end
    end

    subgraph Cloud["云端"]
        COPILOT["GitHub Copilot API<br/>claude-sonnet-4-6 / claude-opus-4.7 ..."]
    end

    User -->|"@bot 或在白名单频道发消息"| DC
    User -->|"slash command"| SC
    DC -->|"MessageCreate event<br/>(WebSocket Gateway)"| BOT
    SC -->|"InteractionCreate event"| BOT

    BOT -->|"普通消息"| CHAT
    BOT -->|"/task"| HANDLERS
    HANDLERS --> TASK

    CHAT -->|"query()"| Raven
    TASK -->|"query() + agents + tools"| Raven
    TASK -.->|"加载 4 个角色"| SUBA
    SUBA -.->|"读取"| AGENTS["agents/<br/>researcher.md<br/>planner.md<br/>generator.md<br/>evaluator.md"]

    CHAT --> MEM
    TASK --> MEM
    HANDLERS --> DB
    MEM --> DB

    Raven -->|"HTTPS<br/>Anthropic 原生 /v1/messages"| COPILOT
    COPILOT -->|"SSE stream"| Raven
    Raven -->|"SSE 翻译为 Anthropic 流"| MiniClaw

    MiniClaw -->|"Discord REST<br/>send / edit message"| DC

    classDef user fill:#fff4e6,stroke:#f59e0b,stroke-width:2px
    classDef discord fill:#5865f2,color:#fff,stroke:#404eed
    classDef miniclaw fill:#e6f4ff,stroke:#1677ff
    classDef raven fill:#fff1f0,stroke:#cf1322
    classDef cloud fill:#f6ffed,stroke:#52c41a
    class User user
    class DC,SC discord
    class BOT,CHAT,TASK,HANDLERS,SUBA,MEM,DB miniclaw
    class RAVEN raven
    class COPILOT cloud
```

**关键设计点**

- **双入口**：`@mention` 走 `chat.ts`（轻量对话）；`/task` 走 `task.ts`（Supervisor 模式 + subagent 编排）
- **持久化只在本地**：SQLite 单文件，**不要在两台机器之间同步**（否则状态分裂）
- **LLM 流量全部经过 raven**：`ANTHROPIC_BASE_URL=http://localhost:7024` 让两个 SDK（`@anthropic-ai/sdk` 和 `@anthropic-ai/claude-agent-sdk`）都走本地代理
- **白名单两道闸**：`MINICLAW_ALLOWED_USER_ID` 限制谁能用，`MINICLAW_AUTO_REPLY_CHANNELS` 决定哪些频道无需 @mention

---

## 2. @mention 消息时序图 — 一句话怎么走完整条流程

> 场景：你在 #chat 发 "解释下 React Server Components"，看一句话从输入到回复经过哪些代码。

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant D as Discord Gateway
    participant B as bot.ts<br/>(MessageCreate)
    participant CH as agent/chat.ts
    participant Q as claude-agent-sdk<br/>query()
    participant R as raven :7024
    participant API as Copilot API
    participant DB as SQLite<br/>chat_history + memories
    participant DR as Discord REST

    U->>D: 发送 "解释下 React Server Components"
    D-->>B: MessageCreate event

    Note over B: 三道过滤<br/>1. 非 bot 自己<br/>2. user_id 在白名单<br/>3. 频道在 auto_reply 列表<br/>   或被 @mention

    B->>B: parseExplicitMemory(content)<br/>检查 "记住:" 等关键词
    alt 是显式记忆指令
        B->>DB: addMemory()
        B->>DR: reply("✅ 已记住")
    else 普通对话
        B->>DR: react(👀) + sendTyping()
        B->>CH: chat(channelId, userId, content, callbacks)

        CH->>DB: getRecentHistory(channelId)<br/>取最近 N 条上下文
        CH->>DB: listMemories()<br/>读所有 memory
        CH->>CH: buildMemoryPrompt()<br/>+ buildHistoryBlock()

        CH->>Q: query({ prompt, model,<br/>systemPrompt:claude_code,<br/>allowedTools:[Read,Bash,WebSearch...] })

        Q->>R: POST /v1/messages<br/>(Anthropic 原生格式)
        R->>API: 转发到 Copilot 的 Anthropic 端点
        API-->>R: SSE 流式响应
        R-->>Q: SSE (Anthropic 格式)

        loop 每个 SSE 事件
            Q-->>CH: msg (assistant / tool_use / text)
            alt tool_use 出现
                CH->>CH: callbacks.onToolUse(line)
                CH->>DR: 创建/编辑 "进度消息"<br/>(每 600ms 节流)
            end
        end

        Q-->>CH: 最终 result (汇总文本)
        CH->>DB: appendHistory(user msg + assistant reply)
        CH-->>B: 返回 reply 字符串

        B->>B: chunkMessage(reply)<br/>切成 ≤2000 字符
        loop 每块
            B->>DR: message.reply(chunk)
        end
        B->>DR: react(✅) + 移除 👀
    end
```

**易错点提示**

- **第 1 步**：用户必须是 `MINICLAW_ALLOWED_USER_ID`，否则消息被静默丢弃
- **第 6-7 步**：去重 Map (`processed`) 只在单进程内有效；同一台机器跑两个 bot 进程不会去重
- **第 14 步**：`allowedTools` 决定 chat 模式能用什么工具 — 默认含 `Read/Bash/Glob/WebSearch/WebFetch/Agent`，**没有** `Write/Edit`（只读模式）
- **第 17-18 步**：raven 看到 `claude-*` 模型走 Anthropic 原生通道，零翻译开销
- **第 26 步**：Discord 单消息上限 2000 字符，超过会被截

---

## 3. /task Supervisor 时序图 — 主 agent 怎么分派 subagent

> 场景：你跑 `/task prompt:"给 miniclaw 加一个 /metrics 命令显示昨日 token 消耗"`，看 Supervisor 模式怎么编排 4 个角色化 subagent。

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant D as Discord
    participant H as commands/handlers.ts<br/>(handleTask)
    participant T as agent/task.ts<br/>(executeTask)
    participant SA as agent/subagents.ts
    participant Q as claude-agent-sdk<br/>主 query()
    participant R as raven → Copilot
    participant DB as SQLite<br/>tasks 表

    U->>D: /task prompt:"加 /metrics 命令" cwd:~/ProjectRepo/miniclaw
    D-->>H: InteractionCreate

    H->>DB: insertTask(status='running')
    H->>D: defer + reply("✅ 任务已启动 #{taskId}")

    H->>T: executeTask({ taskId, prompt, cwd, channel })

    T->>SA: loadSubagents()
    SA->>SA: 读 agents/*.md<br/>解析 YAML frontmatter + body
    SA-->>T: [researcher, planner, generator, evaluator]

    T->>T: buildMemoryPrompt() +<br/>构造 supervisorBlock<br/>("你的角色：Supervisor...<br/>推荐工作流：R→P→G→E")

    T->>Q: query({<br/>  systemPrompt: claude_code + supervisorBlock,<br/>  agents: {researcher,planner,generator,evaluator},<br/>  allowedTools:[Read,Write,Edit,Bash,...,Agent,mcp__exa,mcp__context7],<br/>  abortController, resume?<br/>})

    Q->>R: POST /v1/messages
    R-->>Q: 主 agent 的第一个 turn

    Note over Q: 主 agent 决定：<br/>"复杂任务 → 用 Researcher 先调研"

    Q->>Q: tool_use Agent(<br/>  subagent_type:'researcher',<br/>  prompt:'调研现有 commands 结构...')

    Q->>R: 嵌套 query (子 session)
    R-->>Q: Researcher 输出 file:line 证据

    Note over Q,T: 类似流程：Planner → Generator → Evaluator<br/>每个 subagent 都是一次 nested query()

    loop 主 agent 每个 turn
        Q-->>T: msg.type='assistant'
        alt parent_tool_use_id 存在
            T->>T: 标记为 "↳ [subagent]"
        end
        T->>T: 收集 textParts + toolParts
        T->>D: ProgressReporter.update()<br/>(节流编辑同一条消息)
    end

    alt Evaluator 验收不通过
        Note over Q: 主 agent 让 Generator 修复<br/>再次调用 Evaluator (最多 2 轮)
    end

    Q-->>T: msg.type='result'<br/>(success/error, cost, turns, duration)

    T->>DB: updateTask({status, result_summary, cost_usd, duration_ms, completed_at})

    T->>D: send(taskCompleteEmbed/taskErrorEmbed)
    alt 结果 > 4096 字符
        T->>D: chunkMessage → 多条消息
    end

    Note over U,DB: 后续可用 /resume task_id:#{taskId}<br/>会以 session_id 续跑
```

**Supervisor 模式精髓**

| 角色 | 职责 | 工具集 |
|------|------|--------|
| **Researcher** | 调研代码、收集 file:line 证据 | Read/Glob/Grep/WebSearch |
| **Planner** | 基于调研输出步骤化计划 | 通常只读 |
| **Generator** | 按计划写代码 | Read/Write/Edit/Bash |
| **Evaluator** | 独立验收，**必跑 `pnpm build`** | Read/Bash（不写代码）|

**为什么这样设计**（不是简单一锅炖）

- **Context 隔离**：subagent 看不到主 agent 的对话历史，主 agent 调用时**必须完整传上下文**（见 task.ts:71）
- **职责分离**：Generator 不能自己说"做完了"，必须 Evaluator 独立判定 — 防止 LLM 自我吹嘘
- **可迭代**：Evaluator 不通过 → Generator 修复 → 再验收，最多 2 轮（task.ts:72）
- **Supervisor 整合**：主 agent 负责把 4 段 subagent 输出**整合后**回复用户，不直接抛原文（task.ts:73）

---

## 数据库 schema（额外参考）

`~/.miniclaw/data.db`（SQLite WAL 模式）

```mermaid
erDiagram
    tasks {
        TEXT id PK
        TEXT discord_thread_id
        TEXT discord_user_id
        TEXT prompt
        TEXT cwd
        TEXT session_id "Agent SDK session, 用于 /resume"
        TEXT status "running/completed/failed"
        TEXT result_summary
        REAL cost_usd
        INTEGER duration_ms
        TEXT created_at
        TEXT completed_at
    }
    memories {
        INTEGER id PK
        TEXT type "user/feedback/project/reference"
        TEXT name
        TEXT content
        TEXT created_at
        TEXT updated_at
    }
    chat_history {
        INTEGER id PK
        TEXT discord_channel_id
        TEXT discord_user_id
        TEXT role "user/assistant"
        TEXT content
        TEXT created_at
    }
```

三张表互不关联（无 FK），按时间窗口和 channel 隔离查询。

---

## 阅读建议

1. **第一次接触** → 看图 1，对照 `src/index.ts` + `src/bot.ts` 通读一遍
2. **想改 chat 行为** → 看图 2，集中改 `src/agent/chat.ts`
3. **想加新 subagent** → 看图 3，新增 `agents/<name>.md`，`loadSubagents()` 自动发现
4. **想加新 slash command** → `src/commands/register.ts` 注册定义 + `src/commands/handlers.ts` 加处理器 + `src/bot.ts` switch 加 case
