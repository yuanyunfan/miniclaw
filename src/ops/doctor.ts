import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveSafeRestartDbPath } from "./safe-restart.js";

export type DoctorMode = "recent" | "task" | "cron";
export type DoctorIncidentType =
  | "task_failed"
  | "task_interrupted"
  | "task_running_too_long"
  | "cron_failed"
  | "chat_error"
  | "discord_outage"
  | "pm2_restart_loop"
  | "unknown";
export type DoctorSeverity = "info" | "warning" | "critical";
export type DoctorCategory =
  | "user_prompt"
  | "network"
  | "discord"
  | "provider_data"
  | "provider_auth"
  | "miniclaw_bug"
  | "third_party"
  | "unknown";

export interface DoctorTaskRow {
  id: string;
  status: string;
  prompt: string;
  cwd?: string | null;
  session_id?: string | null;
  discord_thread_id?: string | null;
  source_route_type?: string | null;
  source_channel_id?: string | null;
  source_message_url?: string | null;
  result_summary?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
}

export interface DoctorCronJobState {
  name: string;
  last_run_at?: string;
  last_status?: string;
  last_error?: string;
  last_duration_ms?: number;
  completed?: number;
  last_attempt?: number;
  max_attempts?: number;
  next_retry_at?: string;
  failure_run_id?: string;
}

export interface DoctorPm2State {
  app: string;
  found: boolean;
  status?: string;
  pid?: number;
  restartCount?: number;
  unstableRestarts?: number;
  uptimeMs?: number;
  error?: string;
}

export interface DoctorGitState {
  cwd: string;
  branch?: string;
  sha?: string;
  remote?: string;
  dirtyFiles: string[];
  error?: string;
}

export interface DoctorConnectivityState {
  status?: string;
  updated_at?: string;
  consecutive_failures?: number;
  checks?: Record<string, unknown>;
  error?: string;
}

export interface DoctorLogEvidence {
  path: string;
  lines: string[];
  missing?: boolean;
}

export interface DoctorEvidence {
  generatedAt: string;
  mode: DoctorMode;
  subject?: string;
  dbPath: string;
  cronStatePath: string;
  connectivityStatePath: string;
  task?: DoctorTaskRow;
  taskCandidates: DoctorTaskRow[];
  cron?: DoctorCronJobState;
  cronErrors: DoctorCronJobState[];
  pm2: DoctorPm2State;
  git: DoctorGitState;
  connectivity: DoctorConnectivityState;
  logs: DoctorLogEvidence[];
}

export interface DoctorDiagnosis {
  incidentType: DoctorIncidentType;
  severity: DoctorSeverity;
  category: DoctorCategory;
  title: string;
  summary: string;
  evidenceSummary: string[];
  repairAllowed: boolean;
  recommendedAction: string;
}

export interface DoctorReport {
  evidence: DoctorEvidence;
  diagnosis: DoctorDiagnosis;
}

export interface DoctorArgs {
  mode: DoctorMode;
  taskIdPrefix?: string;
  cronJobName?: string;
  json: boolean;
  dbPath?: string;
  cronStatePath?: string;
  connectivityStatePath?: string;
  logDir?: string;
  cwd?: string;
  pm2App?: string;
}

export type CommandRunner = (cmd: string, args: string[], cwd?: string) => string;

export interface RunDoctorOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  commandRunner?: CommandRunner;
}

const DEFAULT_PM2_APP = "miniclaw";
const DEFAULT_CRON_STATE_PATH = "~/.miniclaw/cron/state.json";
const DEFAULT_CONNECTIVITY_STATE_PATH = "~/.miniclaw/runtime/connectivity.json";
const DEFAULT_LOG_DIR = "~/.miniclaw/logs";
const LONG_RUNNING_TASK_MS = 30 * 60 * 1000;
const LOG_TAIL_LINES = 80;

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

