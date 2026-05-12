import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSafeRestartDbPath } from "../safe-restart.js";
import { resolveHome } from "./args.js";
import {
  cleanText,
  errorMessage,
  isRecord,
  nullableCleanText,
  nullableNumber,
  nullableString,
  numberValue,
  redactSensitive,
  stringValue,
} from "./redaction.js";
import type {
  CommandRunner,
  DoctorArgs,
  DoctorConnectivityState,
  DoctorCronJobState,
  DoctorEvidence,
  DoctorGitState,
  DoctorLogEvidence,
  DoctorMode,
  DoctorPm2State,
  DoctorTaskEventRow,
  DoctorTaskRow,
  RunDoctorOptions,
} from "./types.js";

const DEFAULT_PM2_APP = "miniclaw";
const DEFAULT_CRON_STATE_PATH = "~/.miniclaw/cron/state.json";
const DEFAULT_CONNECTIVITY_STATE_PATH = "~/.miniclaw/runtime/connectivity.json";
const DEFAULT_LOG_DIR = "~/.miniclaw/logs";
const LONG_RUNNING_TASK_MS = 30 * 60 * 1000;
const LOG_TAIL_LINES = 80;

function envOptional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function taskRow(row: Record<string, unknown>): DoctorTaskRow {
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? ""),
    prompt: cleanText(row.prompt, 3000),
    cwd: nullableString(row.cwd),
    session_id: nullableString(row.session_id),
    discord_thread_id: nullableString(row.discord_thread_id),
    source_route_type: nullableString(row.source_route_type),
    source_channel_id: nullableString(row.source_channel_id),
    source_message_url: nullableString(row.source_message_url),
    result_summary: nullableCleanText(row.result_summary, 3000),
    created_at: nullableString(row.created_at),
    completed_at: nullableString(row.completed_at),
    duration_ms: nullableNumber(row.duration_ms),
  };
}

function hasTasksTable(db: Database.Database): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as
    | { name?: string }
    | undefined;
  return row?.name === "tasks";
}

function hasTaskEventsTable(db: Database.Database): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_events'").get() as
    | { name?: string }
    | undefined;
  return row?.name === "task_events";
}

function collectTasks(dbPath: string, mode: DoctorMode, taskIdPrefix: string | undefined, now: Date): {
  task?: DoctorTaskRow;
  taskCandidates: DoctorTaskRow[];
} {
  if (!existsSync(dbPath)) return { taskCandidates: [] };

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!hasTasksTable(db)) return { taskCandidates: [] };

    if (mode === "task" && taskIdPrefix) {
      const rows = db.prepare(
        `SELECT * FROM tasks
         WHERE id LIKE @prefix
         ORDER BY created_at DESC, rowid DESC
         LIMIT 5`
      ).all({ prefix: `${taskIdPrefix}%` }) as Record<string, unknown>[];
      const candidates = rows.map(taskRow);
      return { task: candidates[0], taskCandidates: candidates };
    }

    const rows = db.prepare(
      `SELECT * FROM tasks
       WHERE status IN ('failed', 'interrupted', 'running')
       ORDER BY created_at DESC, rowid DESC
       LIMIT 20`
    ).all() as Record<string, unknown>[];
    const candidates = rows.map(taskRow).filter((task) => {
      if (task.status !== "running") return true;
      const createdMs = task.created_at ? Date.parse(task.created_at) : Number.NaN;
      return Number.isFinite(createdMs) && now.getTime() - createdMs > LONG_RUNNING_TASK_MS;
    });
    return { task: candidates[0], taskCandidates: candidates };
  } finally {
    db.close();
  }
}

function taskEventRow(row: Record<string, unknown>): DoctorTaskEventRow {
  return {
    id: Number(row.id ?? 0),
    task_id: String(row.task_id ?? ""),
    event_type: String(row.event_type ?? ""),
    severity: String(row.severity ?? "info"),
    message: nullableCleanText(row.message, 800),
    payload_json: nullableCleanText(row.payload_json, 1200),
    created_at: String(row.created_at ?? ""),
  };
}

