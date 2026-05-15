#!/usr/bin/env tsx
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  analyzeDocsI18n,
  parseDocumentationMigrationMap,
} from "../src/quality/docs-i18n.js";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(repoRoot);

const strict = process.argv.includes("--strict") || process.env.MINICLAW_DOCS_I18N_STRICT === "1";
const mapPath = "docs/documentation-migration-map.md";
const entries = parseDocumentationMigrationMap(readFileSync(mapPath, "utf8"));

function ignoredByGit(path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", "--", path], { cwd: repoRoot });
  return result.status === 0;
}

function diffDisabledByGit(path: string): boolean {
  const result = execFileSync("git", ["check-attr", "diff", "--", path], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result.includes(": diff: unset");
}

function trackedSourceDocs(): string[] {
  const output = execFileSync("git", ["ls-files", "docs/*.md", "docs/**/*.md"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return Array.from(new Set(output.split("\n").filter(Boolean)))
    .filter((path) => !path.startsWith("docs/zh/"))
    .sort();
}

function trackedChineseDocs(): string[] {
  const output = execFileSync("git", ["ls-files", "docs/zh/*.md", "docs/zh/**/*.md"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return Array.from(new Set(output.split("\n").filter(Boolean)))
    .filter((path) => existsSync(path))
    .sort();
}

const ignoredPaths = new Set(
  entries
    .map((entry) => entry.zh_path)
    .filter((path): path is string => Boolean(path))
    .filter(ignoredByGit),
);
const diffDisabledPaths = new Set(
  entries
    .map((entry) => entry.zh_path)
    .filter((path): path is string => Boolean(path))
    .filter(diffDisabledByGit),
);

const findings = analyzeDocsI18n({
  entries,
  ignoredPaths,
  diffDisabledPaths,
  trackedSourcePaths: trackedSourceDocs(),
  trackedChinesePaths: trackedChineseDocs(),
  exists: (path) => {
    try {
      execFileSync("test", ["-e", path], { cwd: repoRoot });
      return true;
    } catch {
      return false;
    }
  },
  readText: (path) => readFileSync(path, "utf8"),
});

const errors = findings.filter((finding) => finding.severity === "error");
const warnings = findings.filter((finding) => finding.severity === "warning");

if (findings.length) {
  console.error("Docs i18n check findings:");
  for (const finding of findings) {
    console.error(`- ${finding.severity.toUpperCase()} ${finding.path}: ${finding.reason}`);
  }
}

if (errors.length || (strict && warnings.length)) {
  console.error("Docs i18n check failed.");
  process.exit(1);
}

const suffix = warnings.length ? `, ${warnings.length} warning(s)` : "";
console.log(`Docs i18n check passed (${entries.length} migration map entry(s)${suffix}).`);
