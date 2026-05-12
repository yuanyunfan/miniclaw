#!/usr/bin/env tsx
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

interface RalphQueue {
  version: number;
  defaults?: {
    base_ref?: string;
    branch_prefix?: string;
    worktree_root?: string;
    verify_profile?: string;
  };
  tasks: RalphTask[];
}

interface RalphTask {
  id: string;
  title?: string;
  priority?: string;
  status?: string;
  plan: string;
  branch?: string;
}

interface Args {
  queuePath: string;
  limit: number;
  limitWasSet: boolean;
  taskId?: string;
  execute: boolean;
  untilTaskDone: boolean;
  mergeMain: boolean;
  pushMain: boolean;
  pushBranch: boolean;
  force: boolean;
  skipInstall: boolean;
  skipVerify: boolean;
  skipCommit: boolean;
  worktreeRoot?: string;
  baseRef?: string;
  codexBin?: string;
  sandbox?: string;
  model?: string;
}

const CLOSED_QUEUE_STATUSES = new Set(["blocked", "done", "skipped"]);
const CLOSED_PLAN_STATUSES = new Set(["blocked", "closed", "done", "shipped", "skipped", "superseded"]);

function parseArgs(argv: string[]): Args {
  const args: Args = {
    queuePath: "docs/ralph/queue.json",
    limit: 1,
    limitWasSet: false,
    execute: false,
    untilTaskDone: false,
    mergeMain: false,
    pushMain: false,
    pushBranch: false,
    force: false,
    skipInstall: false,
    skipVerify: false,
    skipCommit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--queue") {
      args.queuePath = requireValue(argv, ++i, arg);
    } else if (arg === "--task") {
      args.taskId = requireValue(argv, ++i, arg);
    } else if (arg === "--limit") {
      args.limit = parsePositiveInt(requireValue(argv, ++i, arg), arg);
      args.limitWasSet = true;
    } else if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--until-task-done" || arg === "--until-done") {
      args.untilTaskDone = true;
    } else if (arg === "--merge-main") {
      args.mergeMain = true;
    } else if (arg === "--push-main") {
      args.pushMain = true;
    } else if (arg === "--push") {
      args.pushBranch = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--skip-install") {
      args.skipInstall = true;
    } else if (arg === "--skip-verify") {
      args.skipVerify = true;
    } else if (arg === "--skip-commit") {
      args.skipCommit = true;
    } else if (arg === "--worktree-root") {
      args.worktreeRoot = requireValue(argv, ++i, arg);
    } else if (arg === "--base-ref") {
      args.baseRef = requireValue(argv, ++i, arg);
    } else if (arg === "--codex-bin") {
      args.codexBin = requireValue(argv, ++i, arg);
    } else if (arg === "--sandbox") {
      args.sandbox = requireValue(argv, ++i, arg);
    } else if (arg === "--model") {
      args.model = requireValue(argv, ++i, arg);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (args.pushMain && !args.mergeMain) {
    throw new Error("--push-main requires --merge-main");
  }
  if (args.mergeMain && args.skipCommit) {
    throw new Error("--merge-main cannot be used with --skip-commit");
  }
  if (args.untilTaskDone && !args.taskId) {
    throw new Error("--until-task-done requires --task <id>");
  }
  if (args.untilTaskDone && args.execute && !args.mergeMain) {
    throw new Error("--until-task-done requires --merge-main when executing so the base checkout can observe plan completion");
  }
  if (args.untilTaskDone && !args.limitWasSet) {
    args.limit = 25;
  }

  return args;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

function printHelp(): void {
  process.stdout.write([
    "Usage: pnpm ralph:loop -- --limit <n> [--execute] [--merge-main] [--push-main]",
    "",
    "Common options:",
    "  --task <id>               Restrict selection to one queue task",
    "  --limit <n>              Maximum Ralph iterations to run; default: 1",
    "  --execute                Run Codex. Without this flag, print the first selected task only",
    "  --until-task-done        Keep running --task until its queue or plan status is closed; default safety limit: 25",
    "  --merge-main             Fast-forward the base branch to each verified task branch",
    "  --push-main              Push the base branch after each merge; requires --merge-main",
    "  --push                   Push each Ralph task branch after its task commit",
    "  --worktree-root <path>   Default comes from docs/ralph/queue.json",
    "  --base-ref <branch>      Default comes from docs/ralph/queue.json",
    "  --sandbox <mode>         Forwarded to ralph:run",
    "",
    "Selection rule:",
    "  The loop picks the requested --task, or the first queue task whose queue status and plan Status are still open.",
    "  If that plan remains open after a merge, the next iteration continues the same plan.",
    "",
  ].join("\n"));
}

function gitText(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim();
}

function gitOk(args: string[], cwd?: string): boolean {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "inherit" });
}

