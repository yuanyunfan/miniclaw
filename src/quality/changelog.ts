import { matchesPathPattern, normalizePath } from "./docs-drift.js";

export interface ChangelogFinding {
  path: string;
  reason: string;
}

const CHANGELOG_PATH = "CHANGELOG.md";

const CHANGELOG_TRIGGER_PATTERNS = [
  ".github/workflows/**",
  "agents/**",
  "config.example.yaml",
  "docs/**",
  "package.json",
  "prompts/**",
  "README.md",
  "README.en.md",
  "scripts/**",
  "src/**",
  "website/**",
] as const;

const CHANGELOG_IGNORED_PATTERNS = [
  CHANGELOG_PATH,
  "coverage/**",
  "docs/archive/**",
  "docs/private/**",
  "src/**/__fixtures__/**",
  "**/__tests__/**",
  "**/*.test.ts",
  "**/*.spec.ts",
  "website-dist/**",
] as const;

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPathPattern(path, pattern));
}

function isChangelogTrigger(path: string): boolean {
  const normalized = normalizePath(path);
  if (matchesAny(normalized, CHANGELOG_IGNORED_PATTERNS)) return false;
  return matchesAny(normalized, CHANGELOG_TRIGGER_PATTERNS);
}

export function analyzeChangelogDrift(changedPaths: string[]): ChangelogFinding[] {
  const normalized = Array.from(new Set(changedPaths.map(normalizePath))).sort();
  const triggerPaths = normalized.filter(isChangelogTrigger);
  if (!triggerPaths.length || normalized.includes(CHANGELOG_PATH)) return [];

  return [
    {
      path: CHANGELOG_PATH,
      reason: `CHANGELOG.md must be updated with release-visible changes: ${triggerPaths.join(", ")}`,
    },
  ];
}
