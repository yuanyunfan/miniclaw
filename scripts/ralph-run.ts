#!/usr/bin/env tsx
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

interface CommitMetadata {
  title: string;
  description: string[];
  source: "codex-final" | "fallback";
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

function logRalph(message: string): void {
  process.stdout.write(`[ralph] ${message}\n`);
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

function repoRelativePath(repoRoot: string, path: string): string | undefined {
  const absolute = resolveMaybeRelative(repoRoot, path);
  const rel = relative(repoRoot, absolute);
  return rel.startsWith("..") || isAbsolute(rel) ? undefined : rel;
}

function worktreeFilePath(plan: RunPlan, path: string): string | undefined {
  const rel = repoRelativePath(plan.repoRoot, path);
  return rel ? join(plan.worktreePath, rel) : undefined;
}

function planStatus(plan: RunPlan): string | undefined {
  const path = worktreeFilePath(plan, plan.task.plan);
  if (!path || !existsSync(path)) return undefined;
  const match = readFileSync(path, "utf8").match(/^Status:\s*(.+)$/m);
  return match?.[1]?.trim().toLowerCase();
}

function queueStatusForPlanStatus(status: string | undefined): string | undefined {
  if (status === "blocked") return "blocked";
  if (status === "skipped" || status === "superseded") return "skipped";
  if (status === "closed" || status === "done" || status === "shipped") return "done";
  return undefined;
}

function syncQueueStatusFromPlan(plan: RunPlan): Record<string, unknown> | undefined {
  const nextStatus = queueStatusForPlanStatus(planStatus(plan));
  if (!nextStatus) return undefined;

  const queuePath = worktreeFilePath(plan, plan.queuePath);
  if (!queuePath || !existsSync(queuePath)) return undefined;

  const queue = readQueue(queuePath);
  const task = queue.tasks.find((item) => item.id === plan.task.id);
  if (!task) return undefined;

  const previousStatus = task.status ?? "pending";
  if (previousStatus === nextStatus) {
    return { queue_status: nextStatus, queue_status_synced: false };
  }

  task.status = nextStatus;
  writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`);
  return {
    queue_status: nextStatus,
    queue_status_previous: previousStatus,
    queue_status_synced: true,
  };
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
    "2. Implement the largest coherent reviewable phase from the plan, not the smallest possible safe micro-slice.",
    "3. If the plan has a `Ralph Iteration Targets` section, pick the first target that is not already complete and finish that whole target.",
    "4. A phase should normally include behavior wiring plus focused tests; do not stop after only adding types, helpers, docs, or tests unless the selected target explicitly says that is the whole phase.",
    "5. Do not perform unrelated refactors.",
    "6. Do not commit, push, create branches, or modify the controller queue status.",
    "7. Update the plan's Execution Notes with actual changes and verification evidence.",
    "8. If the full plan is genuinely complete and verified, update the plan `Status:` to `done`; Ralph will sync the queue status from that closed plan status.",
    "9. Preserve user work and do not revert unrelated changes.",
    "10. Leave the final diff in the worktree; Ralph will verify and commit it.",
    "11. End your final response with this exact commit metadata block, and put nothing after it:",
    "    Ralph commit title: <type: short specific English title for this phase, max 72 chars>",
    "    Ralph commit description:",
    "    - <what changed in this phase>",
    "    - <why this phase is reviewable on its own>",
    "    - <verification evidence you ran>",
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
  logRalph(`run: ${command} ${commandArgs.join(" ")}`);
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

function redactForConsole(value: string): string {
  return value
    .replace(/(Authorization:\s*Bearer\s+)[^\s"']+/gi, "$1***")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***")
    .replace(/([?&](?:api_?key|token|access_token|refresh_token|exaApiKey)=)[^&\s"']+/gi, "$1***")
    .replace(/((?:api_?key|token|access_token|refresh_token|exaApiKey)\s*[:=]\s*)[^\s"']+/gi, "$1***");
}

function truncateForConsole(value: string, max = 180): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= max) return singleLine;
  return `${singleLine.slice(0, max - 1)}…`;
}

function relativeToWorktree(plan: RunPlan, path: string): string {
  const rel = relative(plan.worktreePath, path);
  return rel.startsWith("..") || isAbsolute(rel) ? basename(path) : rel;
}

function describeFileChanges(plan: RunPlan, changes: unknown): string {
  if (!Array.isArray(changes)) return "file changes";
  const paths = changes
    .map((change) => {
      if (!change || typeof change !== "object") return undefined;
      const path = "path" in change && typeof change.path === "string" ? change.path : undefined;
      const kind = "kind" in change && typeof change.kind === "string" ? change.kind : undefined;
      if (!path) return undefined;
      return `${kind ?? "change"} ${relativeToWorktree(plan, path)}`;
    })
    .filter((value): value is string => Boolean(value));
  if (paths.length === 0) return "file changes";
  const preview = paths.slice(0, 4).join(", ");
  const suffix = paths.length > 4 ? `, +${paths.length - 4} more` : "";
  return `${preview}${suffix}`;
}

function handleCodexJsonLine(plan: RunPlan, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    logRalph(`codex output: ${truncateForConsole(redactForConsole(trimmed))}`);
    return;
  }

  if (!event || typeof event !== "object") return;
  const eventType = "type" in event && typeof event.type === "string" ? event.type : "event";
  const item = "item" in event && event.item && typeof event.item === "object" ? event.item : undefined;
  const itemType = item && "type" in item && typeof item.type === "string" ? item.type : undefined;

  if (eventType === "thread.started") {
    logRalph("codex thread started");
    return;
  }
  if (eventType === "turn.started") {
    logRalph("codex turn started");
    return;
  }
  if (eventType === "turn.completed") {
    logRalph("codex turn completed");
    return;
  }

  if (itemType === "command_execution") {
    const command = item && "command" in item && typeof item.command === "string" ? item.command : "(command)";
    const commandText = truncateForConsole(redactForConsole(command), 220);
    if (eventType === "item.started") {
      logRalph(`codex command started: ${commandText}`);
      return;
    }
    if (eventType === "item.completed") {
      const exitCode = item && "exit_code" in item ? item.exit_code : undefined;
      const failed = typeof exitCode === "number" && exitCode !== 0;
      logRalph(`codex command ${failed ? "failed" : "completed"}: exit=${exitCode ?? "unknown"} ${commandText}`);
      return;
    }
  }

  if (itemType === "file_change") {
    if (eventType === "item.started") {
      const changes = item && "changes" in item ? item.changes : undefined;
      logRalph(`codex file change started: ${describeFileChanges(plan, changes)}`);
      return;
    }
    if (eventType === "item.completed") {
      logRalph("codex file change completed");
      return;
    }
  }

  if (itemType === "agent_message" && eventType === "item.completed") {
    const text = item && "text" in item && typeof item.text === "string" ? item.text : "";
    const firstLine = text.split(/\r?\n/).find((line) => line.trim());
    if (firstLine) logRalph(`codex message: ${truncateForConsole(redactForConsole(firstLine), 220)}`);
    return;
  }

  if (itemType === "error" && eventType === "item.completed") {
    const message = item && "message" in item && typeof item.message === "string" ? item.message : "error";
    logRalph(`codex error event: ${truncateForConsole(redactForConsole(message), 220)}`);
  }
}

async function endStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    stream.end(resolve);
  });
}

async function runCodex(plan: RunPlan, args: Args): Promise<void> {
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

  const stdoutPath = join(plan.rawRunDir, "codex.jsonl");
  const stderrPath = join(plan.rawRunDir, "codex.stderr.log");
  const stdoutFile = createWriteStream(stdoutPath);
  const stderrFile = createWriteStream(stderrPath);
  const startedAt = Date.now();
  let stdoutBuffer = "";
  let stderrBytes = 0;
  let lastStderrNoticeAt = 0;

  logRalph(`codex start: ${args.codexBin} ${codexArgs.slice(0, -1).join(" ")} -`);
  logRalph(`codex logs: ${plan.rawRunDir}`);

  const child = spawn(args.codexBin, codexArgs, {
    cwd: plan.worktreePath,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  const heartbeat = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    logRalph(`codex still running: ${elapsedSeconds}s elapsed`);
  }, 30_000);

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutFile.write(chunk);
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) handleCodexJsonLine(plan, line);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrFile.write(chunk);
    stderrBytes += chunk.length;
    const now = Date.now();
    if (now - lastStderrNoticeAt > 15_000) {
      lastStderrNoticeAt = now;
      logRalph(`codex stderr activity: ${stderrBytes} bytes captured in ${stderrPath}`);
    }
  });

  child.stdin.end(plan.prompt);

  const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status, signal) => resolve({ status, signal }));
  });

  clearInterval(heartbeat);
  if (stdoutBuffer.trim()) handleCodexJsonLine(plan, stdoutBuffer);
  await Promise.all([endStream(stdoutFile), endStream(stderrFile)]);

  if (result.status !== 0) {
    const suffix = result.signal ? ` signal=${result.signal}` : "";
    throw new Error(`codex exec failed (${result.status ?? "unknown"}${suffix}); logs: ${plan.rawRunDir}`);
  }

  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  logRalph(`codex completed: ${elapsedSeconds}s elapsed`);
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

function readCodexFinal(plan: RunPlan): string | undefined {
  const path = join(plan.rawRunDir, "codex-final.md");
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8");
}

function normalizeCommitTitle(value: string | undefined): string | undefined {
  const title = value?.replace(/^[-*]\s*/, "").replace(/^`|`$/g, "").trim();
  if (!title) return undefined;
  return truncateForConsole(title.replace(/\s+/g, " "), 72);
}

function parseCommitDescription(text: string, startIndex: number, firstLine: string): string[] {
  const afterMarker = text.slice(startIndex);
  const lines = [firstLine, ...afterMarker.split(/\r?\n/)]
    .map((line) => line.trimEnd())
    .filter((line) => !/^Ralph commit title:/i.test(line))
    .filter((line) => !/^Ralph commit description:/i.test(line));
  const useful: string[] = [];
  for (const line of lines) {
    if (useful.length >= 8) break;
    if (!line.trim() && useful.length === 0) continue;
    if (/^<oai-mem-citation>/i.test(line)) break;
    useful.push(truncateForConsole(line, 140));
  }
  while (useful.length > 0 && !useful[useful.length - 1]?.trim()) useful.pop();
  return useful;
}

function commitMetadataFromCodexFinal(plan: RunPlan): CommitMetadata | undefined {
  const text = readCodexFinal(plan);
  if (!text) return undefined;

  const titleMatch = /^Ralph commit title:\s*(.+)$/im.exec(text);
  const descriptionMatch = /^Ralph commit description:\s*(.*)$/im.exec(text);
  const title = normalizeCommitTitle(titleMatch?.[1]);
  if (!title) return undefined;

  const description = descriptionMatch
    ? parseCommitDescription(text, (descriptionMatch.index ?? 0) + descriptionMatch[0].length, descriptionMatch[1] ?? "")
    : [];

  return {
    title,
    description: description.length > 0 ? description : [`Ralph completed a verified phase for ${plan.task.title ?? plan.task.id}.`],
    source: "codex-final",
  };
}

function fallbackCommitMetadata(plan: RunPlan, diff: string[]): CommitMetadata {
  const changed = diff.slice(0, 10).map((file) => `- ${file}`);
  return {
    title: plan.commitTitle,
    description: [
      `Ralph completed a verified phase for ${plan.task.title ?? plan.task.id}.`,
      "",
      "Changed files:",
      ...changed,
    ],
    source: "fallback",
  };
}

function commitMetadata(plan: RunPlan, diff: string[]): CommitMetadata {
  return commitMetadataFromCodexFinal(plan) ?? fallbackCommitMetadata(plan, diff);
}

function commitWorktree(plan: RunPlan, diff: string[]): { sha: string; metadata: CommitMetadata } {
  const metadata = commitMetadata(plan, diff);
  git(["add", "-A"], plan.worktreePath);
  git([
    "commit",
    "-m",
    metadata.title,
    "-m",
    [
      ...metadata.description,
      "",
      `Ralph task: ${plan.task.id}`,
      `Plan: ${plan.task.plan}`,
      `Run: ${plan.runId}`,
      `Commit metadata source: ${metadata.source}`,
      "",
      "Co-authored-by: Codex <codex@openai.com>",
    ].join("\n"),
  ], plan.worktreePath);
  return {
    sha: gitText(["rev-parse", "--short", "HEAD"], plan.worktreePath),
    metadata,
  };
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

async function main(): Promise<void> {
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
    return;
  }

  logRalph(`task start: ${plan.task.id} (${plan.task.title ?? plan.task.plan})`);
  logRalph(`branch: ${plan.branch}`);
  logRalph(`worktree: ${plan.worktreePath}`);
  logRalph(`run: ${plan.runId}`);

  ensureClean(repoRoot, args.force);
  mkdirSync(dirname(plan.rawRunDir), { recursive: true });
  mkdirSync(plan.rawRunDir, { recursive: true });
  writeRunMetadata(plan, args, "started");

  createOrReuseWorktree(plan, args);

  if (!args.skipInstall) {
    runCommand("pnpm", ["install", "--frozen-lockfile", "--offline"], plan.worktreePath);
  }

  await runCodex(plan, args);

  const queueSync = syncQueueStatusFromPlan(plan);
  if (queueSync?.queue_status_synced) {
    process.stdout.write(`Ralph queue status synced: ${plan.task.id} ${queueSync.queue_status_previous} -> ${queueSync.queue_status}\n`);
  }

  const diff = changedFiles(plan.worktreePath);
  if (diff.length === 0) {
    writeRunMetadata(plan, args, "failed", { reason: "codex produced no worktree diff" });
    throw new Error("codex produced no worktree diff");
  }

  if (!args.skipVerify) runVerify(plan);

  let commitSha: string | undefined;
  let commitMessage: CommitMetadata | undefined;
  if (!args.skipCommit) {
    const commit = commitWorktree(plan, diff);
    commitSha = commit.sha;
    commitMessage = commit.metadata;
  }

  if (args.push) {
    runCommand("git", ["push", "-u", "origin", plan.branch], plan.worktreePath);
  }

  writeRunMetadata(plan, args, "completed", {
    changed_files: diff,
    commit_sha: commitSha,
    commit_title: commitMessage?.title,
    commit_description: commitMessage?.description,
    commit_metadata_source: commitMessage?.source,
    ...(queueSync ?? {}),
  });

  process.stdout.write([
    "MiniClaw Ralph completed.",
    `- task: ${plan.task.id}`,
    `- branch: ${plan.branch}`,
    `- commit: ${commitSha ?? "(not committed)"}`,
    `- commit title: ${commitMessage?.title ?? "(not committed)"}`,
    `- logs: ${plan.rawRunDir}`,
    "",
  ].join("\n"));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ralph-run error: ${message}\n`);
  process.exit(1);
});
