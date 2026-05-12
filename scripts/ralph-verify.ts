#!/usr/bin/env tsx
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface RalphQueue {
  defaults?: {
    verify_profile?: string;
  };
  tasks: RalphTask[];
}

interface RalphTask {
  id: string;
  title?: string;
  plan: string;
  verify_profile?: string;
  verify_commands?: string[];
}

interface Args {
  taskId?: string;
  queuePath: string;
  profile?: string;
  dryRun: boolean;
}

const PROFILE_COMMANDS: Record<string, string[]> = {
  docs: [
    "pnpm run quality:docs",
    "pnpm run lint",
  ],
  standard: [
    "pnpm run typecheck",
    "pnpm run lint",
    "pnpm run quality:docs",
  ],
  "task-runtime": [
    "pnpm vitest run src/agent/__tests__/e2e-fake-runtime.test.ts",
    "pnpm vitest run src/agent/__tests__/task-reporter.test.ts",
    "pnpm vitest run src/store/__tests__/task-events.test.ts",
    "pnpm run typecheck",
    "pnpm run lint",
    "pnpm run quality:docs",
  ],
  router: [
    "pnpm vitest run src/routing/__tests__/intent.test.ts src/routing/__tests__/context.test.ts src/routing/__tests__/confirmations.test.ts src/routing/__tests__/router-eval.test.ts src/routing/__tests__/router-review.test.ts src/store/__tests__/db.test.ts",
    "pnpm run typecheck",
    "pnpm run lint",
    "pnpm run quality:docs",
  ],
  store: [
    "pnpm vitest run src/store/__tests__/db.test.ts src/store/__tests__/task-events.test.ts src/store/__tests__/incidents.test.ts",
    "pnpm run typecheck",
    "pnpm run lint",
    "pnpm run quality:docs",
  ],
  config: [
    "pnpm vitest run src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts",
    "pnpm run typecheck",
    "pnpm run lint",
    "pnpm run quality:docs",
  ],
  provider: [
    "pnpm vitest run src/providers",
    "pnpm run typecheck",
    "pnpm run lint",
    "pnpm run quality:docs",
  ],
  doctor: [
    "pnpm vitest run src/ops/__tests__/doctor-scheduler.test.ts src/ops/__tests__/doctor-repair.test.ts src/ops/__tests__/doctor-ship.test.ts src/commands/__tests__/incident-detail.test.ts",
    "pnpm run typecheck",
    "pnpm run lint",
    "pnpm run quality:docs",
  ],
  cron: [
    "pnpm vitest run src/cron/__tests__/scheduler.test.ts src/cron/__tests__/failure-notifier.test.ts src/cron/__tests__/state.test.ts",
    "pnpm run e2e:cron",
    "pnpm run typecheck",
    "pnpm run lint",
    "pnpm run quality:docs",
  ],
  stage: [
    "pnpm vitest run src/stage",
    "pnpm run typecheck",
    "pnpm run lint",
    "pnpm run quality:docs",
  ],
  full: [
    "pnpm run quality:push",
  ],
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    queuePath: "docs/ralph/queue.json",
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--task") {
      args.taskId = requireValue(argv, ++i, arg);
    } else if (arg === "--queue") {
      args.queuePath = requireValue(argv, ++i, arg);
    } else if (arg === "--profile") {
      args.profile = requireValue(argv, ++i, arg);
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
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
    "Usage: pnpm ralph:verify -- --task <task-id> [--profile <name>] [--dry-run]",
    "",
    "Profiles:",
    ...Object.keys(PROFILE_COMMANDS).sort().map((profile) => `  - ${profile}`),
    "",
  ].join("\n"));
}

function gitText(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function readQueue(path: string): RalphQueue {
  return JSON.parse(readFileSync(path, "utf8")) as RalphQueue;
}

function findTask(queue: RalphQueue, taskId?: string): RalphTask | undefined {
  if (!taskId) return undefined;
  return queue.tasks.find((task) => task.id === taskId);
}

function commandsFor(queue: RalphQueue, task?: RalphTask, profileOverride?: string): { profile: string; commands: string[] } {
  if (task?.verify_commands?.length) {
    return { profile: "custom", commands: task.verify_commands };
  }
  const profile = profileOverride ?? task?.verify_profile ?? queue.defaults?.verify_profile ?? "standard";
  const commands = PROFILE_COMMANDS[profile];
  if (!commands) {
    throw new Error(`unknown verify profile: ${profile}`);
  }
  return { profile, commands };
}

function runShell(command: string, cwd: string): void {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    const suffix = result.signal ? ` signal=${result.signal}` : "";
    throw new Error(`verification command failed (${result.status ?? "unknown"}${suffix}): ${command}`);
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = gitText(["rev-parse", "--show-toplevel"]);
  process.chdir(repoRoot);

  const queue = readQueue(resolve(repoRoot, args.queuePath));
  const task = findTask(queue, args.taskId);
  if (args.taskId && !task) throw new Error(`task not found in queue: ${args.taskId}`);

  const { profile, commands } = commandsFor(queue, task, args.profile);
  process.stdout.write([
    `Ralph verify profile: ${profile}`,
    ...(task ? [`Task: ${task.id} (${task.title ?? task.plan})`] : []),
    "Commands:",
    ...commands.map((command) => `- ${command}`),
    "",
  ].join("\n"));

  if (!args.dryRun) {
    for (const command of commands) runShell(command, repoRoot);
  }

  process.stdout.write(`Ralph verification ${args.dryRun ? "dry-run" : "passed"}.\n`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ralph-verify error: ${message}\n`);
  process.exit(1);
}
