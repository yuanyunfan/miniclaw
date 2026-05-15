#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { evaluateDocsDrift, type DocsDriftFinding } from "../src/quality/docs-drift.js";

interface Finding {
  path: string;
  reason: string;
}

interface ChangedPathSelection {
  mode: string;
  paths: string[];
}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(repoRoot);

const args = process.argv.slice(2);
const DIFF_FILTER = "ACMR";

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function gitBuffer(command: string[]): Buffer {
  return execFileSync("git", command, { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 });
}

function splitZero(buffer: Buffer): string[] {
  return Array.from(new Set(buffer.toString("utf8").split("\0").filter(Boolean))).sort();
}

function gitPathList(command: string[]): string[] {
  return splitZero(gitBuffer(command));
}

function argValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function hasArg(name: string): boolean {
  return args.includes(name);
}

function stagedChangedPaths(): string[] {
  return gitPathList(["diff", "--cached", "--name-only", "-z", `--diff-filter=${DIFF_FILTER}`]);
}

function treeChangedPaths(): string[] {
  return Array.from(new Set([
    ...gitPathList(["diff", "--name-only", "-z", `--diff-filter=${DIFF_FILTER}`, "HEAD"]),
    ...gitPathList(["ls-files", "--others", "--exclude-standard", "-z"]),
  ])).sort();
}

function rangeChangedPaths(base: string, head: string): string[] {
  return gitPathList(["diff", "--name-only", "-z", `--diff-filter=${DIFF_FILTER}`, `${base}...${head}`]);
}

function getChangedPaths(): ChangedPathSelection {
  const base = argValue("--base") ?? process.env.MINICLAW_DOCS_DRIFT_BASE;
  const head = argValue("--head") ?? process.env.MINICLAW_DOCS_DRIFT_HEAD ?? "HEAD";
  if (base) {
    return { mode: `range(${base}...${head})`, paths: rangeChangedPaths(base, head) };
  }
  if (hasArg("--staged")) {
    return { mode: "staged", paths: stagedChangedPaths() };
  }
  if (hasArg("--tree")) {
    return { mode: "tree", paths: treeChangedPaths() };
  }

  const staged = stagedChangedPaths();
  if (staged.length) {
    return { mode: "staged(auto)", paths: staged };
  }
  return { mode: "tree(auto)", paths: treeChangedPaths() };
}

function extractSchemaVersion(source: string, path: string, pattern: RegExp): number {
  const match = pattern.exec(source);
  if (!match?.[1]) {
    throw new Error(`cannot find schema version in ${path}`);
  }
  return Number(match[1]);
}

const findings: Finding[] = [];
const dbSource = readText("src/store/schema.ts");
const architecture = readText("docs/architecture.md");

const codeSchemaVersion = extractSchemaVersion(
  dbSource,
  "src/store/schema.ts",
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

function markdownFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = `${dir}/${entry}`;
      const stat = statSync(path);
      if (stat.isDirectory()) return markdownFiles(path);
      return entry.endsWith(".md") ? [path] : [];
    })
    .sort();
}

const indexedSourceDocs = [
  ...markdownFiles("docs/features"),
  ...markdownFiles("docs/runtime"),
  ...markdownFiles("docs/providers"),
  ...markdownFiles("docs/experiments"),
];

for (const path of indexedSourceDocs) {
  const ref = path.replace(/^docs\//, "");
  if (!docsIndex.includes(ref)) {
    findings.push({
      path: "docs/README.md",
      reason: `missing docs source index entry for ${ref}`,
    });
  }
}

const changedPathSelection = getChangedPaths();
const docsDriftEvaluation = evaluateDocsDrift(changedPathSelection.paths);
const docsDriftFindings = docsDriftEvaluation.findings;
const docsDriftBypass = process.env.MINICLAW_DOCS_DRIFT_ALLOW === "1";

function printDocsDriftFinding(finding: DocsDriftFinding): void {
  console.error(`- ${finding.requirement.id}: ${finding.requirement.reason}`);
  console.error(`  changed source: ${finding.sourcePaths.join(", ")}`);
  if (finding.missingAnyOf.length) {
    console.error(`  expected one of: ${finding.missingAnyOf.join(", ")}`);
  }
  if (finding.missingAllOf.length) {
    console.error(`  also expected: ${finding.missingAllOf.join(", ")}`);
  }
}

if (findings.length || (docsDriftFindings.length && !docsDriftBypass)) {
  console.error("D1 docs drift check failed:");
  for (const finding of findings) {
    console.error(`- ${finding.path}: ${finding.reason}`);
  }
  if (docsDriftFindings.length && !docsDriftBypass) {
    console.error(`Changed-path docs drift (${changedPathSelection.mode}):`);
    for (const finding of docsDriftFindings) {
      printDocsDriftFinding(finding);
    }
    console.error("To bypass only the changed-path mapping for an emergency local hotfix:");
    console.error("  MINICLAW_DOCS_DRIFT_ALLOW=1 pnpm run quality:docs");
  }
  process.exit(1);
}

if (docsDriftFindings.length && docsDriftBypass) {
  console.warn(`D1 changed-path docs drift bypassed by MINICLAW_DOCS_DRIFT_ALLOW=1 (${changedPathSelection.mode}).`);
  for (const finding of docsDriftFindings) {
    printDocsDriftFinding(finding);
  }
}

console.log(
  `D1 docs drift check passed (${indexedSourceDocs.length} indexed source doc(s), schema v${codeSchemaVersion}, ` +
  `${changedPathSelection.paths.length} changed path(s), ${docsDriftEvaluation.matchedRequirements.length} mapped rule(s), ` +
  `mode=${changedPathSelection.mode}).`
);
