# Prompt Asset Management

MiniClaw keeps long framework-owned system prompts in the repo-level `prompts/` directory. Runtime code loads them through `src/agent/prompts.ts` so that prompt content is versioned, diffable, snapshot-tested, and optionally overrideable at the user level.

## Current Prompt Files

| File | Purpose | Caller | Vars |
|---|---|---|---|
| `prompts/supervisor.md` | `/task` Supervisor role orchestration guide | `src/agent/task.ts:buildSupervisorBlock` | `subagent_names` |
| `prompts/memory-extractor.md` | System prompt for extracting long-term memory candidates from conversation text; forbids raw JSON, blob, logs, and similar payloads from becoming memory content directly | `src/memory/extract.ts` | none |
| `prompts/stage-manager.md` | Stage auto-mode `next_speaker` decider | `src/stage/stage-manager.ts` | none |
| `prompts/templates/cron-pre-script-block.md` | Wrapper for injecting cron `pre_script` stdout into a task prompt | `src/cron/runner-task.ts` | `script_name`, `output` |
| `prompts/templates/cron-pre-provider-block.md` | Wrapper for injecting cron provider output into a task prompt | `src/cron/runner-task.ts` | `provider_name`, `output` |
| `prompts/templates/cron-task-prompt.md` | Outer wrapper for cron `type=task` prompts | `src/cron/runner-task.ts` | `job_name`, `prepended_context`, `output_contract`, `user_prompt` |
| `prompts/templates/cron-skill-prompt.md` | Wrapper for cron `type=skill` prompts | `src/cron/runner-task.ts` | `job_name`, `skill_name`, `args_block` |

Prompt assets are different from `agents/*.md` role definitions, `personas/*.md` Stage personas, and `~/.miniclaw/memories/MEMORY.md` long-term memory. Those are domain or user assets. `prompts/` contains framework-level runtime contracts.

## Cron Output Templates

Cron `type=task` jobs can opt into a prompt-level output contract by putting an inline template directly in the per-job YAML under `~/.miniclaw/cron/*.yaml`:

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

`output_template_vars` is optional. If omitted, MiniClaw renders the template with built-in date/time variables only and otherwise uses the inline text as written.

Advanced jobs can use the normalized form when they need to set the reserved validator field:

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

The loader normalizes both forms into `output_contract`. `output_template` and `output_contract` are mutually exclusive.

Cron output templates are cron-job configuration, not repo prompt assets: MiniClaw does not load `prompts/templates/cron-output/<id>.md`. The rendered contract is injected after provider/script context and before the job prompt. It guides the LLM output shape but does not rewrite the final message after execution.

MiniClaw prepends a shared output surface policy before the job-specific template whenever an output contract is configured: concise Markdown for chat/IM delivery, no Markdown pipe tables, conclusion before evidence, and final report only. Per-job cron YAML should not repeat those generic rules; keep `output_template` focused on the report structure, required machine blocks, and job-specific exceptions such as privacy boundaries, link style, or length limits.

`output_contract.validator` is reserved for runtime validation. v1 supports only `none`; the validator hook still runs after a successful task result and before extra delivery, attachment delivery, and provider commit callbacks so future validators can block delivery and retries at a single point.

## Cron Composition

Local cron jobs can stay compact by referencing reusable profiles and prompt fragments from the same cron directory:

```yaml
name: cn-stock-pre-market
schedule: "45 8 * * 1-5"
timezone: Asia/Shanghai
channel: "REPLACE_WITH_DISCORD_CHANNEL_ID"
workflow:
  profile: stock.pre_market_forecast
  main_provider: market-intel/cn-pre-market
  context_providers:
    - market-context/cn-hk-inject
rules:
  use:
    - stock.etf_premium_cn
output_template: |
  # A股/港股盘前报告 - YYYY-MM-DD
prompt: |
  Job-specific objective.
```

Profiles live under `~/.miniclaw/cron/_profiles/*.yaml`; fragments live under `~/.miniclaw/cron/_fragments/*.yaml`. The loader ignores those subdirectories as jobs, then expands `workflow.profile`, `workflow.main_provider`, `workflow.context_providers`, `workflow.preflight`, and `rules.use` before validating the final `CronJobTask`.

Composition is intentionally prompt-level only. Profiles and fragments can provide shared task instructions, privacy boundaries, evidence rules, and workflow defaults such as `type: task`, `timeout_ms`, or `pre_provider_preflight`. Per-job YAML should still own schedule, channel, workflow wiring, job-specific `output_template`, and any genuinely unique task objective.

