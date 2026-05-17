#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import {
  analyzeWebsiteDocsFromRepo,
  WEBSITE_DOCS_DRIFT_ACK_PATH,
} from "../src/quality/website-docs.js";

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
  ]))
    .filter((path) => !isChineseMirrorMetadataOnlyChange(path))
    .sort();
}

function isChineseMirrorMetadataOnlyChange(path: string): boolean {
  if (!path.startsWith("docs/zh/") || !path.endsWith(".md")) return false;
  try {
    const diff = execFileSync("git", ["diff", "HEAD", "--unified=0", "--", path], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    if (!diff.trim()) return false;
    const changedLines = diff
      .split("\n")
      .filter((line) => /^[+-]/.test(line))
      .filter((line) => !line.startsWith("+++") && !line.startsWith("---"));
    return changedLines.length > 0 &&
      changedLines.every((line) => /^[+-]source_sha256: /.test(line) || /^[+-]$/.test(line));
  } catch {
    return false;
  }
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

if (result.tracePages.length) {
  console.warn("Website docs trace-only source changes (not blocking):");
  for (const traced of result.tracePages) {
    console.warn(`- ${traced.page}: ${traced.source}`);
  }
  console.warn(`Use ${WEBSITE_DOCS_DRIFT_ACK_PATH} only for blocking source_docs changes that are publicly unaffected.`);
}

if (result.findings.length) {
  console.error("Website docs check failed:");
  for (const finding of result.findings) {
    console.error(`- ${finding.path}: ${finding.reason}`);
  }
  process.exit(1);
}

console.log(
  `Website docs check passed (${pagePaths.length} page(s), ${result.affectedPages.length} affected page(s), ${result.tracePages.length} trace-only source change(s)).`,
);
