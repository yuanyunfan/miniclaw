#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

interface Finding {
  path: string;
  reason: string;
}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(repoRoot);

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function extractSchemaVersion(source: string, path: string, pattern: RegExp): number {
  const match = pattern.exec(source);
  if (!match?.[1]) {
    throw new Error(`cannot find schema version in ${path}`);
  }
  return Number(match[1]);
}

const findings: Finding[] = [];
const dbSource = readText("src/store/db.ts");
const architecture = readText("docs/architecture.md");

const codeSchemaVersion = extractSchemaVersion(
  dbSource,
  "src/store/db.ts",
  /export const SCHEMA_VERSION\s*=\s*(\d+)/
);
const docsSchemaVersion = extractSchemaVersion(
  architecture,
  "docs/architecture.md",
  /SCHEMA_VERSION\s*=\s*(\d+)/
);

if (codeSchemaVersion !== docsSchemaVersion) {
  findings.push({
    path: "docs/architecture.md",
    reason: `DB schema version drift: docs=${docsSchemaVersion}, code=${codeSchemaVersion}`,
  });
}

for (const field of [
  "TEXT reason",
  "TEXT matched_signals",
  "TEXT risk_flags",
  "TEXT capabilities_json",
  "INTEGER classifier_elapsed_ms",
  "TEXT classifier_error_type",
  "TEXT classifier_error_message",
  "TEXT user_choice",
  "TEXT final_route",
  "TEXT task_final_status",
  "TEXT correction_type",
  "TEXT correction_note",
  "TEXT resolved_at",
]) {
  if (!architecture.includes(field)) {
    findings.push({
      path: "docs/architecture.md",
      reason: `smart_router_decisions ER diagram is missing ${field}`,
    });
  }
}

const docsIndex = readText("docs/README.md");
const featureDocs = readdirSync("docs/features")
  .filter((file) => file.endsWith(".md"))
  .sort();

for (const file of featureDocs) {
  const ref = `features/${file}`;
  if (!docsIndex.includes(ref)) {
    findings.push({
      path: "docs/README.md",
      reason: `missing docs/features index entry for ${ref}`,
    });
  }
}

if (findings.length) {
  console.error("D1 docs drift check failed:");
  for (const finding of findings) {
    console.error(`- ${finding.path}: ${finding.reason}`);
  }
  process.exit(1);
}

console.log(`D1 docs drift check passed (${featureDocs.length} feature doc(s), schema v${codeSchemaVersion}).`);
