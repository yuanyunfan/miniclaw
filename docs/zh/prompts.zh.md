---
doc_id: prompts
lang: zh
translation_of: docs/prompts.md
translation_status: current
source_sha256: 8c44f79d4f90d28ffc4b6d95dd5bf069d2a952ad669533203536248756a517c1
---
# Prompt 资产管理

MiniClaw 把较长的 framework-owned system prompt 放在 repo 级 `prompts/` 目录。runtime 代码通过 `src/agent/prompts.ts` 加载它们，使 prompt 内容可以 version、diff、snapshot test，并支持用户级 override。

## 当前 Prompt 文件

| 文件 | 用途 | 调用方 | Vars |
|---|---|---|---|
| `prompts/supervisor.md` | `/task` Supervisor 角色编排指南 | `src/agent/task.ts:buildSupervisorBlock` | `subagent_names` |
| `prompts/memory-extractor.md` | 从对话文本提取长期 memory candidate 的 system prompt；禁止 raw JSON、blob、log 等 payload 直接成为 memory content | `src/memory/extract.ts` | 无 |
| `prompts/stage-manager.md` | Stage auto-mode 的 `next_speaker` 决策器 | `src/stage/stage-manager.ts` | 无 |
| `prompts/templates/cron-pre-script-block.md` | 把 cron `pre_script` stdout 注入 task prompt 的 wrapper | `src/cron/runner-task.ts` | `script_name`, `output` |
| `prompts/templates/cron-pre-provider-block.md` | 把 cron provider output 注入 task prompt 的 wrapper | `src/cron/runner-task.ts` | `provider_name`, `output` |
| `prompts/templates/cron-task-prompt.md` | cron `type=task` prompt 的外层 wrapper | `src/cron/runner-task.ts` | `job_name`, `prepended_context`, `output_contract`, `user_prompt` |
| `prompts/templates/cron-skill-prompt.md` | cron `type=skill` prompt 的 wrapper | `src/cron/runner-task.ts` | `job_name`, `skill_name`, `args_block` |

prompt 资产不同于 `agents/*.md` role definition、`personas/*.md` Stage persona 和 `~/.miniclaw/memories/MEMORY.md` 长期记忆。那些是 domain 或 user asset；`prompts/` 是 framework-level runtime contract。

## Cron Output Templates

Cron `type=task` job 可以把 inline template 直接写在每个 job 的 `~/.miniclaw/cron/*.yaml` 里，用来注入 prompt-level output contract：

```yaml
output_template: |
  Required structure:
  ## Summary
  Give the direct {{audience}} conclusion.

  ## Key Findings
  List the important observations.
output_template_vars:
  audience: personal
```

`output_template_vars` 是可选字段。不配置时，MiniClaw 只渲染内置 date/time 变量，其余按 inline text 原样使用。

需要设置预留 validator 字段时，可以用规范化写法：

```yaml
output_contract:
  template: |
    Required structure:
    ## Summary
    Give the direct {{audience}} conclusion.
  vars:
    audience: personal
  validator: none
```

loader 会把两种写法统一成 `output_contract`。`output_template` 和 `output_contract` 不能同时配置。

Cron output template 属于 cron job 配置，不是 repo prompt asset：MiniClaw 不会再加载 `prompts/templates/cron-output/<id>.md`。渲染后的 contract 会注入到 provider/script context 之后、job prompt 之前。它只约束 LLM 输出格式，不会在 execution 之后重写最终消息。

配置 output contract 时，MiniClaw 会先注入一段共享 output surface policy：面向 chat/IM delivery 的紧凑 Markdown、不要 Markdown pipe table、先结论后证据、只输出最终报告。每个 job 的 cron YAML 不要重复这些通用规则；`output_template` 应只写报告结构、必需机器块，以及 privacy、link style、长度限制等 job-specific 例外。

`output_contract.validator` 预留 runtime validation。v1 只支持 `none`；validator hook 仍会在 successful task result 之后、extra delivery、attachment delivery 和 provider commit callback 之前运行，方便后续 validator 在单一位置阻止投递并交给 scheduler retry。

## 代码内置 Prompt 片段

有些 prompt fragment 仍故意保留在代码里，因为它们很短、很动态，或和 runtime contract 强耦合。修改它们时必须同步 tests 和 docs。

