#!/usr/bin/env tsx
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

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
  verify_profile?: string;
  commit_title?: string;
}

interface Args {
  taskId?: string;
  planPath?: string;
  queuePath: string;
  execute: boolean;
  push: boolean;
  force: boolean;
  reuseWorktree: boolean;
  skipInstall: boolean;
  skipVerify: boolean;
  skipCommit: boolean;
  worktreeRoot?: string;
  baseRef?: string;
  branch?: string;
  commitTitle?: string;
  verifyProfile?: string;
  codexBin: string;
  sandbox: string;
  model?: string;
}

interface RunPlan {
  repoRoot: string;
  queuePath: string;
  task: RalphTask;
  baseRef: string;
  branch: string;
  worktreeRoot: string;
  worktreePath: string;
  runId: string;
  rawRunDir: string;
  verifyProfile: string;
  commitTitle: string;
  prompt: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    queuePath: "docs/ralph/queue.json",
    execute: false,
    push: false,
    force: false,
    reuseWorktree: false,
    skipInstall: false,
    skipVerify: false,
    skipCommit: false,
    codexBin: "codex",
    sandbox: "workspace-write",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--task") {
      args.taskId = requireValue(argv, ++i, arg);
    } else if (arg === "--plan") {
      args.planPath = requireValue(argv, ++i, arg);
    } else if (arg === "--queue") {
      args.queuePath = requireValue(argv, ++i, arg);
    } else if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--push") {
      args.push = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--reuse-worktree") {
      args.reuseWorktree = true;
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
    } else if (arg === "--branch") {
      args.branch = requireValue(argv, ++i, arg);
    } else if (arg === "--commit-title") {
      args.commitTitle = requireValue(argv, ++i, arg);
    } else if (arg === "--verify-profile") {
      args.verifyProfile = requireValue(argv, ++i, arg);
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

  if (!args.taskId && !args.planPath) {
    throw new Error("provide --task <id> or --plan <path>");
  }

  return args;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp(): void {
  process.stdout.write([
    "Usage: pnpm ralph:run -- --task <task-id> [--execute] [--push]",
    "",
    "Common options:",
    "  --plan <path>             Run a plan path not listed in queue.json",
    "  --execute                 Create worktree and run codex exec",
    "  --push                    Push the task branch after commit",
    "  --reuse-worktree          Reuse an existing worktree path",
    "  --skip-install            Do not run pnpm install in the worktree",
    "  --skip-verify             Do not run ralph:verify",
    "  --skip-commit             Leave verified changes uncommitted",
    "  --worktree-root <path>    Default: ../miniclaw-ralph",
    "  --sandbox <mode>          Default: workspace-write",
    "",
  ].join("\n"));
}

function gitText(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim();
}

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "inherit" });
}

