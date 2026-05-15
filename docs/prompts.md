# Prompt 资产管理

miniclaw 的所有"长 system prompt"集中存放在 `prompts/` 目录，由 `src/agent/prompts.ts` 加载器统一管理，支持用户级覆盖与变量插值。

## 当前 prompt 文件清单

| 文件 | 用途 | 调用方 | vars |
|---|---|---|---|
| `prompts/supervisor.md` | /task Supervisor 模式角色编排指南 | `src/agent/task.ts:buildSupervisorBlock` | `subagent_names` |
| `prompts/memory-extractor.md` | 从对话提取长期记忆候选的 system prompt；禁止 JSON/blob/log 直接成为 memory content | `src/memory/extract.ts` | （空） |
| `prompts/stage-manager.md` | Stage auto 模式的 next_speaker 决策器 | `src/stage/stage-manager.ts` | （空） |
| `prompts/templates/cron-pre-script-block.md` | cron pre_script stdout 注入包装 | `src/cron/runner-task.ts` | `script_name, output` |
| `prompts/templates/cron-task-prompt.md` | cron type=task prompt 最外层包装 | `src/cron/runner-task.ts` | `job_name, prepended_context, user_prompt` |
| `prompts/templates/cron-skill-prompt.md` | cron type=skill prompt | `src/cron/runner-task.ts` | `job_name, skill_name, args_block` |

> 与 `agents/*.md`（subagent 角色定义）、`personas/*.md`（Stage 角色卡）、`~/.miniclaw/memories/MEMORY.md`（长期记忆）的区别：那些是**领域资产**，prompts 是**框架级 system prompt**。

`memory-extractor` 只负责让 LLM 产生候选数组，不负责最终写入。候选会再经过 `src/memory/curation.ts` 的 type/name/content 校验、dirty content 拦截、canonical key 去重和合并决策；因此 prompt 里新增的 `confidence` 也只是候选 metadata，执行 task/chat 时不会被注入给下游 LLM。

## Code-Owned Prompt Fragments

这些片段目前不是 `prompts/*.md` 文件，因此没有用户级覆盖和 snapshot hash；它们是 runtime contract 的一部分，修改时必须同步对应 feature/plan 文档和 targeted tests。

| 片段 | 用途 | 调用方 | 验证 |
|---|---|---|---|
| Agent Run Manager child role prompt | 为 planner/generator/evaluator 构造 task brief、role instruction、agent roster、blackboard 和 extra context | `src/agent/run-manager/manager.ts:buildChildPrompt` | `src/agent/run-manager/__tests__/managed-runtime.test.ts` |
| `miniclaw_agent_envelope` fallback instruction | 要求 child run 在 final response 中返回 fenced JSON envelope，作为不支持 live bus runtime 的兼容回传 | `src/agent/run-manager/envelope.ts:formatManagedEnvelopeInstruction` | `src/agent/run-manager/__tests__/managed-runtime.test.ts` |
| Live Agent Bus MCP usage block | 告知 managed child 可用的 `miniclaw-agent-bus` MCP tools，同时保留 envelope fallback | `src/agent/run-manager/mcp/injection.ts:createManagedAgentBusContext` | `src/agent/run-manager/__tests__/managed-runtime.test.ts` |

## 文件格式

每个 .md 必含 YAML frontmatter：

```markdown
---
description: 一句话说明这个 prompt 干什么
kind: system           # system | template | block (信息字段，目前不影响行为)
vars: [name, count]    # 必填数组，可空 [] —— body 中除内置变量外的所有 {{xxx}} 必须 ⊆ vars
---
prompt body 在这里。可以用 {{name}} 和 {{count}}。
内置变量无需声明：{{date}} {{time}} {{iso}} {{weekday}}
```

## 模板语法

复用 `src/cron/template.ts` 的 `renderTemplate`：

- `{{var}}` → 从调用方传入或内置变量替换
- 未知占位符保留原文（但 vars 校验会在加载时拦截，所以理论上不会触发）
- 内置变量列表：

| 变量 | 示例 |
|---|---|
| `{{date}}` | `2026-04-30` |
| `{{time}}` | `14:30` |
| `{{iso}}` | `2026-04-30T06:30:00.000Z` |
| `{{weekday}}` | `周三` |

## vars 双向校验

加载器在读文件时做两道校验，校验失败立即 throw：

1. **body → vars**：扫描 body 中所有 `{{xxx}}`（排除内置），必须全部在 frontmatter `vars` 数组里
2. **caller → vars**：调用方 `loadPrompt(name, vars)` 传入的 keys 也必须 ⊆ frontmatter `vars`

这能把"prompt 改了忘改调用方"或"调用方传了拼写错误的 var"的 bug 拦在加载阶段。

## 用户级覆盖

把任意 `prompts/<name>.md` 复制到 `~/.miniclaw/prompts/<name>.md` 即可覆盖（含子目录如 `templates/`）。加载器优先级：

1. `~/.miniclaw/prompts/<name>.md` (user override)
2. `<repo>/prompts/<name>.md` (repo 默认)
3. 都不存在 → throw 含完整路径与 hint

可用 `MINICLAW_PROMPTS_DIR` 环境变量改 user override 目录。

> ⚠️ 改 user override 文件之前先看清楚原 prompt 的设计意图。`prompts/supervisor.md` 直接影响所有 /task 行为，乱改可能导致 subagent 编排失控。

## 缓存与热重载

加载器内置 mtime cache：进程内同一 prompt 同一 mtime 只读一次磁盘。**改 .md 文件无需重启进程**——下次调用会检测到 mtime 变化重新加载。

如果担心生产环境的 stat 开销，设 `MINICLAW_PROMPT_CACHE=strict` 永远不失效（适合 pm2 长驻；改文件后须重启）。

## 调试

加载失败的错误信息包含：

- prompt 名
- 解析出的绝对路径（标明 repo 还是 user override）
- 具体失败原因（缺 description / vars 不匹配 / 文件不存在 / YAML 解析失败）
- hint（建议怎么修）

例：

```
[prompts] 'supervisor' at /Users/.../miniclaw/prompts/supervisor.md (repo):
  body uses {{turn_count}} but frontmatter vars=[subagent_names]
  hint: 把缺失的 var 加到 frontmatter `vars` 数组里，或删掉 body 中的占位符
```

## Session Workflow（改 prompt 必看）

修改 `prompts/*.md` 必须：

1. 改完跑 `pnpm test prompt-snapshot` —— 11 个 hash 会失败
2. 确认 diff 是有意的（git diff 看 .md，对照 prompt-snapshot.test.ts 期望）
3. `pnpm exec vitest run src/__tests__/prompt-snapshot.test.ts -u` 更新 hash
4. 把 .md + 更新后的 test snapshot 一并提交

snapshot 失败时**不要无脑 -u**，先确认是有意改动。snapshot 是防"无意中破坏 prompt 行为"的最后一道关。

## 为什么这样设计

- **B 类（中长 system prompt）→ 文件化**：vim 可编辑，git diff 友好，用户可覆盖
- **C 类（极短 / 高度动态片段）→ 留代码**：identity 一句话不值得 IO，buildHistoryPrompt 拼装太动态
- **D 类（cron 模板）→ 文件 + `{{var}}`**：cron 用户已习惯 `{{var}}` 心智，零额外学习
- **加载失败 throw**：与 subagent 跳过坏文件不同——prompts 是核心系统资产，缺一不可
- **复用 cron renderTemplate**：避免引入第二套模板语法