export function redactSensitive(input: string): string {
  return input
    .replace(/(authorization|cookie|password|passwd|pass|token|secret|api[_-]?key|session)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_./+=-]{12,}\b/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_./+=-]{48,}\b/g, "[redacted]");
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

function cleanText(value: unknown, max: number): string {
  const text = redactSensitive(String(value ?? ""));
  return text.length > max ? text.slice(0, max) + "\n... (truncated)" : text;
}

function nullableCleanText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return cleanText(value, max);
}

function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasTasksTable(db: Database.Database): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as
    | { name?: string }
    | undefined;
  return row?.name === "tasks";
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function classifyCategory(text: string, connectivity: DoctorConnectivityState): DoctorCategory {
  const lower = text.toLowerCase();
  if (connectivity.status && !["discord_ok", "recovered"].includes(connectivity.status)) {
    if (connectivity.status.includes("discord") || connectivity.status.includes("vpn")) return "discord";
    return "network";
  }
  if (/(cookie|auth|unauthori[sz]ed|forbidden|credential|session expired|login|登录|鉴权|认证)/i.test(text)) return "provider_auth";
  if (/(no new|not found|empty|没有|无新|0 条|0条|no data|data absence)/i.test(text)) return "provider_data";
  if (/(timeout|429|rate limit|econn|enotfound|http 5\d\d|upstream|third[- ]party)/i.test(text)) return "third_party";
  if (/(typeerror|referenceerror|syntaxerror|assertion|schema|migration|cannot read|undefined|exception|bug)/i.test(text)) return "miniclaw_bug";
  return "unknown";
}

function isRepairAllowed(type: DoctorIncidentType, category: DoctorCategory, git: DoctorGitState): boolean {
  if (git.dirtyFiles.length > 0) return false;
  if (!["miniclaw_bug", "unknown"].includes(category)) return false;
  return ["task_failed", "cron_failed", "chat_error"].includes(type);
}

