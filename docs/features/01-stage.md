# MiniClaw Stage — 实验性 CLI 多 Agent 控制台

> 结论：Stage 是 experimental playground，用于 persona、多 agent turn-taking、CLI/TUI workflow 和调度策略研究；它不是 Discord bot 的默认 task runtime，也不定义 MiniClaw 的主产品面。
> 当前可用入口仍是 `pnpm stage` 和 `pnpm stage:repl`。Stage 可以复用稳定的低层共享能力，但 Stage persona、TUI、orchestrator 和 multi-agent 协议不能反向牵动 Discord task 行为。

---

## 启动

```bash
pnpm stage         # Ink TUI（4 pane 主界面，推荐）
pnpm stage:repl    # readline REPL（无 TUI，适合 ssh / log 友好场景）
```

---

## 实验边界

Stage 的定位：

- persona 和 multi-agent workflow 研究沙盒。
- 终端内可观察的 turn-taking、budget guard、scene 保存/恢复实验面。
- 未来可验证 `AgentRuntime`、`ModelClient` 或 prompt utility 是否适合复用的 playground。

Stage 的非目标：

- 不替代 Discord bot 的 `/task`、thread continuation、button routing 或 task view reporter。
- 不让多 agent 成为 MiniClaw task 的默认执行路径。
- 不引入 Stage-only UX 约束来重塑 Discord-native delivery。
- 不把真实 Discord/LLM Stage E2E 加进 commit/push 门禁；Stage 仍以 focused tests 和手动 TTY smoke 为主。

源码边界：

- Stage 可以直接依赖低层共享模块，例如 `src/lib/log.ts`、只读 config summary、prompt utilities、scene persistence helper 和稳定的 runtime/model contracts。
- Stage 不应 import `src/bot.ts`、`src/bot/*`、`src/discord/*` 或 `src/commands/*`。
- Discord runtime 模块不应 import `src/stage/*`；Stage 的 persona、TUI state 和 orchestrator 不能成为默认 Discord task behavior。

当前 runtime-contract 状态：

- `AgentRuntime` / `ModelClient` 已经存在于共享 runtime 层，但当前 `AgentRuntime` adapters 主要服务长任务 `startTask`，没有提供 Stage 所需的 persona turn、streaming delta 和 tool callback contract。
- Stage 继续保留自己的 `chatOnce` 路径，直到出现稳定的 Stage-compatible chat turn contract；不要为了抽象一致性把 Stage 强行接入 task runtime。

---

## 4 pane 布局

```
┌─ 🎭 Roster ────────┐  ┌─ 💬 Stream ───────────────────────────────┐
│ 🧠 🎩 CEO          │  │ [10:01:23] yyf: 做个登录页                 │
│ ⏸  💻 Engineer     │  │ [10:01:25] 🎩 CEO: @engineer 你出方案     │
│ ⏸  🧪 Tester       │  │ [10:01:50] 💻 Engineer: 思路是…           │
│                     │  │   🔧 read_file ✓                          │
│ 未召唤：            │  │ · stage-manager → @tester (验收)          │
│ ○ ...               │  │ [10:02:30] 🧪 Tester: 测试用例 …          │
└────────────────────┘  └────────────────────────────────────────────┘
                        ┌─ 📊 Active ────────┐
                        │ 💻 Engineer        │
                        │ status: thinking   │
                        │ 累计：             │
                        │ tok in: 3540       │
                        │ tok out: 612       │
                        │ tools: 2           │
                        │ cost: $0.0210      │
                        │                    │
                        │ Scene              │
                        │ turns: 4/30        │
                        │ cost: $0.06/$2     │
                        │ mode: manual       │
                        └────────────────────┘
┌─ > 输入消息或 /help 看命令 ───────────────────────────────────────┐
└──────────────────────────────────────────────────────────────────┘
```

状态图标：`⏸ idle` `🧠 thinking` `💬 speaking` `🔧 tool-call` `✗ aborted` `✓ done`

---

## Slash 命令

