#!/usr/bin/env tsx
import { writeFileSync } from "node:fs";
import { initDb } from "../src/store/db.js";
import {
  buildTaskTraceModel,
  renderTaskTraceMarkdown,
  resolveTaskForTrace,
  type TaskTraceError,
} from "../src/store/task-trace-export.js";

interface Args {
  id?: string;
  out?: string;
  json: boolean;
  maxEvents: number;
  maxBytes: number;
}

function usage(): string {
  return [
    "Usage: pnpm run task:trace -- --id <task-prefix> [--out /tmp/task-trace.md] [--json]",
    "",
    "Options:",
    "  --id <task-prefix>    Task id or unique id prefix.",
    "  --out <path>          Write Markdown to a file instead of stdout.",
    "  --json                Print the sanitized trace model as JSON.",
    "  --max-events <n>      Render at most n latest events (default 500).",
    "  --max-bytes <n>       Cap Markdown bytes (default 200000).",
  ].join("\n");
}

function valueAfter(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, maxEvents: 500, maxBytes: 200_000 };
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
    if (arg === "--id") {
      args.id = valueAfter(argv, i, "--id");
      i++;
      continue;
    }
    if (arg.startsWith("--id=")) {
      args.id = arg.slice("--id=".length);
      continue;
    }
    if (arg === "--out") {
      args.out = valueAfter(argv, i, "--out");
      i++;
      continue;
    }
    if (arg.startsWith("--out=")) {
      args.out = arg.slice("--out=".length);
      continue;
    }
    if (arg === "--max-events") {
      args.maxEvents = Number.parseInt(valueAfter(argv, i, "--max-events"), 10);
      i++;
      continue;
    }
    if (arg.startsWith("--max-events=")) {
      args.maxEvents = Number.parseInt(arg.slice("--max-events=".length), 10);
      continue;
    }
    if (arg === "--max-bytes") {
      args.maxBytes = Number.parseInt(valueAfter(argv, i, "--max-bytes"), 10);
      i++;
      continue;
    }
    if (arg.startsWith("--max-bytes=")) {
      args.maxBytes = Number.parseInt(arg.slice("--max-bytes=".length), 10);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!args.id?.trim()) throw new Error("--id is required");
  if (!Number.isFinite(args.maxEvents) || args.maxEvents <= 0) throw new Error("--max-events must be a positive integer");
  if (!Number.isFinite(args.maxBytes) || args.maxBytes <= 0) throw new Error("--max-bytes must be a positive integer");
  return args;
}

function errorText(error: TaskTraceError): string {
  if (error.code === "ambiguous_prefix") {
    const matches = error.matches?.map((id) => id.slice(0, 12)).join(", ") ?? "-";
    return `${error.message}: ${matches}`;
  }
  return error.message;
}

try {
  const args = parseArgs(process.argv.slice(2));
  initDb();

  const resolved = resolveTaskForTrace(args.id);
  if (!resolved.ok) throw new Error(errorText(resolved.error));

  const model = buildTaskTraceModel(resolved.value.id, { maxEvents: args.maxEvents });
  if (!model.ok) throw new Error(errorText(model.error));

  if (args.json) {
    process.stdout.write(JSON.stringify(model.value, null, 2) + "\n");
  } else {
    const markdown = renderTaskTraceMarkdown(model.value, { maxBytes: args.maxBytes });
    if (args.out) {
      writeFileSync(args.out, markdown, "utf8");
      process.stdout.write(`wrote ${args.out}\n`);
    } else {
      process.stdout.write(markdown);
    }
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`task trace error: ${message}\n\n${usage()}\n`);
  process.exit(2);
}
