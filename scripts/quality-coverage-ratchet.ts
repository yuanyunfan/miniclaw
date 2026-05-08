#!/usr/bin/env tsx
import { readFileSync } from "node:fs";

interface MetricSummary {
  pct: number;
}

interface FileCoverageSummary {
  lines: MetricSummary;
  statements: MetricSummary;
  functions: MetricSummary;
  branches: MetricSummary;
}

type CoverageSummary = Record<string, FileCoverageSummary>;
type MetricName = keyof FileCoverageSummary;

const thresholds: Record<string, Partial<Record<MetricName, number>>> = {
  "src/store/memory-md.ts": { statements: 95, lines: 95, functions: 100, branches: 90 },
  "src/discord/chunks.ts": { statements: 95, lines: 95, functions: 100, branches: 85 },
  "src/cron/template.ts": { statements: 95, lines: 95, functions: 100, branches: 90 },
  "src/lib/markdown.ts": { statements: 95, lines: 95, functions: 100, branches: 85 },
  "src/routing/intent.ts": { statements: 80, lines: 80, functions: 100, branches: 80 },
  "src/providers/futu-stock/format.ts": { statements: 95, lines: 95, functions: 100, branches: 75 },
  "src/providers/stock-portfolio/index.ts": { statements: 90, lines: 90, functions: 100, branches: 55 },
};

const summary = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8")) as CoverageSummary;
const failures: string[] = [];

for (const [suffix, expected] of Object.entries(thresholds)) {
  const entry = Object.entries(summary).find(([path]) => path.endsWith(suffix));
  if (!entry) {
    failures.push(`${suffix}: missing from coverage summary`);
    continue;
  }
  const [, actual] = entry;
  for (const [metric, min] of Object.entries(expected) as Array<[MetricName, number]>) {
    const pct = actual[metric]?.pct;
    if (typeof pct !== "number" || pct < min) {
      failures.push(`${suffix}: ${metric} ${pct ?? "n/a"}% < ${min}%`);
    }
  }
}

if (failures.length) {
  console.error("Coverage ratchet failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Coverage ratchet passed (${Object.keys(thresholds).length} module thresholds).`);
