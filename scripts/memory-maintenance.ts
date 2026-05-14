#!/usr/bin/env tsx
import {
  formatMemoryMaintenanceReport,
  runMemoryMaintenance,
} from "../src/memory/maintenance.js";

interface Args {
  dryRun: boolean;
  json: boolean;
}

function usage(): string {
  return [
    "Usage: pnpm run memory:maintenance -- [--dry-run | --apply] [--json]",
    "",
    "Default mode is --dry-run. Use --apply to delete dirty memories, merge duplicates, archive stale entries, and fill missing metadata.",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: true, json: false };
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === "--dry-run") {
      if (!args.dryRun) throw new Error("cannot combine --dry-run and --apply");
      args.dryRun = true;
      continue;
    }
    if (arg === "--apply" || arg === "--execute") {
      if (!args.dryRun) throw new Error("duplicate --apply");
      args.dryRun = false;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const report = runMemoryMaintenance({ dryRun: args.dryRun });
  process.stdout.write(args.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatMemoryMaintenanceReport(report));
  if (args.dryRun && report.findings.length) {
    process.exitCode = 1;
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`memory maintenance error: ${message}\n\n${usage()}\n`);
  process.exit(2);
}
