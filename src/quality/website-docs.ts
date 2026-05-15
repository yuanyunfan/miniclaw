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

export interface WebsiteDocsInput {
  pages: WebsiteDocsPage[];
  sourceExists: (path: string) => boolean;
  changedPaths?: string[];
  allowAffectedPages?: boolean;
}

export interface WebsiteDocsResult {
  findings: WebsiteDocsFinding[];
  affectedPages: Array<{ page: string; source: string }>;
}

function finding(path: string, reason: string): WebsiteDocsFinding {
  return { path, reason };
}

function sourceDocsForPage(page: WebsiteDocsPage): string[] {
  const parsed = parseFrontmatter(page.text);
  if (!parsed.hasFrontmatter) return [];

  const nested = frontmatterStringRecord(parsed.data, "source_docs");
  const flat = frontmatterStringList(parsed.data, "source_docs");
  return [...flat, ...Object.values(nested).flat()];
}

function affectedSourceDocsForPage(page: WebsiteDocsPage): string[] {
  const parsed = parseFrontmatter(page.text);
  if (!parsed.hasFrontmatter) return [];

  const lang = websiteLanguage(page.path);
  const nested = frontmatterStringRecord(parsed.data, "source_docs");
  if (lang && nested[lang]?.length) return nested[lang];

  const flat = frontmatterStringList(parsed.data, "source_docs");
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
  const sourceDocs = sourceDocsForPage(page);
  if (status !== "landing" && sourceDocs.length === 0) {
    findings.push(finding(page.path, "website page must declare source_docs unless status is landing"));
  }

  const lang = websiteLanguage(page.path);
  const nested = frontmatterStringRecord(parsed.data, "source_docs");
  if (lang && Object.keys(nested).length > 0 && !nested[lang]?.length) {
    findings.push(finding(page.path, `website ${lang} page must declare source_docs.${lang}`));
  }

  for (const source of sourceDocs) {
    if (source.startsWith("docs/private/")) {
      findings.push(finding(page.path, `source_docs must not point to private docs: ${source}`));
      continue;
    }
    if (source.startsWith("docs/archive/") && status !== "history") {
      findings.push(finding(page.path, `archive source_docs require status: history: ${source}`));
      continue;
    }
    if (!sourceExists(source)) {
      findings.push(finding(page.path, `source_docs path does not exist: ${source}`));
    }
  }

  return findings;
}

function hasUnaffectedOverride(page: WebsiteDocsPage): boolean {
  const parsed = parseFrontmatter(page.text);
  if (!parsed.hasFrontmatter) return false;
  const status = frontmatterString(parsed.data, "website_docs_drift");
  const reason = frontmatterString(parsed.data, "website_docs_drift_reason");
  return status === "unaffected" && Boolean(reason?.trim());
}

export function analyzeWebsiteDocs(input: WebsiteDocsInput): WebsiteDocsResult {
  const findings = input.pages.flatMap((page) => validatePage(page, input.sourceExists));
  const changed = new Set(input.changedPaths ?? []);
  const affectedPages = input.pages.flatMap((page) =>
    affectedSourceDocsForPage(page)
      .filter((source) => changed.has(source))
      .map((source) => ({ page: page.path, source })),
  );

  if (!input.allowAffectedPages) {
    for (const affected of affectedPages) {
      const page = input.pages.find((candidate) => candidate.path === affected.page);
      if (changed.has(affected.page) || (page && hasUnaffectedOverride(page))) continue;
      findings.push(
        finding(
          affected.page,
          `canonical source changed without website update: ${affected.source}`,
        ),
      );
    }
  }

  return { findings, affectedPages };
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
    sourceExists: (path) => existsSync(join(repoRoot, path)),
  });
}
