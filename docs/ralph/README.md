# MiniClaw Ralph

MiniClaw Ralph is a thin controller for running plan-based Codex work with fresh context.

It is intentionally external to the bot runtime. The Discord bot does not call this controller, and Ralph does not modify live MiniClaw state.

## Core Rules

- One plan task per Codex run.
- One fresh `codex exec --ephemeral` context per task attempt.
- One isolated Git worktree/branch per task.
- The controller verifies, commits, and optionally pushes.
- Raw run logs are local and ignored under `.ralph/`.
- Durable learning is append-only in `docs/ralph/learnings.md`.

## Queue

`docs/ralph/queue.json` maps stable task ids to plan docs, verification profiles, and target branch names.

Queue `status` values are informational in the first version:

- `pending`
- `running`
- `blocked`
- `done`
- `skipped`

The first version does not auto-update queue status. This avoids noisy merge conflicts when multiple task branches are active.

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

