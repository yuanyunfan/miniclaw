# MiniClaw 架构图册

> 三张图 + 用户级扩展全景，由外到内，10 分钟看懂全局。
> 所有图用 Mermaid 渲染，GitHub 直接显示。

---

## 1. 系统架构 — 整条链路

```mermaid
flowchart LR
    User([用户])

    subgraph Discord["Discord 平台"]
        DC["#常规 / #chat<br/>4 分类频道（AI/PERSONAL/STOCK/NEWS）"]
        SC["/task /status /cancel /resume<br/>/remember /forget /memories"]
    end

    subgraph LocalMac["本机 (Mac)"]
        subgraph MiniClaw["MiniClaw bot 进程 (Node 22)"]
            BOT["bot.ts<br/>事件路由 + thread 续话"]
            CHAT["agent/chat.ts<br/>@mention 轻量对话"]
            TASK["agent/task.ts<br/>/task Supervisor"]
            HANDLERS["commands/handlers.ts"]
            SUBA["agent/subagents.ts<br/>加载 agents/*.md +<br/>~/.miniclaw/skills/*.md"]
            CRON["cron/scheduler.ts<br/>node-cron 调度"]
            MCP["agent/mcp.ts<br/>从 ~/.claude.json 复用 MCP"]
        end

        subgraph UserCfg["~/.miniclaw/ 用户级数据"]
            UC1["cron/*.yaml<br/>15 个定时 job"]
            UC2["cron/state.json<br/>last_run/completed 持久化"]
            UC3["scripts/*.{py,sh}<br/>cron type=script 调用"]
            UC4["skills/*.md<br/>用户级 subagent"]
            UC5["memories/MEMORY.md<br/>长期记忆（hermes 风格）"]
            UC6["channel-map.json<br/>setup 输出"]
            DB[("data.db<br/>SQLite WAL<br/>tasks · chat_history")]
        end

        subgraph Raven["raven 反代 (:7024)"]
            RAVEN["Anthropic ↔ OpenAI<br/>翻译 + SSE 转换"]
        end
    end

    subgraph Cloud["云端"]
        COPILOT["GitHub Copilot API<br/>claude-sonnet-4-6 / claude-opus-4.7 ..."]
        EXA["exa MCP<br/>(web search)"]
        CTX7["context7 MCP<br/>(library docs)"]
    end

    User -->|"@bot / 在白名单频道发消息"| DC
    User -->|"slash command"| SC
    DC -->|"MessageCreate event"| BOT
    SC -->|"InteractionCreate event"| BOT

    BOT -->|"普通消息"| CHAT
    BOT -->|"thread 续话"| TASK
    BOT -->|"/task"| HANDLERS
    HANDLERS --> TASK
    CRON -->|"到点 dispatch"| TASK
    CRON -->|"type=script"| UC3

    CHAT -->|"query()"| Raven
    TASK -->|"query() + agents + tools"| Raven
    TASK -.->|"加载 4 角色 + user skills"| SUBA
    SUBA -.->|"读取"| AGENTS["agents/*.md<br/>(repo)"]
    SUBA -.->|"读取"| UC4
    TASK -.->|"加载 MCP"| MCP
    MCP -.->|"读"| MCPCFG["~/.claude.json<br/>mcpServers 段"]

    CHAT -->|"读"| UC5
    TASK -->|"读"| UC5
    HANDLERS --> DB
    CRON --> UC1
    CRON --> UC2

    Raven -->|"HTTPS<br/>/v1/messages"| COPILOT
    COPILOT -->|"SSE stream"| Raven
    Raven -->|"SSE 翻译为 Anthropic 流"| MiniClaw
    Raven -.->|"MCP 工具调用"| EXA
    Raven -.->|"MCP 工具调用"| CTX7

    MiniClaw -->|"Discord REST<br/>send / edit message / attach files"| DC

    classDef user fill:#fff4e6,stroke:#f59e0b,stroke-width:2px
    classDef discord fill:#5865f2,color:#fff,stroke:#404eed
    classDef miniclaw fill:#e6f4ff,stroke:#1677ff
    classDef usercfg fill:#f9f0ff,stroke:#722ed1
    classDef raven fill:#fff1f0,stroke:#cf1322
    classDef cloud fill:#f6ffed,stroke:#52c41a
    class User user
    class DC,SC discord
    class BOT,CHAT,TASK,HANDLERS,SUBA,CRON,MCP miniclaw
    class UC1,UC2,UC3,UC4,UC5,UC6,DB,AGENTS,MCPCFG usercfg
    class RAVEN raven
    class COPILOT,EXA,CTX7 cloud
```

