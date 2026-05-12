#!/usr/bin/env tsx
import { config } from "../src/config.js";
import { getDb, initDb } from "../src/store/db.js";
import {
  formatStateCleanupReport,
  isStateCleanupScope,
  runStateCleanup,
  STATE_CLEANUP_SCOPES,
  type StateCleanupScope,
} from "../src/store/state-cleanup.js";

interface Args {
  dryRun?: boolean;
  scope?: StateCleanupScope;
  olderThanDays?: number;
}

function usage(): string {
  return [
    "Usage: pnpm run state:cleanup -- [--dry-run | --execute] [--table <scope>] [--older-than-days <n>]",
    "",
    "Scopes:",
    `  ${STATE_CLEANUP_SCOPES.join(", ")}`,
    "",
    "Default mode follows state.retention.dry_run_default. Use --execute to delete rows.",
  ].join("\n");
}

function valueAfter(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function parsePositiveInt(raw: string, name: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function parseScope(raw: string): StateCleanupScope {
  if (isStateCleanupScope(raw)) return raw;
  throw new Error(`unknown cleanup scope: ${raw}. Expected one of: ${STATE_CLEANUP_SCOPES.join(", ")}`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === "--dry-run") {
      if (args.dryRun === false) throw new Error("cannot combine --dry-run and --execute");
      args.dryRun = true;
      continue;
    }
    if (arg === "--execute") {
      if (args.dryRun === true) throw new Error("cannot combine --dry-run and --execute");
      args.dryRun = false;
      continue;
    }
    if (arg === "--table" || arg === "--scope") {
      args.scope = parseScope(valueAfter(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--table=")) {
      args.scope = parseScope(arg.slice("--table=".length));
      continue;
    }
    if (arg.startsWith("--scope=")) {
      args.scope = parseScope(arg.slice("--scope=".length));
      continue;
    }
    if (arg === "--older-than-days") {
      args.olderThanDays = parsePositiveInt(valueAfter(argv, i, "--older-than-days"), "--older-than-days");
      i += 1;
      continue;
    }
    if (arg.startsWith("--older-than-days=")) {
      args.olderThanDays = parsePositiveInt(arg.slice("--older-than-days=".length), "--older-than-days");
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  initDb();
  const report = runStateCleanup(getDb(), {
    retention: config.state.retention,
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.scope ? { scope: args.scope } : {}),
    ...(args.olderThanDays !== undefined ? { olderThanDays: args.olderThanDays } : {}),
  });
  process.stdout.write(formatStateCleanupReport(report));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`state cleanup error: ${message}\n\n${usage()}\n`);
  process.exit(2);
}
