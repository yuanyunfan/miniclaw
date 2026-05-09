import Database from "better-sqlite3";
import yaml from "js-yaml";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_APP_NAME = "miniclaw";
const DEFAULT_DB_PATH = "~/.miniclaw/data.db";
const DEFAULT_CONFIG_PATH = "~/.miniclaw/config.yaml";

export interface RunningTaskSummary {
  id: string;
  prompt: string;
  cwd: string | null;
  created_at: string;
  session_id: string | null;
  discord_thread_id: string | null;
}

export interface SafeRestartArgs {
  app: string;
  force: boolean;
  json: boolean;
  dbPath?: string;
}

export interface SafeRestartResult {
  ok: boolean;
  app: string;
  dbPath: string;
  runningTasks: RunningTaskSummary[];
  exitCode: number;
  reason?: "running_tasks" | "pm2_failed";
}

export type RestartExecutor = (app: string, options: { json: boolean }) => Promise<number>;

function resolveHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function envOptional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveSafeRestartDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicitDbPath = envOptional(env, "MINICLAW_DB_PATH");
  if (explicitDbPath) return resolveHome(explicitDbPath);

  const rawConfigPath = envOptional(env, "MINICLAW_CONFIG") ?? DEFAULT_CONFIG_PATH;
  const configPath = resolveHome(rawConfigPath);
  if (existsSync(configPath)) {
    const parsed = yaml.load(readFileSync(configPath, "utf8"));
    if (isPlainObject(parsed) && isPlainObject(parsed.storage)) {
      const rawDbPath = parsed.storage.db_path;
      if (typeof rawDbPath === "string" && rawDbPath.trim()) {
        return resolveHome(rawDbPath);
      }
    }
  }

  return resolveHome(DEFAULT_DB_PATH);
}

function hasTasksTable(db: Database.Database): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'"
  ).get() as { name?: string } | undefined;
  return row?.name === "tasks";
}

export function listRunningTasksFromDb(dbPath: string): RunningTaskSummary[] {
  if (!existsSync(dbPath)) return [];

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!hasTasksTable(db)) return [];
    return db.prepare(
      `SELECT id, prompt, cwd, created_at, session_id, discord_thread_id
       FROM tasks
       WHERE status = 'running'
       ORDER BY created_at DESC, rowid DESC`
    ).all() as RunningTaskSummary[];
  } finally {
    db.close();
  }
}

export function parseSafeRestartArgs(argv: string[]): SafeRestartArgs {
  const args: SafeRestartArgs = {
    app: DEFAULT_APP_NAME,
    force: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") {
      args.force = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--app") {
      const value = argv[++i];
      if (!value) throw new Error("--app requires a PM2 app name");
      args.app = value;
    } else if (arg === "--db") {
      const value = argv[++i];
      if (!value) throw new Error("--db requires a SQLite DB path");
      args.dbPath = resolveHome(value);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function formatTask(task: RunningTaskSummary): string {
  const id = task.id.slice(0, 8);
  const prompt = task.prompt.replace(/\s+/g, " ").slice(0, 100) || "(empty prompt)";
  const cwd = task.cwd ? ` cwd=${task.cwd}` : "";
  const session = task.session_id ? ` session=${task.session_id.slice(0, 16)}` : "";
  return `- ${id} created=${task.created_at}${session}${cwd}\n  ${prompt}`;
}

async function defaultPm2Restart(app: string, options: { json: boolean }): Promise<number> {
  return await new Promise<number>((resolveCode, rejectErr) => {
    const child = spawn("pm2", ["restart", app, "--update-env"], {
      stdio: options.json ? ["ignore", "ignore", "pipe"] : "inherit",
    });
    child.stderr?.on("data", (chunk) => {
      void chunk;
    });
    child.on("error", rejectErr);
    child.on("exit", (code) => resolveCode(code ?? 1));
  });
}

export async function runSafeRestart(
  args: SafeRestartArgs,
  options: {
    env?: NodeJS.ProcessEnv;
    restart?: RestartExecutor;
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
  } = {}
): Promise<SafeRestartResult> {
  const writeOut = options.stdout ?? ((line) => process.stdout.write(line + "\n"));
  const writeErr = options.stderr ?? ((line) => process.stderr.write(line + "\n"));
  const dbPath = args.dbPath ?? resolveSafeRestartDbPath(options.env);
  const runningTasks = listRunningTasksFromDb(dbPath);

  if (runningTasks.length && !args.force) {
    const result: SafeRestartResult = {
      ok: false,
      app: args.app,
      dbPath,
      runningTasks,
      exitCode: 1,
      reason: "running_tasks",
    };
    if (args.json) {
      writeOut(JSON.stringify(result));
    } else {
      writeErr(`Refusing to restart PM2 app "${args.app}": ${runningTasks.length} running task(s).`);
      for (const task of runningTasks) writeErr(formatTask(task));
      writeErr("Use `pnpm safe-restart -- --force` to restart anyway.");
    }
    return result;
  }

  if (!args.json) {
    if (runningTasks.length) {
      writeErr(`Force restarting PM2 app "${args.app}"; ${runningTasks.length} running task(s) may be interrupted:`);
      for (const task of runningTasks) writeErr(formatTask(task));
    } else {
      writeOut(`Restarting PM2 app "${args.app}" (no running MiniClaw tasks found).`);
    }
  }

  const restart = options.restart ?? defaultPm2Restart;
  const exitCode = await restart(args.app, { json: args.json });
  const result: SafeRestartResult = {
    ok: exitCode === 0,
    app: args.app,
    dbPath,
    runningTasks,
    exitCode,
    ...(exitCode === 0 ? {} : { reason: "pm2_failed" as const }),
  };

  if (args.json) writeOut(JSON.stringify(result));
  return result;
}