function readQueue(path: string): RalphQueue {
  return JSON.parse(readFileSync(path, "utf8")) as RalphQueue;
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/[/.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function taskFromPlan(planPath: string): RalphTask {
  const id = sanitizeId(basename(planPath).replace(/^\d{4}-\d{2}-\d{2}-/, ""));
  return {
    id,
    plan: planPath,
    title: id,
    status: "pending",
  };
}

function resolveTask(queue: RalphQueue, args: Args): RalphTask {
  if (args.taskId) {
    const task = queue.tasks.find((item) => item.id === args.taskId);
    if (!task) throw new Error(`task not found in queue: ${args.taskId}`);
    return task;
  }
  if (!args.planPath) throw new Error("missing --plan");
  return taskFromPlan(args.planPath);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function resolveMaybeRelative(base: string, value: string): string {
  return isAbsolute(value) ? value : resolve(base, value);
}

function buildPlan(repoRoot: string, queuePath: string, queue: RalphQueue, task: RalphTask, args: Args): RunPlan {
  const baseRef = args.baseRef ?? queue.defaults?.base_ref ?? "main";
  const branchPrefix = queue.defaults?.branch_prefix ?? "ralph/";
  const branch = args.branch ?? task.branch ?? `${branchPrefix}${task.id}`;
  const worktreeRoot = resolveMaybeRelative(repoRoot, args.worktreeRoot ?? queue.defaults?.worktree_root ?? join("..", `${basename(repoRoot)}-ralph`));
  const worktreePath = join(worktreeRoot, task.id);
  const runId = `${timestamp()}-${task.id}`;
  const rawRunDir = join(repoRoot, ".ralph", "runs", task.id, runId);
  const verifyProfile = args.verifyProfile ?? task.verify_profile ?? queue.defaults?.verify_profile ?? "standard";
  const commitTitle = args.commitTitle ?? task.commit_title ?? `chore: run ralph task ${task.id}`;
  const prompt = buildPrompt(task, verifyProfile);

  return {
    repoRoot,
    queuePath,
    task,
    baseRef,
    branch,
    worktreeRoot,
    worktreePath,
    runId,
    rawRunDir,
    verifyProfile,
    commitTitle,
    prompt,
  };
}

function buildPrompt(task: RalphTask, verifyProfile: string): string {
  return [
    "You are running inside the MiniClaw Ralph controller.",
    "",
    `Task id: ${task.id}`,
    `Task title: ${task.title ?? task.id}`,
    `Plan: ${task.plan}`,
    `Verify profile: ${verifyProfile}`,
    "",
    "Rules:",
    "1. Read the plan, relevant source files, relevant tests, and git status first.",
    "2. Implement only the first independently shippable slice from the plan.",
    "3. Do not perform unrelated refactors.",
    "4. Do not commit, push, create branches, or modify the controller queue status.",
    "5. Update the plan's Execution Notes with actual changes and verification evidence.",
    "6. Preserve user work and do not revert unrelated changes.",
    "7. Leave the final diff in the worktree; Ralph will verify and commit it.",
    "",
    "Start now.",
    "",
  ].join("\n");
}

function ensureClean(repoRoot: string, force: boolean): void {
  const status = gitText(["status", "--porcelain"], repoRoot);
  if (status && !force) {
    throw new Error(`controller checkout is dirty; commit/stash first or pass --force\n${status}`);
  }
}

function ensurePlanExists(repoRoot: string, planPath: string): void {
  const absolute = resolveMaybeRelative(repoRoot, planPath);
  if (!existsSync(absolute)) throw new Error(`plan not found: ${planPath}`);
}

function branchExists(repoRoot: string, branch: string): boolean {
  try {
    gitText(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoRoot);
    return true;
  } catch {
    return false;
  }
}

function ensureWorktreeClean(worktreePath: string): void {
  const status = gitText(["status", "--porcelain"], worktreePath);
  if (status) {
    throw new Error(`reused worktree is dirty; clean it before continuing\n${status}`);
  }
}

function syncReusedWorktree(plan: RunPlan): void {
  const branch = gitText(["rev-parse", "--abbrev-ref", "HEAD"], plan.worktreePath);
  if (branch !== plan.branch) {
    throw new Error(`reused worktree is on ${branch}, expected ${plan.branch}`);
  }

  ensureWorktreeClean(plan.worktreePath);
  git(["merge", "--ff-only", plan.baseRef], plan.worktreePath);
}

function createOrReuseWorktree(plan: RunPlan, args: Args): void {
  mkdirSync(plan.worktreeRoot, { recursive: true });

  if (existsSync(plan.worktreePath)) {
    if (!args.reuseWorktree) {
      throw new Error(`worktree path already exists: ${plan.worktreePath}; pass --reuse-worktree to reuse it`);
    }
    syncReusedWorktree(plan);
    return;
  }

  if (branchExists(plan.repoRoot, plan.branch)) {
    if (!args.reuseWorktree) {
      throw new Error(`branch already exists: ${plan.branch}; pass --reuse-worktree or choose --branch`);
    }
    git(["worktree", "add", plan.worktreePath, plan.branch], plan.repoRoot);
    syncReusedWorktree(plan);
    return;
  }

  git(["worktree", "add", "-b", plan.branch, plan.worktreePath, plan.baseRef], plan.repoRoot);
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

function runCodex(plan: RunPlan, args: Args): void {
  const codexArgs = [
    "exec",
    "--ephemeral",
    "--sandbox",
    args.sandbox,
    "--cd",
    plan.worktreePath,
    "--output-last-message",
    join(plan.rawRunDir, "codex-final.md"),
    "--json",
  ];
  if (args.model) codexArgs.push("--model", args.model);
  codexArgs.push("-");

  const result = spawnSync(args.codexBin, codexArgs, {
    cwd: plan.worktreePath,
    input: plan.prompt,
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
    env: process.env,
  });

  writeFileSync(join(plan.rawRunDir, "codex.jsonl"), result.stdout ?? "");
  writeFileSync(join(plan.rawRunDir, "codex.stderr.log"), result.stderr ?? "");

  if (result.status !== 0) {
    const suffix = result.signal ? ` signal=${result.signal}` : "";
    throw new Error(`codex exec failed (${result.status ?? "unknown"}${suffix}); logs: ${plan.rawRunDir}`);
  }
}

function changedFiles(cwd: string): string[] {
  return gitText(["status", "--porcelain"], cwd)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function relativeQueuePath(repoRoot: string, queuePath: string): string {
  const absolute = resolveMaybeRelative(repoRoot, queuePath);
  const rel = relative(repoRoot, absolute);
  return rel.startsWith("..") ? absolute : rel;
}

function runVerify(plan: RunPlan): void {
  runCommand("pnpm", [
    "ralph:verify",
    "--",
    "--task",
    plan.task.id,
    "--queue",
    relativeQueuePath(plan.repoRoot, plan.queuePath),
    "--profile",
    plan.verifyProfile,
  ], plan.worktreePath);
}

function commitWorktree(plan: RunPlan): string {
  git(["add", "-A"], plan.worktreePath);
  git([
    "commit",
    "-m",
    plan.commitTitle,
    "-m",
    [
      `Ralph task: ${plan.task.id}`,
      `Plan: ${plan.task.plan}`,
      `Run: ${plan.runId}`,
      "",
      "Co-authored-by: Codex <codex@openai.com>",
    ].join("\n"),
  ], plan.worktreePath);
  return gitText(["rev-parse", "--short", "HEAD"], plan.worktreePath);
}

function writeRunMetadata(plan: RunPlan, args: Args, status: string, extra: Record<string, unknown> = {}): void {
  mkdirSync(plan.rawRunDir, { recursive: true });
  writeFileSync(join(plan.rawRunDir, "prompt.md"), plan.prompt);
  writeFileSync(join(plan.rawRunDir, "result.json"), `${JSON.stringify({
    status,
    task_id: plan.task.id,
    plan: plan.task.plan,
    branch: plan.branch,
    worktree_path: plan.worktreePath,
    run_id: plan.runId,
    execute: args.execute,
    push: args.push,
    skip_install: args.skipInstall,
    skip_verify: args.skipVerify,
    skip_commit: args.skipCommit,
    created_at: new Date().toISOString(),
    ...extra,
  }, null, 2)}\n`);
}

function printDryRun(plan: RunPlan, args: Args): void {
  process.stdout.write([
    "MiniClaw Ralph dry-run",
    `- task: ${plan.task.id} (${plan.task.title ?? plan.task.plan})`,
    `- plan: ${plan.task.plan}`,
    `- status: ${plan.task.status ?? "unknown"}`,
    `- base ref: ${plan.baseRef}`,
    `- branch: ${plan.branch}`,
    `- worktree: ${plan.worktreePath}`,
    `- verify profile: ${plan.verifyProfile}`,
    `- commit title: ${plan.commitTitle}`,
    `- execute: ${args.execute}`,
    `- push: ${args.push}`,
    "",
    "Prompt preview:",
    plan.prompt,
  ].join("\n"));
}

try {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = gitText(["rev-parse", "--show-toplevel"]);
  process.chdir(repoRoot);

  const queuePath = resolveMaybeRelative(repoRoot, args.queuePath);
  const queue = readQueue(queuePath);
  const task = resolveTask(queue, args);
  ensurePlanExists(repoRoot, task.plan);

  const plan = buildPlan(repoRoot, args.queuePath, queue, task, args);

  if (!args.execute) {
    printDryRun(plan, args);
    process.exit(0);
  }

  ensureClean(repoRoot, args.force);
  mkdirSync(dirname(plan.rawRunDir), { recursive: true });
  mkdirSync(plan.rawRunDir, { recursive: true });
  writeRunMetadata(plan, args, "started");

  createOrReuseWorktree(plan, args);

  if (!args.skipInstall) {
    runCommand("pnpm", ["install", "--frozen-lockfile", "--offline"], plan.worktreePath);
  }

  runCodex(plan, args);

  const diff = changedFiles(plan.worktreePath);
  if (diff.length === 0) {
    writeRunMetadata(plan, args, "failed", { reason: "codex produced no worktree diff" });
    throw new Error("codex produced no worktree diff");
  }

  if (!args.skipVerify) runVerify(plan);

  let commitSha: string | undefined;
  if (!args.skipCommit) {
    commitSha = commitWorktree(plan);
  }

  if (args.push) {
    runCommand("git", ["push", "-u", "origin", plan.branch], plan.worktreePath);
  }

  writeRunMetadata(plan, args, "completed", {
    changed_files: diff,
    commit_sha: commitSha,
  });

  process.stdout.write([
    "MiniClaw Ralph completed.",
    `- task: ${plan.task.id}`,
    `- branch: ${plan.branch}`,
    `- commit: ${commitSha ?? "(not committed)"}`,
    `- logs: ${plan.rawRunDir}`,
    "",
  ].join("\n"));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ralph-run error: ${message}\n`);
  process.exit(1);
}