**关键设计点**

- **三入口**：`@mention` 走 `chat.ts`（轻量对话）；`/task` 走 `task.ts`（Supervisor 模式 + subagent 编排）；`cron` 调度自动触发
- **代码 vs 用户级数据严格分离**：
  - 代码在 git repo（`agents/*.md` / `src/`）
  - 用户级数据全在 `~/.miniclaw/`（cron / skills / scripts / memories / channel-map）
- **memories 走 markdown 不再走 SQLite 表**：`~/.miniclaw/memories/MEMORY.md` 可直接 vim 编辑、git diff、跨工具复用（hermes 同模式）
- **MCP 复用不重维护**：mcp.ts 直接读 `~/.claude.json` 的 `mcpServers` 段，零 key 管理
- **白名单两道闸**：`MINICLAW_ALLOWED_USER_ID` 限制谁能用，`MINICLAW_AUTO_REPLY_CHANNELS` 决定哪些频道无需 @mention
- **LLM 流量全部经过 raven**：`ANTHROPIC_BASE_URL=http://localhost:7024` 让两个 SDK 都走本地代理

---

## 2. @mention 消息时序图

> 场景：你在 #常规 发 "解释下 React Server Components"

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant D as Discord Gateway
    participant B as bot.ts
    participant CH as agent/chat.ts
    participant Q as claude-agent-sdk
    participant R as raven :7024
    participant API as Copilot API
    participant MD as ~/.miniclaw/memories/<br/>MEMORY.md
    participant DB as SQLite<br/>chat_history
    participant DR as Discord REST

    U->>D: 发送 "解释下 React Server Components"
    D-->>B: MessageCreate event

    Note over B: 闸 1+2: 非 bot + allowedUserId<br/>Path 1: 不是 thread → 跳过<br/>Path 2 入口: auto_reply 或 @mention

    B->>B: parseExplicitMemory(content)
    alt 是显式记忆指令 ("记住:...")
        B->>MD: addMemory() → 重写 MEMORY.md
        B->>DR: reply("✅ 已记住")
    else 普通对话
        B->>DR: react(👀) + sendTyping()
        B->>CH: chat(channelId, userId, content, callbacks)

        CH->>DB: getRecentHistory(channelId)<br/>取最近 N 条
        CH->>MD: getAllMemories()<br/>读 MEMORY.md
        CH->>CH: buildMemoryPrompt() + buildHistoryBlock()

        CH->>Q: query({ prompt, model,<br/>systemPrompt:claude_code,<br/>allowedTools:[Read,Bash,WebSearch...] })

        Q->>R: POST /v1/messages
        R->>API: 转发 Anthropic 端点
        API-->>R: SSE 流
        R-->>Q: SSE (Anthropic 格式)

        loop 每个 SSE 事件
            Q-->>CH: msg (assistant / tool_use / text)
            alt tool_use 出现
                CH->>CH: callbacks.onToolUse(line)
                CH->>DR: 编辑"进度消息" (节流 600ms)
            end
        end

        Q-->>CH: 最终 result
        CH->>DB: appendHistory(user msg + assistant reply)
        CH-->>B: 返回 reply 字符串

        B->>B: chunkMessage(reply) ≤2000 字符
        loop 每块
            B->>DR: message.reply(chunk)
        end
        B->>DR: react(✅) + 移除 👀
    end