## Code-Owned Prompt Fragments

Some prompt fragments are intentionally still code-owned because they are short, dynamic, or tightly coupled to runtime contracts. They must be changed together with tests and docs.

| Fragment | Purpose | Caller | Verification |
|---|---|---|---|
| Agent Run Manager child role prompt | Builds task brief, role instruction, agent roster, blackboard, and extra context for planner/generator/evaluator child runs | `src/agent/run-manager/manager.ts:buildChildPrompt` | `src/agent/run-manager/__tests__/managed-runtime.test.ts` |
| `miniclaw_agent_envelope` fallback instruction | Requires child runs to return a fenced JSON envelope when live bus tools are unavailable | `src/agent/run-manager/envelope.ts:formatManagedEnvelopeInstruction` | `src/agent/run-manager/__tests__/managed-runtime.test.ts` |
| Live Agent Bus MCP usage block | Tells managed child runs how to use the `miniclaw-agent-bus` MCP tools while preserving envelope fallback | `src/agent/run-manager/mcp/injection.ts:createManagedAgentBusContext` | `src/agent/run-manager/__tests__/managed-runtime.test.ts` |

## File Format

Each prompt file must contain YAML frontmatter:

```markdown
---
description: One sentence describing what this prompt does
kind: system           # system | template | block
vars: [name, count]    # required array; may be []
---
Prompt body can use {{name}} and {{count}}.
Built-in variables do not need declaration: {{date}} {{time}} {{iso}} {{weekday}}
```

## Template Syntax

Prompt templates reuse `src/cron/template.ts:renderTemplate`.

- `{{var}}` is replaced by the caller-provided value.
- Unknown placeholders remain unchanged, but loader validation should normally fail before runtime.
- Built-in variables are available without frontmatter declaration:

| Variable | Example |
|---|---|
| `{{date}}` | `2026-04-30` |
| `{{time}}` | `14:30` |
| `{{iso}}` | `2026-04-30T06:30:00.000Z` |
| `{{weekday}}` | `Wednesday` |

## Loader Validation

The loader validates prompt files when reading them:

1. Body variables: every `{{name}}` in the body, excluding built-ins, must appear in frontmatter `vars`.
2. Caller variables: every key passed to `loadPrompt(name, vars)` must also be declared in frontmatter `vars`.

This catches missing variables and misspelled placeholder names before the prompt reaches an LLM.

## User-Level Overrides

Users may override repo prompts by copying a file to `~/.miniclaw/prompts/<name>.md`. Loader priority is:

1. `~/.miniclaw/prompts/<name>.md`
2. `<repo>/prompts/<name>.md`

`MINICLAW_PROMPTS_DIR` can point to a different user override directory.

Changing `prompts/supervisor.md` affects all `/task` behavior. Review its design intent before overriding it.

## Cache And Hot Reload

The loader caches each prompt by file mtime. The process does not need a restart after prompt file edits; the next load detects the changed mtime and reloads the file.

`MINICLAW_PROMPT_CACHE=strict` disables mtime invalidation for long-lived production runs where prompt content should only change after a process restart.

## Failure Output

Prompt load failures report:

- prompt name
- resolved absolute path
- whether the file came from repo defaults or user override
- concrete failure reason, such as missing frontmatter, unknown variable, missing file, or YAML parsing failure
- remediation hint

Example:

```text
[prompts] 'supervisor' at /path/to/miniclaw/prompts/supervisor.md (repo):
  body uses {{turn_count}} but frontmatter vars=[subagent_names]
  hint: add the missing var to frontmatter vars, or remove the placeholder from the body
```

## Prompt Change Workflow

When changing `prompts/*.md`:

1. Run the prompt snapshot test and expect hashes to fail if prompt behavior changed.
2. Review the diff and confirm the prompt change is intentional.
3. Update the snapshot with `pnpm exec vitest run src/__tests__/prompt-snapshot.test.ts -u`.
4. Commit the prompt file and updated snapshot together.

Do not blindly update snapshots. The snapshot is the last guard against accidental prompt behavior drift.

## Design Rationale

- Medium-length system prompts belong in Markdown: editable in Vim, friendly to Git diff, and overrideable by users.
- Very short or highly dynamic snippets belong in code.
- Cron templates use `{{var}}` because cron users already write YAML-style templates and do not need another syntax.
- Prompt load failures are hard failures because prompts are core runtime assets.
- Reusing the cron renderer avoids a second template language.
