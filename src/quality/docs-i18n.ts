import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  frontmatterString,
  headingLevelShape,
  parseFrontmatter,
} from "./frontmatter.js";

export type DocsI18nSeverity = "error" | "warning";

export interface DocsI18nFinding {
  severity: DocsI18nSeverity;
  path: string;
  reason: string;
}

export interface DocumentationMigrationEntry {
  doc_id: string;
  source_path: string;
  target_path?: string | null;
  zh_path?: string;
  category: string;
  status: "keep" | "move" | "merge" | "archive" | "private" | "website-source";
  merge_group?: string | null;
  website_exposure: "public" | "internal" | "history" | "private" | "none";
  translation_required: boolean;
  translation_status: "current" | "pending" | "not_required";
}

export interface DocsI18nInput {
  entries: DocumentationMigrationEntry[];
  exists: (path: string) => boolean;
  readText: (path: string) => string;
  ignoredPaths?: Set<string>;
  diffDisabledPaths?: Set<string>;
  trackedSourcePaths?: string[];
  trackedChinesePaths?: string[];
}

function finding(
  severity: DocsI18nSeverity,
  path: string,
  reason: string,
): DocsI18nFinding {
  return { severity, path, reason };
}

export function parseDocumentationMigrationMap(source: string): DocumentationMigrationEntry[] {
  const match = /```json\s*\n([\s\S]*?)\n```/.exec(source);
  if (!match?.[1]) return [];
  const parsed = JSON.parse(match[1]) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("documentation migration map JSON block must contain an array");
  }
  return parsed as DocumentationMigrationEntry[];
}

function validateEntryShape(entry: DocumentationMigrationEntry, index: number): DocsI18nFinding[] {
  const path = entry.source_path || `entry[${index}]`;
  const findings: DocsI18nFinding[] = [];
  if (!entry.doc_id) findings.push(finding("error", path, "missing doc_id"));
  if (!entry.source_path) findings.push(finding("error", path, "missing source_path"));
  if (!entry.category) findings.push(finding("error", path, "missing category"));
  if (!entry.status) findings.push(finding("error", path, "missing status"));
  if (!entry.website_exposure) findings.push(finding("error", path, "missing website_exposure"));
  if (entry.translation_required && !entry.zh_path) {
    findings.push(finding("error", path, "translation_required is true but zh_path is missing"));
  }
  if (entry.translation_required && entry.translation_status === "pending") {
    findings.push(
      finding(
        "error",
        path,
        "translation_status pending is not allowed for translation_required docs",
      ),
    );
  }
  return findings;
}

export function documentationSourceHash(source: string): string {
  return createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
}

function stripFrontmatter(source: string): string {
  return parseFrontmatter(source).body;
}

function stripFencedCode(source: string): string {
  const lines = source.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return "";
      }
      if (inFence) return "";
      return line;
    })
    .join("\n");
}

function proseText(source: string): string {
  return stripFencedCode(stripFrontmatter(source));
}

function cjkProseCharacterCount(source: string): number {
  return source.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
}

function containsCjkOrFullwidthPunctuation(source: string): boolean {
  return /[\u4e00-\u9fff\u3000-\u303f\uff01-\uff5e]/.test(source);
}

function hasSubstantialChineseProse(source: string): boolean {
  const trimmed = source.trim();
  const cjkCount = cjkProseCharacterCount(trimmed);
  if (cjkCount === 0) return false;
  if (trimmed.length < 120) return true;
  return cjkCount >= 20;
}

function validateEnglishSourceLanguage(
  entry: DocumentationMigrationEntry,
  input: DocsI18nInput,
): DocsI18nFinding[] {
  if (!entry.translation_required || entry.status === "private" || !input.exists(entry.source_path)) {
    return [];
  }
  const source = proseText(input.readText(entry.source_path));
  if (!containsCjkOrFullwidthPunctuation(source)) return [];
  return [
    finding(
      "error",
      entry.source_path,
      "canonical English documentation contains CJK text or fullwidth punctuation outside fenced code blocks",
    ),
  ];
}