```

---

## 3. /task Supervisor + Verdict 自动迭代

> 场景：`/task prompt:"加 /metrics 命令"`，看 4 角色 subagent + verdict YAML 自动循环

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant D as Discord
    participant H as commands/handlers.ts
    participant T as agent/task.ts
    participant SA as agent/subagents.ts
    participant Q as claude-agent-sdk<br/>主 query()
    participant R as raven → Copilot
    participant DB as SQLite tasks 表

    U->>D: /task prompt:"加 /metrics 命令" cwd:~/Code
    D-->>H: InteractionCreate

    H->>D: 创建 thread + defer
    H->>DB: insertTask(status='running')
    H->>T: executeTask({ taskId, prompt, cwd, channel, outputMode:'embed' })

    T->>SA: loadSubagents()
    SA->>SA: 读 agents/*.md (repo)<br/>+ ~/.miniclaw/skills/*.md (user)
    SA-->>T: { researcher, planner, generator, evaluator, ...user skills }

    T->>T: buildMemoryPrompt() + supervisorBlock<br/>(角色边界 + verdict 路由 + Contract 触发)

    T->>Q: query({<br/>  systemPrompt: claude_code + supervisorBlock,<br/>  agents: {researcher,planner,generator,evaluator},<br/>  allowedTools:[Read,Write,Edit,Bash,...,Agent,mcp__exa,mcp__context7],<br/>  canUseTool: 拦 Skill(triad/triad-resume),<br/>  abortController, resume?<br/>})

    Note over Q: Supervisor 决定流程：<br/>简单任务可跳过部分阶段；<br/>>3 文件复杂任务先 Contract

    Q->>Q: tool_use Agent(researcher, prompt:"调研...")
    Q->>R: 嵌套 query (Researcher fresh context)
    R-->>Q: file:line 证据

    Q->>Q: tool_use Agent(planner, prompt:"步骤化计划")
    R-->>Q: 计划 + 验收命令

    Q->>Q: tool_use Agent(generator, prompt:"实施 / Contract 模式")
    R-->>Q: 改动文件

    Q->>Q: tool_use Agent(evaluator, prompt:"独立验收")
    R-->>Q: ## Machine-Readable Verdict<br/>verdict: PASS/CONDITIONAL_PASS/FAIL<br/>fix_list: [...]<br/>escalate: false

    alt verdict == FAIL
        Note over Q: 自动重 spawn Generator (Fix 模式)<br/>+ 再 spawn Evaluator<br/>最多 2 轮
    end

    loop 主 agent 每个 turn
        Q-->>T: msg.type='assistant'
        alt parent_tool_use_id 存在
            T->>T: 标记 "↳ [subagent]"
        end
        T->>T: toolCallLog.push() + ProgressReporter.update()
    end

    Q-->>T: msg.type='result' (cost, turns, duration, usage)

    T->>DB: updateTask({status, result_summary, cost_usd, ...})

    alt outputMode='embed' (/task 默认)
        T->>D: send(taskCompleteEmbed) 含 Tokens 字段
        T->>D: send(📋 执行轨迹 N 步)
    else outputMode='raw' (cron 触发)
        T->>D: 直接 chunkMessage(result) 发文本
    end
```

**Supervisor 模式精髓**

| 角色 | 职责 | 工具集（物理隔离） | 输出契约 |
|------|------|------|------|
| **Researcher** | 调研代码、收集 file:line 证据 | Read/Glob/Grep/WebFetch/MCP search | findings markdown |
| **Planner** | 基于调研出步骤化计划 | Read/Glob/Grep/WebFetch | spec + 验收命令清单 |
| **Generator** | 按计划写代码（**或先 Contract**） | Read/Write/Edit/Bash/Glob/Grep | 改动报告（不下"完成宣言"） |
| **Evaluator** | 独立验收 | Read/Grep/Glob/Bash | **`## Machine-Readable Verdict` YAML** |

**为什么这样设计**

- **物理工具隔离**：Researcher / Planner 没 Write/Edit 权限，模型即便冲动也写不了文件
- **Context 隔离**：subagent 看不到主 agent 历史，Supervisor 调用时**必须完整传上下文**
- **机器可读 verdict**：Evaluator 输出 YAML → Supervisor 程序化解析 → 决定 PASS / 自动 Fix 循环 / escalate
- **Contract 模式**：复杂任务 (>3 文件) Generator 先输出 Contract → Supervisor 审 → 第二轮真实施
- **canUseTool gate** 拦 `Skill(triad)` / `Skill(triad-resume)`：防 Supervisor 自动调用 CLI-only slash command

---

## 4. Cron 子系统