| 命令 | 作用 |
|---|---|
| `/summon <id> [id2 ...]` | 召唤一或多个 persona 进场 |
| `/dismiss <id>` | 遣散（中断 in-flight 调用） |
| `/say @<id> <msg>` | 等价于直接输入 `@<id> <msg>` |
| `/all <msg>` | 广播给所有在场 agent，每人独立 turn |
| `/abort` | 中断当前发言 agent |
| `/auto` | 切到 Stage Manager 自动 turn-taking |
| `/manual` | 切回 @-driven |
| `/save [name]` | 保存 scene → `~/.miniclaw/scenes/<name>.md` + DB |
| `/load <name>` | 恢复 scene |
| `/roster` | 列出所有 personas（在场/未召唤） |
| `/cost` | 当前 scene 花费分布 |
| `/clear` | 重置 scene messages（保留 personas） |
| `/q` | 退出 |
| `/help` | 命令清单 |

直接输入文字（无 `/`）= 你以"yyf"身份发言；含 `@<id>` 触发对应 agent 回应。

---

## 架构

```mermaid
flowchart TB
    User([用户键盘])
    User -->|TextInput| CB[CommandBar]
    CB -->|parseCommand| CMD[commands.ts]
    CMD -->|userSay/summon/...| ORCH[Orchestrator]

    ORCH -->|EventEmitter| Store[ui/store.ts<br/>mutable state]
    Store -->|useStore hook| App[App.tsx 重渲染]
    App --> Roster
    App --> Stream
    App --> Detail

    ORCH -->|tick 队列| Agent[chatOnce<br/>agent.ts]
    Agent -->|messages.stream| Anthropic[Anthropic API]
    Agent -->|tool_use| Tools[chat-tools.ts<br/>read_file/bash/web_fetch]

    ORCH -->|auto 模式队列空| SM[stage-manager.ts<br/>next_speaker LLM]

    ORCH -->|append| DB[(SQLite<br/>scenes/scene_messages)]
    ORCH -->|/save| MD[~/.miniclaw/scenes/<name>.md]
    ORCH -->|/load| MD
```

### 文件分工

| 文件 | 职责 |
|---|---|
| `src/stage/types.ts` | Persona / Scene / SceneMessage / AgentStatus 类型 |
| `src/stage/personas.ts` | 加载 `personas/*.md` + `~/.miniclaw/personas/*.md`；解析 `@mention` |
| `src/stage/agent.ts` | `chatOnce(persona, history, callbacks)` 纯函数；复用 chat-tools |
| `src/stage/orchestrator.ts` | 调度核心：scene 状态机 + 队列 + 三层 cap + tick |
| `src/stage/stage-manager.ts` | auto 模式 next_speaker 决策（独立小成本 LLM） |
| `src/stage/scene-store.ts` | Save/Load：双轨 markdown + DB |
| `src/stage/commands.ts` | slash 命令解析 + dispatcher |
| `src/stage/repl.ts` | readline 入口（TUI 之外的可用通道） |
| `src/stage/index.tsx` | Ink 入口：`pnpm stage` |
| `src/stage/ui/store.ts` | 单 mutable store + `useStore` hook |
| `src/stage/ui/{App,Roster,Stream,Detail,CommandBar}.tsx` | UI 组件 |

### 复用 miniclaw 现有

| 复用 | 用途 |
|---|---|
| `src/agent/chat-tools.ts` | 4 个工具的 schema + executor，agent.ts 直接调 |
| `src/agent/subagents.ts` | `parseFrontmatter`，personas.ts 复用 |
| `src/lib/log.ts` | logger（模块 tag: `[stage]` `[orchestrator]` `[agent]` `[scene-store]` `[stage-manager]` `[personas]`） |
| `src/store/db.ts` | Stage scene helper 写入 `scenes` + `scene_messages` |
| `src/config.ts` | 读取 provider/model/base URL 等 runtime 配置，不拥有 Discord routing |

---

## Persona 文件格式

`personas/<id>.md`（repo 默认）或 `~/.miniclaw/personas/<id>.md`（用户覆盖）：

```markdown
---
name: CEO
emoji: 🎩
model: claude-opus-4-7                # 可选，默认 config.model
tools: [read_file, web_fetch]         # 可选，默认全部 chat-tools
budget_per_turn_usd: 0.20             # 可选（暂仅记录）
---

你是 MiniClaw Stage 剧团的 CEO，负责...
```

