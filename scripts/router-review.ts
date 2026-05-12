#!/usr/bin/env tsx
import { initDb, listSmartRouterReviewRows } from "../src/store/db.js";
import { renderSmartRouterReview, summarizeSmartRouterReview } from "../src/routing/router-review.js";

interface Args {
  days: number;
  since?: string;
  until?: string;
  channelId?: string;
  limit: number;
  format: "text" | "json";
}

function usage(): string {
  return [
    "Usage: pnpm run router:review -- [--days 7] [--since ISO] [--until ISO] [--channel CHANNEL_ID] [--limit 200] [--json]",
    "",
    "Outputs aggregate Smart Router quality fields without full prompt text.",
  ].join("\n");
}

function valueAfter(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function parsePositiveInt(raw: string, name: string, max: number): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return Math.min(value, max);
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function parseArgs(argv: string[]): Args {
  const args: Args = { days: 7, limit: 200, format: "text" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === "--json") {
      args.format = "json";
      continue;
    }
    if (arg === "--days") {
      args.days = parsePositiveInt(valueAfter(argv, i, "--days"), "--days", 90);
      i += 1;
      continue;
    }
    if (arg.startsWith("--days=")) {
      args.days = parsePositiveInt(arg.slice("--days=".length), "--days", 90);
      continue;
    }
    if (arg === "--limit") {
      args.limit = parsePositiveInt(valueAfter(argv, i, "--limit"), "--limit", 1000);
      i += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      args.limit = parsePositiveInt(arg.slice("--limit=".length), "--limit", 1000);
      continue;
    }
    if (arg === "--since") {
      args.since = valueAfter(argv, i, "--since");
      i += 1;
      continue;
    }
    if (arg.startsWith("--since=")) {
      args.since = arg.slice("--since=".length);
      continue;
    }
    if (arg === "--until") {
      args.until = valueAfter(argv, i, "--until");
      i += 1;
      continue;
    }
    if (arg.startsWith("--until=")) {
      args.until = arg.slice("--until=".length);
      continue;
    }
    if (arg === "--channel") {
      args.channelId = valueAfter(argv, i, "--channel");
      i += 1;
      continue;
    }
    if (arg.startsWith("--channel=")) {
      args.channelId = arg.slice("--channel=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const since = args.since ?? daysAgoIso(args.days);
  initDb();
  const rows = listSmartRouterReviewRows({
    since,
    until: args.until,
    channelId: args.channelId,
    limit: args.limit,
  });
  const summary = summarizeSmartRouterReview(rows, {
    since,
    until: args.until,
    channelId: args.channelId,
  });

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(renderSmartRouterReview(summary));
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`router review error: ${message}\n\n${usage()}\n`);
  process.exit(2);
}
