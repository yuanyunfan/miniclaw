# MiniClaw Ralph

MiniClaw Ralph is a thin controller for running plan-based Codex work with fresh context.

It is intentionally external to the bot runtime. The Discord bot does not call this controller, and Ralph does not modify live MiniClaw state.

## Core Rules

- One plan task per Codex run.
- One fresh `codex exec --ephemeral` context per task attempt.
- One isolated Git worktree/branch per task.
- One coherent reviewable phase per task attempt by default; avoid committing micro-slices that only add a single helper, type, or test unless the plan explicitly defines that as the phase.
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

`ralph:next`, `ralph:loop`, and `ralph:task` select tasks whose queue status is `pending` and whose plan `Status:` is not closed. Closed plan statuses are `blocked`, `closed`, `done`, `shipped`, `skipped`, and `superseded`.

A queue entry can stay `pending` across multiple Ralph iterations. This is intentional: each Codex run is instructed to land the next coherent reviewable phase, not the smallest possible micro-slice. Codex may mark the plan `Status:` as `done` only when the full plan is genuinely complete and verified. When `ralph:run` sees a closed plan status in the task worktree, it syncs the matching queue entry before verification and commit:

- plan `done`, `closed`, or `shipped` -> queue `done`
- plan `blocked` -> queue `blocked`
- plan `skipped` or `superseded` -> queue `skipped`

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
4. runs `codex exec --ephemeral` and streams redacted progress to the terminal while teeing raw logs under `.ralph/`;
5. syncs the task queue status when the plan `Status:` is closed;
6. runs `pnpm ralph:verify`;
7. commits the worktree branch when verification passes.

Add `--push` to push the branch to `origin`.

## Commit Metadata

Queue `commit_title` values are fallback titles only. Each Codex run must end its final response with:

```text
Ralph commit title: <type: short specific English title for this phase, max 72 chars>
Ralph commit description:
- <what changed in this phase>
- <why this phase is reviewable on its own>
- <verification evidence you ran>
```

`ralph:run` reads that block from `codex-final.md` and uses it as the Git commit subject and body. If the block is missing, Ralph falls back to the queue `commit_title` and a generated body that lists the task, plan, run id, and changed files. Commit bodies always include Ralph metadata plus the Codex co-author trailer.

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

## Task Until Done

```bash
pnpm ralph:task -- --task task-view-boundary --execute --merge-main --push-main
```

`ralph:task` repeatedly runs one specified task until that task closes through queue status or plan `Status:`. It is a wrapper around `ralph:loop --until-task-done`.

Execution mode requires `--merge-main` because the controller decides completion from the base checkout after each verified task branch is merged. Without a merge, a plan `Status: done` change would remain only on the task branch and the controller could not safely observe completion.

The default safety limit is 25 iterations. Use `--limit <n>` to make that limit smaller or larger. Reaching the limit while the task is still open fails the command so unattended runs do not silently stop halfway.

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

The terminal stream is intentionally summarized: command starts/completions, file-change events, agent message first lines, phase boundaries, and periodic heartbeat lines are printed. Full Codex JSONL and stderr remain in `.ralph/runs/...` for local debugging.