```mermaid
flowchart LR
    Boot[ClientReady] --> SS[startScheduler]
    SS --> LD[loadCronJobs<br/>scan ~/.miniclaw/cron/*.yaml]
    LD --> Reg[node-cron.schedule<br/>每个 enabled job 注册一个 ScheduledTask]

    subgraph Tick["定时触发 (每分钟检查)"]
        Reg --> Disp[dispatch by job.type]
        Disp --> RT[runner-task.ts<br/>type=task]
        Disp --> RS[runner-script.ts<br/>type=script]
        Disp --> RK[runner-task.ts<br/>type=skill]
        Disp --> RM[runner-message.ts<br/>type=message]
    end

    RT -->|"可选 pre_script"| Spawn[spawn 脚本 → stdout 拼到 prompt 顶部]
    RT --> ET1[executeTask<br/>outputMode='raw']

    RS --> Spawn2[spawn 脚本]
    Spawn2 -->|stdout| Parse[extractAttachments<br/>解析 MEDIA: 或 png_path]
    Parse --> Send1[Discord channel.send 文本 + 附件]

    RK --> ET2[executeTask<br/>outputMode='raw']
    RM --> RT2[renderTemplate {{date}} ...] --> Send2[channel.send]

    ET1 --> State[recordRun<br/>~/.miniclaw/cron/state.json<br/>last_run / completed / duration]
    ET2 --> State
    Send1 --> State
    Send2 --> State

    classDef boot fill:#fff7e6,stroke:#fa8c16
    classDef sched fill:#e6f7ff,stroke:#1890ff
    classDef runner fill:#f9f0ff,stroke:#722ed1
    classDef state fill:#f6ffed,stroke:#52c41a
    class Boot,SS boot
    class LD,Reg,Disp,Tick sched
    class RT,RS,RK,RM,Spawn,Spawn2,Parse,ET1,ET2,RT2 runner
    class State,Send1,Send2 state
```

**4 种 type 用法**

| type | 适合场景 | 示例 |
|------|----------|------|
| `task` | 纯 LLM 任务（搜资料 + 整理） | github-trending |
| `task` + `pre_script` | 先采集结构化数据再 LLM 分析（hermes hybrid 模式） | daily-tldr / daily-app-trending |
| `script` | 纯脚本输出（含图片附件） | hourly-token-report → PNG dashboard |
| `skill` | 调用用户级 subagent | （自定义）|
| `message` | 模板化推送 | morning-greet `{{date}}` |

---

## 5. 用户级目录布局（`~/.miniclaw/`）

```
~/.miniclaw/
├── data.db                  # SQLite: tasks + chat_history（运行时数据）
├── memories/
│   └── MEMORY.md            # 长期记忆（4 section + § 分隔，可 vim 编辑）
├── cron/
│   ├── *.yaml               # 15 个定时 job 定义
│   └── state.json           # last_run/completed/duration 持久化
├── scripts/
│   ├── *.py / *.sh          # cron type=script + pre_script 调用
│   └── ...                  # 可执行权限必需 (chmod +x)
├── skills/
│   └── *.md                 # 用户级 subagent (覆盖 repo agents/)
└── channel-map.json         # setup-miniclaw-channels.ts 输出
```

**严格分离原则**：repo 内是**通用代码**（任何人 fork 都能用），`~/.miniclaw/` 是**你的个人配置**（不进 git）。

---

## 数据库 schema

`~/.miniclaw/data.db`（SQLite WAL 模式）

```mermaid
erDiagram
    tasks {
        TEXT id PK
        TEXT discord_thread_id "空字符串 = 非 thread (cron 写入)"
        TEXT discord_user_id "user_id 或 'cron'"
        TEXT prompt
        TEXT cwd
        TEXT session_id "Agent SDK session, 用于 /resume + thread continuation"
        TEXT status "queued/running/completed/failed/cancelled/interrupted"
        TEXT result_summary
        REAL cost_usd
        INTEGER duration_ms
        TEXT created_at
        TEXT completed_at
        TEXT progress_message_id "用于跨进程恢复"
    }
    chat_history {
        INTEGER id PK
        TEXT discord_channel_id
        TEXT discord_user_id
        TEXT role "user/assistant"
        TEXT content
        TEXT created_at
    }
    memories_LEGACY {
        TEXT NOTE "已迁移到 ~/.miniclaw/memories/MEMORY.md，表保留作冷备不再读写"
    }
```

---

## 阅读建议

1. **第一次接触** → 看图 1 + 图 5（用户级目录），对照 `src/index.ts` + `src/bot.ts` 通读
2. **想改 chat 行为** → 看图 2，集中改 `src/agent/chat.ts`
3. **想加新 subagent** → 看图 3 + Supervisor 表，新增 `agents/<name>.md`（repo） 或 `~/.miniclaw/skills/<name>.md`（user）
4. **想加新 cron** → 看图 4，写 `~/.miniclaw/cron/<name>.yaml` 重启 bot
5. **想加新 slash command** → `register.ts` 注册 + `handlers.ts` 处理 + `bot.ts` switch case