function runCommand(command: string, commandArgs: string[], cwd: string): void {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    const suffix = result.signal ? ` signal=${result.signal}` : "";
    throw new Error(`${command} ${commandArgs.join(" ")} failed (${result.status ?? "unknown"}${suffix})`);
  }
}

function readQueue(path: string): RalphQueue {
  return JSON.parse(readFileSync(path, "utf8")) as RalphQueue;
}

function resolveMaybeRelative(base: string, value: string): string {
  return isAbsolute(value) ? value : resolve(base, value);
}

function relativeQueuePath(repoRoot: string, queuePath: string): string {
  const absolute = resolveMaybeRelative(repoRoot, queuePath);
  const rel = relative(repoRoot, absolute);
  return rel.startsWith("..") ? absolute : rel;
}

function baseRef(queue: RalphQueue, args: Args): string {
  return args.baseRef ?? queue.defaults?.base_ref ?? "main";
}

function taskBranch(queue: RalphQueue, task: RalphTask): string {
  const branchPrefix = queue.defaults?.branch_prefix ?? "ralph/";
  return task.branch ?? `${branchPrefix}${task.id}`;
}

function taskWorktreePath(repoRoot: string, queue: RalphQueue, task: RalphTask, args: Args): string {
  const root = resolveMaybeRelative(repoRoot, args.worktreeRoot ?? queue.defaults?.worktree_root ?? join("..", `${basename(repoRoot)}-ralph`));
  return join(root, task.id);
}

function planStatus(repoRoot: string, task: RalphTask): string | undefined {
  const path = resolveMaybeRelative(repoRoot, task.plan);
  if (!existsSync(path)) throw new Error(`plan not found: ${task.plan}`);
  const match = readFileSync(path, "utf8").match(/^Status:\s*(.+)$/m);
  return match?.[1]?.trim().toLowerCase();
}

function isOpenTask(repoRoot: string, task: RalphTask): boolean {
  const queueStatus = (task.status ?? "pending").trim().toLowerCase();
  if (CLOSED_QUEUE_STATUSES.has(queueStatus)) return false;
  if (queueStatus !== "pending") return false;

  const status = planStatus(repoRoot, task);
  return !status || !CLOSED_PLAN_STATUSES.has(status);
}

function findTask(queue: RalphQueue, taskId: string): RalphTask {
  const task = queue.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`task not found in queue: ${taskId}`);
  return task;
}

function ensureTaskBranchReady(repoRoot: string, queue: RalphQueue, task: RalphTask, args: Args): void {
  const ref = baseRef(queue, args);
  const branch = taskBranch(queue, task);
  if (args.mergeMain && branchExists(repoRoot, branch) && !branchMergedInto(repoRoot, branch, ref)) {
    throw new Error(`task branch ${branch} exists and is not merged into ${ref}; review, merge, or delete it before continuing`);
  }
}

function branchExists(repoRoot: string, branch: string): boolean {
  return gitOk(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoRoot);
}

function branchMergedInto(repoRoot: string, branch: string, target: string): boolean {
  return gitOk(["merge-base", "--is-ancestor", branch, target], repoRoot);
}

function ensureClean(repoRoot: string, force: boolean): void {
  const status = gitText(["status", "--porcelain"], repoRoot);
  if (status && !force) {
    throw new Error(`controller checkout is dirty; commit/stash first or pass --force\n${status}`);
  }
}

