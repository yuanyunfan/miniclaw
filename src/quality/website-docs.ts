import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  frontmatterString,
  frontmatterStringList,
  frontmatterStringRecord,
  parseFrontmatter,
} from "./frontmatter.js";

export interface WebsiteDocsPage {
  path: string;
  text: string;
}

export interface WebsiteDocsFinding {
  path: string;
  reason: string;
}

export interface WebsiteDocsAck {
  page: string;
  source: string;
  reason: string;
}

export interface WebsiteDocsInput {
  pages: WebsiteDocsPage[];
  sourceExists: (path: string) => boolean;
  changedPaths?: string[];
  allowAffectedPages?: boolean;
  ackText?: string;
  ackPathChanged?: boolean;
}

export interface WebsiteDocsResult {
  findings: WebsiteDocsFinding[];
  affectedPages: Array<{ page: string; source: string }>;
  tracePages: Array<{ page: string; source: string }>;
}

export const WEBSITE_DOCS_DRIFT_ACK_PATH = ".website-docs-drift-ack.md";

function finding(path: string, reason: string): WebsiteDocsFinding {
  return { path, reason };
}

function sourceDocsForPage(page: WebsiteDocsPage, field: "source_docs" | "trace_docs"): string[] {
  const parsed = parseFrontmatter(page.text);
  if (!parsed.hasFrontmatter) return [];

  const nested = frontmatterStringRecord(parsed.data, field);
  const flat = frontmatterStringList(parsed.data, field);
  return [...flat, ...Object.values(nested).flat()];
}

function languageDocsForPage(page: WebsiteDocsPage, field: "source_docs" | "trace_docs"): string[] {
  const parsed = parseFrontmatter(page.text);
  if (!parsed.hasFrontmatter) return [];

  const lang = websiteLanguage(page.path);
  const nested = frontmatterStringRecord(parsed.data, field);
  if (lang && nested[lang]?.length) return nested[lang];

  const flat = frontmatterStringList(parsed.data, field);
  return [...flat, ...Object.values(nested).flat()];
}

function websiteLanguage(path: string): "en" | "zh" | undefined {
  if (path.startsWith("website/en/")) return "en";
  if (path.startsWith("website/zh/")) return "zh";
  return undefined;
}

function validatePage(page: WebsiteDocsPage, sourceExists: (path: string) => boolean): WebsiteDocsFinding[] {
  const findings: WebsiteDocsFinding[] = [];
  const parsed = parseFrontmatter(page.text);
  if (!parsed.hasFrontmatter) {
    findings.push(finding(page.path, "website page is missing frontmatter"));
    return findings;
  }

  const status = frontmatterString(parsed.data, "status");
  const sourceDocs = sourceDocsForPage(page, "source_docs");
  const traceDocs = sourceDocsForPage(page, "trace_docs");
  if (status !== "landing" && sourceDocs.length === 0 && traceDocs.length === 0) {
    findings.push(finding(page.path, "website page must declare source_docs or trace_docs unless status is landing"));
  }

  const lang = websiteLanguage(page.path);
  for (const field of ["source_docs", "trace_docs"] as const) {
    const nested = frontmatterStringRecord(parsed.data, field);
    if (lang && Object.keys(nested).length > 0 && !nested[lang]?.length) {
      findings.push(finding(page.path, `website ${lang} page must declare ${field}.${lang}`));
    }
  }

  for (const source of [...sourceDocs, ...traceDocs]) {
    if (source.startsWith("docs/private/")) {
      findings.push(finding(page.path, `website source references must not point to private docs: ${source}`));
      continue;
    }
    if (source.startsWith("docs/archive/") && status !== "history") {
      findings.push(finding(page.path, `archive website source references require status: history: ${source}`));
      continue;
    }
    if (!sourceExists(source)) {
      findings.push(finding(page.path, `website source reference path does not exist: ${source}`));
    }
  }

  return findings;
}

export function parseWebsiteDocsAck(text: string): { acks: WebsiteDocsAck[]; findings: WebsiteDocsFinding[] } {
  const acks: WebsiteDocsAck[] = [];
  const findings: WebsiteDocsFinding[] = [];

  for (const [index, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^-\s+page=(\S+)\s+source=(\S+)\s+reason=(.+)$/.exec(trimmed);
    if (!match) {
      findings.push(finding(WEBSITE_DOCS_DRIFT_ACK_PATH, `invalid ack line ${index + 1}`));
      continue;
    }
    const [, page, source, reason] = match;
    if (!reason.trim()) {
      findings.push(finding(WEBSITE_DOCS_DRIFT_ACK_PATH, `missing ack reason on line ${index + 1}`));
      continue;
    }
    acks.push({ page, source, reason: reason.trim() });
  }

  return { acks, findings };
}

function hasCentralAck(
  affected: { page: string; source: string },
  acks: WebsiteDocsAck[],
  ackPathChanged: boolean,
): boolean {
  if (!ackPathChanged) return false;
  return acks.some((ack) => ack.page === affected.page && ack.source === affected.source && ack.reason.trim());
}

export function analyzeWebsiteDocs(input: WebsiteDocsInput): WebsiteDocsResult {
  const findings = input.pages.flatMap((page) => validatePage(page, input.sourceExists));
  const ackResult = parseWebsiteDocsAck(input.ackText ?? "");
  if (input.ackPathChanged) findings.push(...ackResult.findings);
  const changed = new Set(input.changedPaths ?? []);
  const affectedPages = input.pages.flatMap((page) =>
    languageDocsForPage(page, "source_docs")
      .filter((source) => changed.has(source))
      .map((source) => ({ page: page.path, source })),
  );
  const tracePages = input.pages.flatMap((page) =>
    languageDocsForPage(page, "trace_docs")
      .filter((source) => changed.has(source))
      .map((source) => ({ page: page.path, source })),
  );

  if (!input.allowAffectedPages) {
    for (const affected of affectedPages) {
      if (
        changed.has(affected.page) ||
        hasCentralAck(affected, ackResult.acks, Boolean(input.ackPathChanged))
      ) {
        continue;
      }
      findings.push(
        finding(
          affected.page,
          `canonical source changed without website update: ${affected.source}`,
        ),
      );
    }
  }

  return { findings, affectedPages, tracePages };
}

export function analyzeWebsiteDocsFromRepo(
  repoRoot: string,
  pagePaths: string[],
  changedPaths: string[],
  allowAffectedPages = false,
): WebsiteDocsResult {
  const pages = pagePaths.map((path) => ({
    path,
    text: readFileSync(join(repoRoot, path), "utf8"),
  }));
  return analyzeWebsiteDocs({
    pages,
    changedPaths,
    allowAffectedPages,
    ackText: existsSync(join(repoRoot, WEBSITE_DOCS_DRIFT_ACK_PATH))
      ? readFileSync(join(repoRoot, WEBSITE_DOCS_DRIFT_ACK_PATH), "utf8")
      : "",
    ackPathChanged: changedPaths.includes(WEBSITE_DOCS_DRIFT_ACK_PATH),
    sourceExists: (path) => existsSync(join(repoRoot, path)),
  });
}
