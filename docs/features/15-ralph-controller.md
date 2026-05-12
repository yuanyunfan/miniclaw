# Ralph Controller

Status: draft
Date: 2026-05-12

## TLDR

MiniClaw Ralph 是一个轻量外部执行控制器：它不把 Codex 长会话当状态源，而是用 repo 内 plan、队列、Git worktree、验证命令和 commit/push 边界来驱动每个任务。每次任务执行都会启动新的 `codex exec --ephemeral`，从而获得 fresh context。第一版默认 dry-run，只有显式 `--execute` 才会创建 worktree 并运行 Codex。

## Purpose

MiniClaw 的持续优化任务已经被拆成 `docs/plans/2026-05-11-*.md`。这些任务适合 Ralph 风格执行：

- plan 是任务 spec。
- 每个 task 在独立 worktree/branch 中运行。
- Codex 每轮 fresh context。
- Controller 负责验证、commit 和 push。
- Git 是 rollback 和审查边界。

这和普通 Codex 聊天不同。Codex 不负责长期队列状态；长期状态由 repo 文件和 Git 历史维护。

## Files

- `docs/ralph/README.md`: Ralph 运行协议。
- `docs/ralph/queue.json`: 当前计划任务队列。
- `docs/ralph/learnings.md`: append-only lessons。
- `.ralph/`: 本机 raw run logs，已被 `.gitignore` 忽略。
- `scripts/ralph-run.ts`: worktree + fresh Codex session controller。
- `scripts/ralph-verify.ts`: per-task verification runner。

## Commands

Inspect the next task without running Codex:

```bash
pnpm ralph:run -- --task task-view-boundary
```

Execute one task in an isolated worktree:

```bash
pnpm ralph:run -- --task task-view-boundary --execute
```

Execute and push the task branch:

```bash
pnpm ralph:run -- --task task-view-boundary --execute --push
```

Run verification for a task in the current checkout:

```bash
pnpm ralph:verify -- --task task-view-boundary
```

## Execution Model

1. `ralph:run` resolves a task from `docs/ralph/queue.json`.
2. It checks that the controller checkout is clean.
3. It creates an isolated Git worktree under `../miniclaw-ralph/<task-id>` by default.
4. It starts Codex with `codex exec --ephemeral --sandbox workspace-write`.
5. Codex receives a strict prompt: implement only the first independently shippable slice, do not commit, do not push, update the plan notes.
6. The controller checks for a non-empty diff.
7. The controller runs `pnpm ralph:verify`.
8. If verification passes, the controller commits the worktree branch.
9. If `--push` is set, the controller pushes the task branch to `origin`.

## Safety Boundaries

- `ralph:run` defaults to dry-run.
- Codex is instructed not to commit or push.
- Raw Codex JSONL/stdout/stderr logs are written under ignored `.ralph/`.
- The controller refuses to run from a dirty checkout unless `--force` is used.
- `--push` is explicit; local branch commit is the default execute behavior.
- Existing git hooks still run on controller-created commits.

## Relationship To Plans

`docs/plans/*.md` remains the source of task scope. Ralph can update a plan's `Execution Notes`, but the plan body should be treated as spec. Material scope changes should happen as a separate docs commit, not hidden inside a task implementation branch.

## Current Limits

- Queue status is not auto-mutated in the first version.
- Raw run logs are local-only under `.ralph/`.
- Automatic retry is not implemented.
- Parallel execution is possible by choosing different tasks, but merging branches still needs human sequencing.