function ensureOnBaseBranch(repoRoot: string, ref: string): void {
  const current = gitText(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
  if (current !== ref) {
    throw new Error(`--merge-main requires controller checkout on ${ref}; current branch is ${current}`);
  }
}

function syncBaseFromOrigin(repoRoot: string, ref: string): void {
  git(["fetch", "origin", ref], repoRoot);
  git(["merge", "--ff-only", `origin/${ref}`], repoRoot);
}

function selectNextTask(repoRoot: string, queue: RalphQueue, args: Args): RalphTask | undefined {
  if (args.taskId) {
    const task = findTask(queue, args.taskId);
    if (!isOpenTask(repoRoot, task)) return undefined;
    ensureTaskBranchReady(repoRoot, queue, task, args);
    return task;
  }

  for (const task of queue.tasks) {
    if (!isOpenTask(repoRoot, task)) continue;
    ensureTaskBranchReady(repoRoot, queue, task, args);
    return task;
  }
  return undefined;
}

function buildRunArgs(repoRoot: string, queuePath: string, queue: RalphQueue, task: RalphTask, args: Args): string[] {
  const commandArgs = [
    "ralph:run",
    "--",
    "--task",
    task.id,
    "--queue",
    relativeQueuePath(repoRoot, queuePath),
    "--base-ref",
    baseRef(queue, args),
    "--reuse-worktree",
  ];

  if (args.execute) commandArgs.push("--execute");
  if (args.pushBranch) commandArgs.push("--push");
  if (args.force) commandArgs.push("--force");
  if (args.skipInstall) commandArgs.push("--skip-install");
  if (args.skipVerify) commandArgs.push("--skip-verify");
  if (args.skipCommit) commandArgs.push("--skip-commit");
  if (args.worktreeRoot) commandArgs.push("--worktree-root", args.worktreeRoot);
  if (args.codexBin) commandArgs.push("--codex-bin", args.codexBin);
  if (args.sandbox) commandArgs.push("--sandbox", args.sandbox);
  if (args.model) commandArgs.push("--model", args.model);

  return commandArgs;
}

function printDryRun(repoRoot: string, queuePath: string, queue: RalphQueue, task: RalphTask | undefined, args: Args): void {
  const ref = baseRef(queue, args);
  const lines = [
    "MiniClaw Ralph loop dry-run",
    `- limit: ${args.limit}`,
    `- task filter: ${args.taskId ?? "(first open task)"}`,
    `- until task done: ${args.untilTaskDone}`,
    `- base ref: ${ref}`,
    `- merge main: ${args.mergeMain}`,
    `- push main: ${args.pushMain}`,
  ];

  if (!task) {
    lines.push("- selected task: (none)");
  } else {
    lines.push(
      `- selected task: ${task.id} (${task.title ?? task.plan})`,
      `- plan: ${task.plan}`,
      `- queue status: ${task.status ?? "pending"}`,
      `- plan status: ${planStatus(repoRoot, task) ?? "unknown"}`,
      `- branch: ${taskBranch(queue, task)}`,
      `- worktree: ${taskWorktreePath(repoRoot, queue, task, args)}`,
      `- command: pnpm ${buildRunArgs(repoRoot, queuePath, queue, task, args).join(" ")}`,
      "",
      "Later iterations are selected after each executed merge because the plan or queue status may change.",
    );
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

function runIteration(repoRoot: string, queuePath: string, queue: RalphQueue, task: RalphTask, args: Args, index: number): void {
  const ref = baseRef(queue, args);
  const branch = taskBranch(queue, task);

  process.stdout.write([
    `MiniClaw Ralph loop iteration ${index}/${args.limit}`,
    `- task: ${task.id} (${task.title ?? task.plan})`,
    `- branch: ${branch}`,
    `- base ref: ${ref}`,
    "",
  ].join("\n"));

  runCommand("pnpm", buildRunArgs(repoRoot, queuePath, queue, task, args), repoRoot);

  if (args.mergeMain) {
    ensureClean(repoRoot, args.force);
    git(["merge", "--ff-only", branch], repoRoot);
  }

  if (args.pushMain) {
    runCommand("git", ["push", "origin", ref], repoRoot);
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = gitText(["rev-parse", "--show-toplevel"]);
  process.chdir(repoRoot);

  const queuePath = resolveMaybeRelative(repoRoot, args.queuePath);
  let queue = readQueue(queuePath);
  const ref = baseRef(queue, args);

  if (!args.execute) {
    printDryRun(repoRoot, queuePath, queue, selectNextTask(repoRoot, queue, args), args);
    process.exit(0);
  }

  if (args.mergeMain || args.pushMain) {
    ensureOnBaseBranch(repoRoot, ref);
    ensureClean(repoRoot, args.force);
  }
  if (args.pushMain) {
    syncBaseFromOrigin(repoRoot, ref);
  }

  let ran = 0;
  for (let index = 1; index <= args.limit; index += 1) {
    queue = readQueue(queuePath);
    const task = selectNextTask(repoRoot, queue, args);
    if (!task) {
      process.stdout.write("MiniClaw Ralph loop: no open task found.\n");
      break;
    }

    runIteration(repoRoot, queuePath, queue, task, args, index);
    ran += 1;
  }

  if (args.untilTaskDone && args.taskId) {
    queue = readQueue(queuePath);
    if (isOpenTask(repoRoot, findTask(queue, args.taskId))) {
      throw new Error(`task ${args.taskId} is still open after ${ran}/${args.limit} iteration(s); increase --limit or inspect the plan`);
    }
  }

  process.stdout.write(`MiniClaw Ralph loop completed: ${ran} iteration(s).\n`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ralph-loop error: ${message}\n`);
  process.exit(1);
}