function diagnose(evidence: DoctorEvidence): DoctorDiagnosis {
  const subjectText = [
    evidence.task?.status,
    evidence.task?.result_summary,
    evidence.task?.prompt,
    evidence.cron?.last_error,
    evidence.cronErrors[0]?.last_error,
    evidence.logs.flatMap((log) => log.lines).slice(-20).join("\n"),
  ].filter(Boolean).join("\n");

  let incidentType: DoctorIncidentType = "unknown";
  let title = "No clear MiniClaw incident found";
  const evidenceSummary: string[] = [];

  if (evidence.mode === "task" && !evidence.task) {
    title = `Task not found: ${evidence.subject ?? ""}`.trim();
  } else if (evidence.mode === "cron" && evidence.cron?.last_status === "error") {
    incidentType = "cron_failed";
    title = `Cron failed: ${evidence.cron.name}`;
  } else if (evidence.mode === "cron" && !evidence.cron) {
    title = `Cron job not found: ${evidence.subject ?? ""}`.trim();
  } else if (evidence.task?.status === "failed") {
    incidentType = "task_failed";
    title = `Task failed: ${evidence.task.id.slice(0, 8)}`;
  } else if (evidence.task?.status === "interrupted") {
    incidentType = "task_interrupted";
    title = `Task interrupted: ${evidence.task.id.slice(0, 8)}`;
  } else if (evidence.task?.status === "running") {
    incidentType = "task_running_too_long";
    title = `Task still running: ${evidence.task.id.slice(0, 8)}`;
  } else if (evidence.cronErrors.length) {
    incidentType = "cron_failed";
    title = `Recent cron failure: ${evidence.cronErrors[0].name}`;
  } else if (evidence.connectivity.status && !["discord_ok", "recovered"].includes(evidence.connectivity.status)) {
    incidentType = "discord_outage";
    title = `Connectivity degraded: ${evidence.connectivity.status}`;
  } else if ((evidence.pm2.unstableRestarts ?? 0) > 0) {
    incidentType = "pm2_restart_loop";
    title = `PM2 app has unstable restarts: ${evidence.pm2.app}`;
  }

  if (evidence.task) {
    evidenceSummary.push(`task=${evidence.task.id.slice(0, 8)} status=${evidence.task.status}`);
    if (evidence.task.result_summary) evidenceSummary.push(`task_result=${evidence.task.result_summary.slice(0, 180)}`);
    if (evidence.task.source_route_type) evidenceSummary.push(`route=${evidence.task.source_route_type}`);
  }
  if (evidence.cron) {
    evidenceSummary.push(`cron=${evidence.cron.name} status=${evidence.cron.last_status ?? "unknown"}`);
    if (evidence.cron.last_error) evidenceSummary.push(`cron_error=${evidence.cron.last_error.slice(0, 180)}`);
  } else if (evidence.cronErrors.length) {
    evidenceSummary.push(`cron_errors=${evidence.cronErrors.map((job) => job.name).join(", ")}`);
  }
  if (evidence.connectivity.status) {
    evidenceSummary.push(`connectivity=${evidence.connectivity.status} failures=${evidence.connectivity.consecutive_failures ?? 0}`);
  }
  if (evidence.pm2.found) {
    evidenceSummary.push(`pm2=${evidence.pm2.status ?? "unknown"} restarts=${evidence.pm2.restartCount ?? 0}`);
  } else if (evidence.pm2.error) {
    evidenceSummary.push(`pm2_unavailable=${evidence.pm2.error.slice(0, 120)}`);
  }
  if (evidence.git.sha) {
    evidenceSummary.push(`git=${evidence.git.branch ?? "unknown"}@${evidence.git.sha} dirty=${evidence.git.dirtyFiles.length}`);
  }

  const category = classifyCategory(subjectText, evidence.connectivity);
  const severity: DoctorSeverity = incidentType === "pm2_restart_loop" || incidentType === "discord_outage"
    ? "critical"
    : incidentType === "unknown"
      ? "info"
      : "warning";
  const repairAllowed = isRepairAllowed(incidentType, category, evidence.git);
  const recommendedAction = repairAllowed
    ? "This looks potentially repairable, but Phase 1 is read-only. Run a manual task or future doctor:repair flow after reviewing the evidence."
    : recommendedActionFor(incidentType, category, evidence.git);

  return {
    incidentType,
    severity,
    category,
    title,
    summary: buildSummary(incidentType, category),
    evidenceSummary,
    repairAllowed,
    recommendedAction,
  };
}

function buildSummary(type: DoctorIncidentType, category: DoctorCategory): string {
  if (type === "unknown") return "Doctor did not find a clear failing task, cron error, Discord outage, or PM2 restart loop.";
  if (category === "discord" || category === "network") return "The strongest signal points to connectivity rather than a code repair.";
  if (category === "provider_auth") return "The strongest signal points to provider authentication/session health.";
  if (category === "provider_data") return "The strongest signal points to missing or empty upstream data.";
  if (category === "miniclaw_bug") return "The strongest signal points to a MiniClaw code/runtime bug.";
  return "The incident needs human review before deciding whether it is repairable.";
}

function recommendedActionFor(type: DoctorIncidentType, category: DoctorCategory, git: DoctorGitState): string {
  if (git.dirtyFiles.length > 0) return "Workspace has dirty files; review them before any repair workflow.";
  if (category === "discord" || category === "network") return "Check VPN/proxy/network and Discord reachability before changing code.";
  if (category === "provider_auth") return "Refresh or diagnose the provider session/auth path; do not auto-repair credentials.";
  if (category === "provider_data") return "Verify upstream data availability and cron/provider filters.";
  if (type === "task_interrupted") return "Use /resume if a provider session exists; inspect restart/drain logs before changing code.";
  return "Review evidence and decide whether to create a focused repair task.";
}