function validateChinesePair(
  entry: DocumentationMigrationEntry,
  input: DocsI18nInput,
): DocsI18nFinding[] {
  const findings: DocsI18nFinding[] = [];
  if (!entry.translation_required || entry.translation_status === "not_required") return findings;

  const zhPath = entry.zh_path;
  if (!zhPath) return findings;
  if (!input.exists(zhPath)) {
    findings.push(
      finding(
        "error",
        zhPath,
        `missing Chinese documentation pair for ${entry.source_path}`,
      ),
    );
    return findings;
  }

  if (input.ignoredPaths?.has(zhPath)) {
    findings.push(finding("error", zhPath, "Chinese documentation path is ignored by git"));
  }
  if (input.diffDisabledPaths?.has(zhPath)) {
    findings.push(finding("error", zhPath, "Chinese documentation path disables text diff through gitattributes"));
  }

  const zh = parseFrontmatter(input.readText(zhPath));
  if (!zh.hasFrontmatter) {
    findings.push(finding("error", zhPath, "Chinese documentation is missing frontmatter"));
    return findings;
  }

  const lang = frontmatterString(zh.data, "lang");
  const translationOf = frontmatterString(zh.data, "translation_of");
  const docId = frontmatterString(zh.data, "doc_id");
  const sourceHash = frontmatterString(zh.data, "source_sha256");

  if (lang !== "zh") findings.push(finding("error", zhPath, "frontmatter lang must be zh"));
  if (translationOf !== entry.source_path) {
    findings.push(
      finding("error", zhPath, `translation_of must be ${entry.source_path}`),
    );
  }
  if (docId !== entry.doc_id) {
    findings.push(finding("error", zhPath, `doc_id must be ${entry.doc_id}`));
  }

  if (!hasSubstantialChineseProse(proseText(input.readText(zhPath)))) {
    findings.push(finding("error", zhPath, "Chinese documentation does not contain enough Chinese prose outside fenced code blocks"));
  }

  if (entry.translation_status === "current" && input.exists(entry.source_path)) {
    const sourceText = input.readText(entry.source_path);
    const sourceShape = headingLevelShape(sourceText);
    const zhShape = headingLevelShape(input.readText(zhPath));
    if (sourceShape !== zhShape) {
      findings.push(
        finding("error", zhPath, `heading level shape differs from ${entry.source_path}`),
      );
    }
    const expectedHash = documentationSourceHash(sourceText);
    if (sourceHash !== expectedHash) {
      findings.push(
        finding("error", zhPath, `source_sha256 must be ${expectedHash}`),
      );
    }
  }

  return findings;
}

export function analyzeDocsI18n(input: DocsI18nInput): DocsI18nFinding[] {
  const findings: DocsI18nFinding[] = [];
  if (!input.entries.length) {
    findings.push(
      finding("error", "docs/documentation-migration-map.md", "no migration map entries found"),
    );
    return findings;
  }

  const seenSourcePaths = new Set<string>();
  for (const [index, entry] of input.entries.entries()) {
    findings.push(...validateEntryShape(entry, index));
    if (entry.source_path) {
      if (seenSourcePaths.has(entry.source_path)) {
        findings.push(finding("error", entry.source_path, "duplicate source_path in migration map"));
      }
      seenSourcePaths.add(entry.source_path);
      if (entry.status !== "private" && !input.exists(entry.source_path)) {
        findings.push(finding("error", entry.source_path, "source_path does not exist"));
      }
    }
    findings.push(...validateEnglishSourceLanguage(entry, input));
    findings.push(...validateChinesePair(entry, input));
  }

  for (const path of input.trackedSourcePaths ?? []) {
    if (!seenSourcePaths.has(path)) {
      findings.push(finding("error", path, "tracked source doc is missing from documentation migration map"));
    }
  }

  const seenChinesePaths = new Set(
    input.entries
      .map((entry) => entry.zh_path)
      .filter((path): path is string => Boolean(path)),
  );
  for (const path of input.trackedChinesePaths ?? []) {
    if (!seenChinesePaths.has(path)) {
      findings.push(finding("error", path, "tracked Chinese doc is not paired in documentation migration map"));
    }
  }

  return findings;
}

export function analyzeDocsI18nFromRepo(repoRoot: string, ignoredPaths: Set<string>): DocsI18nFinding[] {
  const mapPath = "docs/documentation-migration-map.md";
  const mapFullPath = join(repoRoot, mapPath);
  if (!existsSync(mapFullPath)) {
    return [finding("error", mapPath, "documentation migration map does not exist")];
  }

  const entries = parseDocumentationMigrationMap(readFileSync(mapFullPath, "utf8"));
  return analyzeDocsI18n({
    entries,
    ignoredPaths,
    diffDisabledPaths: new Set(),
    exists: (path) => existsSync(join(repoRoot, path)),
    readText: (path) => readFileSync(join(repoRoot, path), "utf8"),
  });
}
