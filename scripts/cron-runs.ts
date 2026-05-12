#!/usr/bin/env tsx
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadRuntimeConfigSource } from "../src/config/load.js";
import { resolveHome } from "../src/config/resolve.js";
import { setDb } from "../src/store/connection.js";
import {
  CRON_RUN_STATUSES,
  listCronRuns,
  resolveCronRunByIdPrefix,
  summarizeCronRuns,
  type CronRunStatus,
} from "../src/store/cron-runs.js";
import {
  formatCronRunDetail,
  formatCronRunList,
  formatCronRunLookupError,
  formatCronRunSummary,
} from "../src/cron/run-history-format.js";
import { ensureBaseSchema, runMigrations } from "../src/store/schema.js";

interface Args {
  id?: string;
  job?: string;
  status?: CronRunStatus;
  since?: string;
  until?: string;
  limit: number;
  summary: boolean;
  json: boolean;
}

function usage(): string {
  return [
    "Usage: pnpm run cron:runs -- [--id <run-prefix>] [--job <name>] [--status <status>] [--summary] [--json]",
    "",
    "Options:",
    "  --id <run-prefix>     Show one cron run by full id or unique prefix.",
    "  --job <name>          Filter recent runs or summaries to one job.",
    `  --status <status>    Filter recent runs (${CRON_RUN_STATUSES.join(", ")}).`,
    "  --since <iso>         Include runs started at or after this timestamp.",
    "  --until <iso>         Include runs started at or before this timestamp.",
    "  --limit <n>           Max rows/jobs to print (default 20).",
    "  --summary             Print per-job grouped counts instead of recent rows.",
    "  --json                Print JSON.",
  ].join("\n");
}

function valueAfter(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function parseDateArg(value: string, name: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${name} must be an ISO-like timestamp`);
  return value;
}

function parseLimit(value: string): number {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error("--limit must be a positive integer");
  return limit;
}

function parseStatus(value: string): CronRunStatus {
  if ((CRON_RUN_STATUSES as readonly string[]).includes(value)) return value as CronRunStatus;
  throw new Error(`unknown --status: ${value}`);
}

function configObjectField(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function resolveDbPath(): string {
  if (process.env.MINICLAW_DB_PATH) return resolveHome(process.env.MINICLAW_DB_PATH);
  const source = loadRuntimeConfigSource(process.env);
  const storage = configObjectField(source.data, "storage");
  const dbPath = configObjectField(storage, "db_path");
  return resolveHome(typeof dbPath === "string" && dbPath.trim() ? dbPath : "~/.miniclaw/data.db");
}

function initCronRunsDb(): void {
  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const database = new Database(dbPath);
  setDb(database);
  database.pragma("journal_mode = WAL");
  ensureBaseSchema(database);
  runMigrations(database);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 20, summary: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage() + "\n");
      process.exit(0);
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--summary") {
      args.summary = true;
      continue;
    }
    if (arg === "--id") {
      args.id = valueAfter(argv, i, "--id");
      i++;
      continue;
    }
    if (arg.startsWith("--id=")) {
      args.id = arg.slice("--id=".length);
      continue;
    }
    if (arg === "--job") {
      args.job = valueAfter(argv, i, "--job");
      i++;
      continue;
    }
    if (arg.startsWith("--job=")) {
      args.job = arg.slice("--job=".length);
      continue;
    }
    if (arg === "--status") {
      args.status = parseStatus(valueAfter(argv, i, "--status"));
      i++;
      continue;
    }
    if (arg.startsWith("--status=")) {
      args.status = parseStatus(arg.slice("--status=".length));
      continue;
    }
    if (arg === "--since") {
      args.since = parseDateArg(valueAfter(argv, i, "--since"), "--since");
      i++;
      continue;
    }
    if (arg.startsWith("--since=")) {
      args.since = parseDateArg(arg.slice("--since=".length), "--since");
      continue;
    }
    if (arg === "--until") {
      args.until = parseDateArg(valueAfter(argv, i, "--until"), "--until");
      i++;
      continue;
    }
    if (arg.startsWith("--until=")) {
      args.until = parseDateArg(arg.slice("--until=".length), "--until");
      continue;
    }
    if (arg === "--limit") {
      args.limit = parseLimit(valueAfter(argv, i, "--limit"));
      i++;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      args.limit = parseLimit(arg.slice("--limit=".length));
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (args.id && args.summary) throw new Error("--id cannot be combined with --summary");
  if (args.summary && args.status) throw new Error("--summary cannot be combined with --status");
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  initCronRunsDb();

  if (args.id) {
    const resolved = resolveCronRunByIdPrefix(args.id);
    if (!resolved.ok) throw new Error(formatCronRunLookupError(resolved.error));
    process.stdout.write(args.json
      ? `${JSON.stringify(resolved.value, null, 2)}\n`
      : `${formatCronRunDetail(resolved.value)}\n`);
    process.exit(0);
  }

  if (args.summary) {
    const rows = summarizeCronRuns({
      jobName: args.job,
      since: args.since,
      until: args.until,
      limit: args.limit,
    });
    process.stdout.write(args.json
      ? `${JSON.stringify(rows, null, 2)}\n`
      : `${formatCronRunSummary(rows)}\n`);
    process.exit(0);
  }

  const rows = listCronRuns({
    jobName: args.job,
    status: args.status,
    since: args.since,
    until: args.until,
    limit: args.limit,
  });
  process.stdout.write(args.json
    ? `${JSON.stringify(rows, null, 2)}\n`
    : `${formatCronRunList(rows)}\n`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`cron runs error: ${message}\n\n${usage()}\n`);
  process.exit(2);
}
