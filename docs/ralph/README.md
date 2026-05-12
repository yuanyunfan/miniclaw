# MiniClaw Ralph

MiniClaw Ralph is a thin controller for running plan-based Codex work with fresh context.

It is intentionally external to the bot runtime. The Discord bot does not call this controller, and Ralph does not modify live MiniClaw state.

## Core Rules

- One plan task per Codex run.
- One fresh `codex exec --ephemeral` context per task attempt.
- One isolated Git worktree/branch per task.
- The controller verifies, commits, and optionally pushes.
- `ralph:next` and `ralph:loop` keep `main` as the serial integration line when `--merge-main` is used.
- Raw run logs are local and ignored under `.ralph/`.
- Durable learning is append-only in `docs/ralph/learnings.md`.

## Queue

`docs/ralph/queue.json` maps stable task ids to plan docs, verification profiles, and target branch names.

Queue `status` values control the next/loop cursor:

- `pending`
- `running`
- `blocked`
- `done`
- `skipped`

`ralph:next` and `ralph:loop` select the first task whose queue status is `pending` and whose plan `Status:` is not closed. Closed plan statuses are `blocked`, `closed`, `done`, `shipped`, `skipped`, and `superseded`.

A plan can stay `pending` across multiple Ralph iterations. This is intentional: each Codex run is instructed to land only the next independently shippable slice. Mark the plan or queue item closed only when the plan is genuinely complete or intentionally deferred.

## Dry Run

```bash
pnpm ralph:run -- --task task-view-boundary
```

Dry-run mode prints the resolved task, worktree path, branch, prompt location, and verification profile. It does not create a worktree or run Codex.

## Execute

```bash
pnpm ralph:run -- --task task-view-boundary --execute
```

Execution mode:

1. checks the controller checkout is clean;
2. creates `../miniclaw-ralph/<task-id>`;
3. installs dependencies in the worktree unless `--skip-install` is used;
4. runs `codex exec --ephemeral`;
5. runs `pnpm ralph:verify`;
6. commits the worktree branch when verification passes.

Add `--push` to push the branch to `origin`.

## Next

```bash
pnpm ralph:next -- --execute
```

`ralph:next` is a one-iteration wrapper around `ralph:loop`. It:

1. picks the first open queue task;
2. reuses that task's worktree/branch when they already exist;
3. fast-forwards a reused worktree to the configured base ref when possible;
4. runs `pnpm ralph:run -- --task <id> --execute --reuse-worktree`.

Without `--execute`, it prints the selected task and command only.

## Loop

```bash
pnpm ralph:loop -- --limit 3 --execute --merge-main --push-main
```

Loop mode runs up to `--limit` Ralph iterations. With `--merge-main --push-main`, each iteration is serialized through `main`:

```text
select first open task
-> run fresh Codex in that task worktree
-> verify and commit task branch
-> fast-forward main to the task branch
-> push main
-> reload the queue and select again
```

`--push-main` requires `--merge-main`; it pushes the base branch, so the repo's pre-push hook still runs the full `quality:push` gate. Use `--push` only when you also want to publish each intermediate `ralph/<task>` branch.

If a task branch exists but has not been merged into the base branch, loop mode with `--merge-main` stops before starting another run. This prevents accidentally stacking new Codex work on an unreviewed branch.

## Verify

```bash
pnpm ralph:verify -- --task task-view-boundary
```

Verification commands come from the task's `verify_commands`; if absent, `verify_profile` is used.

## Raw Logs

Raw logs are intentionally ignored:

```text
.ralph/runs/<task-id>/<timestamp>/
  prompt.md
  codex.jsonl
  codex.stderr.log
  codex-final.md
  result.json
```

Do not move raw logs into tracked docs unless they have been reviewed for prompt, account, token, cookie, or provider payload leakage.