export async function runDoctor(args: DoctorArgs, options: RunDoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const now = options.now?.() ?? new Date();
  const runner = options.commandRunner ?? defaultCommandRunner;
  const cwd = args.cwd ? resolveHome(args.cwd) : process.cwd();
  const dbPath = args.dbPath ? resolveHome(args.dbPath) : resolveSafeRestartDbPath(env);
  const cronPath = cronStatePath(env, args.cronStatePath);
  const connectivityPath = connectivityStatePath(env, args.connectivityStatePath);
  const subject = args.mode === "task" ? args.taskIdPrefix : args.mode === "cron" ? args.cronJobName : undefined;
  const taskResult = collectTasks(dbPath, args.mode, args.taskIdPrefix, now);
  const cronResult = collectCron(cronPath, args.mode, args.cronJobName);
  const evidence: DoctorEvidence = {
    generatedAt: now.toISOString(),
    mode: args.mode,
    subject,
    dbPath,
    cronStatePath: cronPath,
    connectivityStatePath: connectivityPath,
    ...taskResult,
    ...cronResult,
    pm2: collectPm2(args.pm2App ?? DEFAULT_PM2_APP, runner),
    git: collectGit(cwd, runner),
    connectivity: collectConnectivity(connectivityPath),
    logs: collectLogs(logDir(env, args.logDir), subject),
  };
  return { evidence, diagnosis: diagnose(evidence) };
}

export function parseDoctorArgs(argv: string[]): DoctorArgs {
  const args: DoctorArgs = {
    mode: "recent",
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--recent") {
      args.mode = "recent";
      args.taskIdPrefix = undefined;
      args.cronJobName = undefined;
    } else if (arg === "--task") {
      const value = argv[++i];
      if (!value) throw new Error("--task requires a task id prefix");
      args.mode = "task";
      args.taskIdPrefix = value;
      args.cronJobName = undefined;
    } else if (arg === "--cron") {
      const value = argv[++i];
      if (!value) throw new Error("--cron requires a cron job name");
      args.mode = "cron";
      args.cronJobName = value;
      args.taskIdPrefix = undefined;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--db") {
      const value = argv[++i];
      if (!value) throw new Error("--db requires a SQLite DB path");
      args.dbPath = resolveHome(value);
    } else if (arg === "--cron-state") {
      const value = argv[++i];
      if (!value) throw new Error("--cron-state requires a JSON state path");
      args.cronStatePath = resolveHome(value);
    } else if (arg === "--connectivity-state") {
      const value = argv[++i];
      if (!value) throw new Error("--connectivity-state requires a JSON state path");
      args.connectivityStatePath = resolveHome(value);
    } else if (arg === "--log-dir") {
      const value = argv[++i];
      if (!value) throw new Error("--log-dir requires a log directory");
      args.logDir = resolveHome(value);
    } else if (arg === "--cwd") {
      const value = argv[++i];
      if (!value) throw new Error("--cwd requires a working directory");
      args.cwd = resolveHome(value);
    } else if (arg === "--app") {
      const value = argv[++i];
      if (!value) throw new Error("--app requires a PM2 app name");
      args.pm2App = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

export function formatDoctorReport(report: DoctorReport): string {
  const d = report.diagnosis;
  const e = report.evidence;
  const lines = [
    `MiniClaw Doctor: ${d.title}`,
    "",
    `Type: ${d.incidentType}`,
    `Severity: ${d.severity}`,
    `Category: ${d.category}`,
    `Repair allowed: ${d.repairAllowed ? "yes" : "no"}`,
    "",
    d.summary,
    "",
    "Evidence:",
    ...d.evidenceSummary.map((line) => `- ${line}`),
    "",
    "Next action:",
    d.recommendedAction,
    "",
    `Generated: ${e.generatedAt}`,
  ];

  const logLines = e.logs.flatMap((log) => log.lines.map((line) => `${log.path}: ${line}`)).slice(-8);
  if (logLines.length) {
    lines.push("", "Recent matching log lines:", ...logLines.map((line) => `- ${line.slice(0, 260)}`));
  }

  return lines.join("\n");
}
