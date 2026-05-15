#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { analyzeChangelogDrift } from "../src/quality/changelog.js";

interface ChangedPathSelection {
  mode: string;
  paths: string[];
}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(repoRoot);

const args = process.argv.slice(2);
const DIFF_FILTER = "ACMRD";

function gitBuffer(command: string[]): Buffer {
  return execFileSync("git", command, { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 });
}

function splitZero(buffer: Buffer): string[] {
  return Array.from(new Set(buffer.toString("utf8").split("\0").filter(Boolean))).sort();
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
  return splitZero(gitBuffer(["diff", "--cached", "--name-only", "-z", `--diff-filter=${DIFF_FILTER}`]));
}

function treeChangedPaths(): string[] {
  return Array.from(new Set([
    ...splitZero(gitBuffer(["diff", "--name-only", "-z", `--diff-filter=${DIFF_FILTER}`, "HEAD"])),
    ...splitZero(gitBuffer(["ls-files", "--others", "--exclude-standard", "-z"])),
  ])).sort();
}

function rangeChangedPaths(base: string, head: string): string[] {
  return splitZero(gitBuffer(["diff", "--name-only", "-z", `--diff-filter=${DIFF_FILTER}`, `${base}...${head}`]));
}

function getChangedPaths(): ChangedPathSelection {
  const base = argValue("--base") ?? process.env.MINICLAW_CHANGELOG_BASE;
  const head = argValue("--head") ?? process.env.MINICLAW_CHANGELOG_HEAD ?? "HEAD";
  if (base) return { mode: `range(${base}...${head})`, paths: rangeChangedPaths(base, head) };
  if (hasArg("--staged")) return { mode: "staged", paths: stagedChangedPaths() };
  if (hasArg("--tree")) return { mode: "tree", paths: treeChangedPaths() };

  const staged = stagedChangedPaths();
  if (staged.length) return { mode: "staged(auto)", paths: staged };
  return { mode: "tree(auto)", paths: treeChangedPaths() };
}

const changed = getChangedPaths();
const findings = analyzeChangelogDrift(changed.paths);

if (findings.length) {
  console.error(`Changelog check failed (${changed.mode}):`);
  for (const finding of findings) {
    console.error(`- ${finding.path}: ${finding.reason}`);
  }
  process.exit(1);
}

console.log(`Changelog check passed (${changed.paths.length} changed path(s), mode=${changed.mode}).`);
