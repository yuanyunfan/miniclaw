#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { analyzeWebsiteDocsFromRepo } from "../src/quality/website-docs.js";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(repoRoot);

function gitBuffer(args: string[]): Buffer {
  return execFileSync("git", args, { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 });
}

function splitZero(buffer: Buffer): string[] {
  return Array.from(new Set(buffer.toString("utf8").split("\0").filter(Boolean))).sort();
}

function trackedAndUntrackedWebsitePages(): string[] {
  return splitZero(gitBuffer(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "website"]))
    .filter((path) => path.endsWith(".md") || path.endsWith(".mdx"));
}

function changedPaths(): string[] {
  return Array.from(new Set([
    ...splitZero(gitBuffer(["diff", "--name-only", "-z", "--diff-filter=ACMR", "HEAD"])),
    ...splitZero(gitBuffer(["ls-files", "--others", "--exclude-standard", "-z"])),
  ])).sort();
}

const pagePaths = trackedAndUntrackedWebsitePages();
if (!pagePaths.length) {
  console.log("Website docs check skipped (no website Markdown/MDX pages).");
  process.exit(0);
}

const allowAffectedPages = process.env.MINICLAW_WEBSITE_DOCS_DRIFT_ALLOW === "1";
const result = analyzeWebsiteDocsFromRepo(repoRoot, pagePaths, changedPaths(), allowAffectedPages);

if (result.affectedPages.length) {
  console.warn("Website docs affected by canonical docs changes:");
  for (const affected of result.affectedPages) {
    console.warn(`- ${affected.page}: ${affected.source}`);
  }
}

if (result.findings.length) {
  console.error("Website docs check failed:");
  for (const finding of result.findings) {
    console.error(`- ${finding.path}: ${finding.reason}`);
  }
  process.exit(1);
}

console.log(
  `Website docs check passed (${pagePaths.length} page(s), ${result.affectedPages.length} affected page(s)).`,
);