function collectTaskEvents(dbPath: string, taskIds: string[]): DoctorTaskEventRow[] {
  const uniqueIds = [...new Set(taskIds.filter(Boolean))].slice(0, 10);
  if (!uniqueIds.length || !existsSync(dbPath)) return [];

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!hasTaskEventsTable(db)) return [];
    const stmt = db.prepare(
      `SELECT * FROM task_events
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    );
    const events = uniqueIds.flatMap((taskId) =>
      (stmt.all(taskId, 12) as Record<string, unknown>[]).map(taskEventRow)
    );
    return events
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .slice(0, 80);
  } finally {
    db.close();
  }
}

function cronStatePath(env: NodeJS.ProcessEnv, explicit?: string): string {
  return resolveHome(explicit ?? envOptional(env, "MINICLAW_CRON_STATE") ?? DEFAULT_CRON_STATE_PATH);
}

function connectivityStatePath(env: NodeJS.ProcessEnv, explicit?: string): string {
  return resolveHome(explicit ?? envOptional(env, "MINICLAW_CONNECTIVITY_STATE_PATH") ?? DEFAULT_CONNECTIVITY_STATE_PATH);
}

function logDir(env: NodeJS.ProcessEnv, explicit?: string): string {
  return resolveHome(explicit ?? envOptional(env, "MINICLAW_LOG_DIR") ?? DEFAULT_LOG_DIR);
}

function collectCron(path: string, mode: DoctorMode, jobName?: string): {
  cron?: DoctorCronJobState;
  cronErrors: DoctorCronJobState[];
} {
  if (!existsSync(path)) return { cronErrors: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { jobs?: Record<string, Record<string, unknown>> };
    const jobs = parsed.jobs ?? {};
    const states = Object.entries(jobs).map(([name, state]) => ({
      name,
      last_run_at: stringValue(state.last_run_at),
      last_status: stringValue(state.last_status),
      last_error: state.last_error ? redactSensitive(String(state.last_error)) : undefined,
      last_duration_ms: numberValue(state.last_duration_ms),
      completed: numberValue(state.completed),
      last_attempt: numberValue(state.last_attempt),
      max_attempts: numberValue(state.max_attempts),
      next_retry_at: stringValue(state.next_retry_at),
      failure_run_id: stringValue(state.failure_run_id),
    }));
    const cron = mode === "cron" && jobName ? states.find((state) => state.name === jobName) : undefined;
    return {
      cron,
      cronErrors: states
        .filter((state) => state.last_status === "error")
        .sort((a, b) => String(b.last_run_at ?? "").localeCompare(String(a.last_run_at ?? "")))
        .slice(0, 10),
    };
  } catch (err) {
    return {
      cron: mode === "cron" && jobName ? { name: jobName, last_status: "error", last_error: `failed to parse cron state: ${errorMessage(err)}` } : undefined,
      cronErrors: [],
    };
  }
}

function collectConnectivity(path: string): DoctorConnectivityState {
  if (!existsSync(path)) return { error: "connectivity state file not found" };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return {
      status: stringValue(parsed.status),
      updated_at: stringValue(parsed.updated_at),
      consecutive_failures: numberValue(parsed.consecutive_failures),
      checks: isRecord(parsed.checks) ? parsed.checks : undefined,
    };
  } catch (err) {
    return { error: `failed to parse connectivity state: ${errorMessage(err)}` };
  }
}

function defaultCommandRunner(cmd: string, args: string[], cwd?: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function collectPm2(app: string, runner: CommandRunner): DoctorPm2State {
  try {
    const raw = runner("pm2", ["jlist"]);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { app, found: false, error: "pm2 jlist did not return an array" };
    const found = parsed.find((entry) => {
      if (!isRecord(entry)) return false;
      const env = entry.pm2_env;
      return isRecord(env) && env.name === app;
    }) as Record<string, unknown> | undefined;
    if (!found || !isRecord(found.pm2_env)) return { app, found: false };
    const env = found.pm2_env;
    return {
      app,
      found: true,
      status: stringValue(env.status),
      pid: numberValue(found.pid),
      restartCount: numberValue(env.restart_time),
      unstableRestarts: numberValue(env.unstable_restarts),
      uptimeMs: numberValue(env.pm_uptime),
    };
  } catch (err) {
    return { app, found: false, error: errorMessage(err) };
  }
}

function collectGit(cwd: string, runner: CommandRunner): DoctorGitState {
  const dirtyFiles: string[] = [];
  const state: DoctorGitState = { cwd, dirtyFiles };
  try {
    state.branch = runner("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim();
    state.sha = runner("git", ["rev-parse", "--short", "HEAD"], cwd).trim();
    state.remote = runner("git", ["remote", "get-url", "origin"], cwd).trim();
    const status = runner("git", ["status", "--short"], cwd);
    for (const line of status.split(/\r?\n/)) {
      if (line.trim()) dirtyFiles.push(line);
    }
  } catch (err) {
    state.error = errorMessage(err);
  }
  return state;
}

function collectLogs(dir: string, subject?: string): DoctorLogEvidence[] {
  const paths = [join(dir, "miniclaw-error.log"), join(dir, "miniclaw-out.log")];
  return paths.map((path) => {
    if (!existsSync(path)) return { path, missing: true, lines: [] };
    const raw = readFileSync(path, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const candidates = subject
      ? lines.filter((line) => line.includes(subject) || line.toLowerCase().includes("error") || line.includes("失败"))
      : lines.filter((line) => line.toLowerCase().includes("error") || line.includes("失败") || line.includes("interrupted"));
    return {
      path,
      lines: candidates.slice(-LOG_TAIL_LINES).map(redactSensitive),
    };
  });
}

export function collectDoctorEvidence(args: DoctorArgs, options: RunDoctorOptions = {}): DoctorEvidence {
  const env = options.env ?? process.env;
  const now = options.now?.() ?? new Date();
  const runner = options.commandRunner ?? defaultCommandRunner;
  const cwd = args.cwd ? resolveHome(args.cwd) : process.cwd();
  const dbPath = args.dbPath ? resolveHome(args.dbPath) : resolveSafeRestartDbPath(env);
  const cronPath = cronStatePath(env, args.cronStatePath);
  const connectivityPath = connectivityStatePath(env, args.connectivityStatePath);
  const subject = args.mode === "task" ? args.taskIdPrefix : args.mode === "cron" ? args.cronJobName : undefined;
  const taskResult = collectTasks(dbPath, args.mode, args.taskIdPrefix, now);
  const taskEventIds = taskResult.taskCandidates.map((task) => task.id);
  if (taskResult.task?.id && !taskEventIds.includes(taskResult.task.id)) {
    taskEventIds.unshift(taskResult.task.id);
  }
  const cronResult = collectCron(cronPath, args.mode, args.cronJobName);

  return {
    generatedAt: now.toISOString(),
    mode: args.mode,
    subject,
    dbPath,
    cronStatePath: cronPath,
    connectivityStatePath: connectivityPath,
    ...taskResult,
    taskEvents: collectTaskEvents(dbPath, taskEventIds),
    ...cronResult,
    pm2: collectPm2(args.pm2App ?? DEFAULT_PM2_APP, runner),
    git: collectGit(cwd, runner),
    connectivity: collectConnectivity(connectivityPath),
    logs: collectLogs(logDir(env, args.logDir), subject),
  };
}