文件名（去 `.md` 小写化）= persona id（@-mention 用）。

MVP 自带 `ceo.md` / `engineer.md` / `tester.md`。

---

## Anti-Loop / Budget Guards

| 触发 | 行为 |
|---|---|
| 同 agent 连续 ≥3 轮无 user 输入 | 暂停队列，提示用户 |
| Scene total turns ≥ `MINICLAW_STAGE_TURN_CAP`（默认 30） | 暂停 |
| Scene total cost ≥ `MINICLAW_STAGE_BUDGET_USD`（默认 $2） | **强制 abort 全场，清空队列** |
| Agent 自己 @ 自己 | `chatOnce` 静默过滤 |
| @ 不在场 persona | UI 提示 `先 /summon` |
| auto 模式 stage-manager 想让同 speaker 连续 ≥2 turn | 强制切到另一在场 agent |

环境变量：

```bash
MINICLAW_STAGE_BUDGET_USD=2          # 单 scene 预算上限
MINICLAW_STAGE_TURN_CAP=30           # 单 scene turn 上限
MINICLAW_STAGE_SAME_SPEAKER_CAP=3    # 同 speaker 连续 N 次 → pause
```

---

## 持久化

```
~/.miniclaw/scenes/
├── login-demo.md       # /save login-demo 生成的 transcript
└── another.md
```

Markdown transcript 格式：metadata 头 + 每条消息一个 H3 段（带时间戳 / emoji / 工具调用 / cost）。

DB 镜像同步在 `data.db`（`scenes` + `scene_messages` 两表）。

---

## auto-mode 工作流

```mermaid
sequenceDiagram
    participant U as User
    participant O as Orchestrator
    participant A as Agent (chatOnce)
    participant S as Stage Manager

    U->>O: /summon ceo engineer tester
    U->>O: /auto
    U->>O: @ceo 做登录页
    O->>A: chatOnce(ceo, history)
    A-->>O: "@engineer 你看下" + 解析 mentions
    O->>O: 入队 engineer
    O->>A: chatOnce(engineer, ...)
    A-->>O: "已设计，@tester 看用例"
    O->>O: 入队 tester
    O->>A: chatOnce(tester, ...)
    A-->>O: "✅ 通过"
    Note over O: 队列空 + mode=auto
    O->>S: pickNextSpeaker(participants, history)
    S-->>O: {next: "user", reason: "tester 已通过，等用户决定下一步"}
    O->>U: pause + notice
```

---

## 验收

```bash
pnpm vitest run src/stage               # Stage 单测 + import boundary 静态检查
pnpm exec tsc --noEmit                  # 类型通过
pnpm stage                              # 真 TTY 跑 TUI（手 E2E）
```

剧本演示：

```
> /summon ceo engineer tester
> @ceo 做个简单登录页
... (CEO @engineer)
... (Engineer 调 read_file 探查项目)
... (Engineer @tester)
... (Tester 列出 5 个用例)
> /cost                              # 查看花费
> /save login-demo                   # 持久化
> /q
$ pnpm stage
> /load login-demo                   # 恢复继续
> @engineer 那个边界 case 改了吗
```

---

## 后续可扩展（v2+）

- Discord webhook 镜像：每 persona 独立头像/名字回灌到 channel
- Per-persona memory namespace（`~/.miniclaw/memories/<persona>.md`）
- worker_threads 进程隔离（OOM 保护）
- 跨 LLM 厂商（Codex / Gemini 通过 ACP）
- Web UI 浏览器版

---

## Promotion Criteria

Stage 只有在满足以下条件后，才应从 experimental playground 升级为 core MiniClaw capability：

- 有稳定的 docs index 和 source-of-truth feature doc。
- 有 runtime health、usage accounting 和 failure visibility。
- 有独立的 Stage quality gates，且不会阻塞 Discord bot 的常规质量门禁。
- 有清晰 Discord integration strategy，说明哪些 Stage 行为可以进入 Discord，哪些只能留在 CLI/TUI。
- 有明确用户价值，且价值不只是“多 agent 看起来更强”。