| 片段 | 用途 | 调用方 | 验证 |
|---|---|---|---|
| Agent Run Manager child role prompt | 为 planner/generator/evaluator child run 构造 task brief、role instruction、agent roster、blackboard 和 extra context | `src/agent/run-manager/manager.ts:buildChildPrompt` | `src/agent/run-manager/__tests__/managed-runtime.test.ts` |
| `miniclaw_agent_envelope` fallback instruction | live bus tool 不可用时，要求 child run 返回 fenced JSON envelope | `src/agent/run-manager/envelope.ts:formatManagedEnvelopeInstruction` | `src/agent/run-manager/__tests__/managed-runtime.test.ts` |
| Live Agent Bus MCP usage block | 告诉 managed child run 如何使用 `miniclaw-agent-bus` MCP tools，同时保留 envelope fallback | `src/agent/run-manager/mcp/injection.ts:createManagedAgentBusContext` | `src/agent/run-manager/__tests__/managed-runtime.test.ts` |

## 文件格式

每个 prompt 文件必须包含 YAML frontmatter：

```markdown
---
description: One sentence describing what this prompt does
kind: system           # system | template | block
vars: [name, count]    # required array; may be []
---
Prompt body can use {{name}} and {{count}}.
Built-in variables do not need declaration: {{date}} {{time}} {{iso}} {{weekday}}
```

## Template 语法

prompt template 复用 `src/cron/template.ts:renderTemplate`。

- `{{var}}` 会被 caller-provided value 替换。
- unknown placeholder 会保留原样，但 loader validation 理论上会在 runtime 前失败。
- built-in variables 不需要 frontmatter declaration：

| Variable | Example |
|---|---|
| `{{date}}` | `2026-04-30` |
| `{{time}}` | `14:30` |
| `{{iso}}` | `2026-04-30T06:30:00.000Z` |
| `{{weekday}}` | `Wednesday` |

## Loader 校验

loader 读取 prompt 文件时会做两类校验：

1. Body variables：body 里的每个 `{{name}}`，排除 built-ins 后，必须出现在 frontmatter `vars`。
2. Caller variables：传给 `loadPrompt(name, vars)` 的每个 key 也必须在 frontmatter `vars` 中声明。

这样可以在 prompt 到达 LLM 前发现 missing variable 和拼写错误。

## 用户级 Override

用户可以把文件复制到 `~/.miniclaw/prompts/<name>.md` 来 override repo prompt。loader 优先级：

1. `~/.miniclaw/prompts/<name>.md`
2. `<repo>/prompts/<name>.md`

`MINICLAW_PROMPTS_DIR` 可以指向不同的用户级 override 目录。

修改 `prompts/supervisor.md` 会影响全部 `/task` 行为。override 前必须先理解它的设计意图。

## Cache 与热重载

loader 按 file mtime 缓存每个 prompt。编辑 prompt 文件后不需要重启进程；下一次加载会检测 mtime 变化并重新读取。

`MINICLAW_PROMPT_CACHE=strict` 会禁用 mtime invalidation，适合 prompt 内容只应通过进程重启变更的长期生产运行。

## 失败输出

prompt 加载失败会报告：

- prompt name
- resolved absolute path
- 文件来自 repo default 还是 user override
- 具体失败原因，例如 missing frontmatter、unknown variable、missing file 或 YAML parsing failure
- remediation hint

Example：

```text
[prompts] 'supervisor' at /path/to/miniclaw/prompts/supervisor.md (repo):
  body uses {{turn_count}} but frontmatter vars=[subagent_names]
  hint: add the missing var to frontmatter vars, or remove the placeholder from the body
```

## Prompt 变更流程

修改 `prompts/*.md` 时：

1. 运行 prompt snapshot test，并预期 prompt 行为变化时 hash 会失败。
2. review diff，确认 prompt change 是 intentional。
3. 用 `pnpm exec vitest run src/__tests__/prompt-snapshot.test.ts -u` 更新 snapshot。
4. prompt 文件和更新后的 snapshot 必须一起提交。

不要无脑更新 snapshot。snapshot 是防止 accidental prompt behavior drift 的最后一道防线。

## 设计理由

- 中等长度 system prompt 适合放 Markdown：便于 Vim 编辑、Git diff、用户 override。
- 极短或高度动态的片段适合留在代码里。
- cron template 使用 `{{var}}`，因为 cron 用户已经在 YAML 里使用类似模板，不需要第二套语法。
- prompt load failure 是 hard failure，因为 prompt 是核心 runtime asset。
- 复用 cron renderer，避免引入第二套 template language。
