export interface DocsDriftRequirement {
  id: string;
  sourcePatterns: string[];
  excludePatterns?: string[];
  requiredAnyOf: string[];
  requiredAllOf?: string[];
  reason: string;
}

export interface MatchedDocsDriftRequirement {
  requirement: DocsDriftRequirement;
  sourcePaths: string[];
}

export interface DocsDriftFinding extends MatchedDocsDriftRequirement {
  missingAnyOf: string[];
  missingAllOf: string[];
}

export const DOCS_DRIFT_IGNORED_PATTERNS = [
  "docs/plans/**",
  "docs/archive/**",
  "docs/private/**",
  "**/__tests__/**",
  "**/*.test.ts",
  "**/*.spec.ts",
  "src/**/__fixtures__/**",
] as const;

const RUNTIME_DOCS = ["docs/runtime/*.md", "docs/features/*.md"];
const PROVIDER_DOCS = ["docs/providers/*.md", "docs/providers/**/*.md", "docs/features/*.md"];
const EXPERIMENT_DOCS = ["docs/experiments/*.md", "docs/features/*.md"];

export const DOCS_DRIFT_REQUIREMENTS: DocsDriftRequirement[] = [
  {
    id: "discord-routing",
    sourcePatterns: ["src/bot.ts", "src/commands/**", "src/discord/**", "src/routing/**"],
    requiredAnyOf: ["docs/bot-routing.md", "docs/chat-router-current-logic.md", ...RUNTIME_DOCS],
    reason: "Discord gateway, command, routing, or Smart Router behavior changed",
  },
  {
    id: "agent-runtime",
    sourcePatterns: ["src/agent/**"],
    excludePatterns: ["src/agent/prompts.ts"],
    requiredAnyOf: ["docs/architecture.md", "docs/features/03-discord-task-output.md", ...RUNTIME_DOCS],
    reason: "Agent runtime or task execution behavior changed",
  },
  {
    id: "cron-runtime",
    sourcePatterns: ["src/cron/**", "scripts/cron-*"],
    requiredAnyOf: ["docs/architecture.md", ...RUNTIME_DOCS, ...PROVIDER_DOCS],
    reason: "Cron scheduler, runner, or cron helper behavior changed",
  },
  {
    id: "store-schema",
    sourcePatterns: ["src/store/db.ts", "src/store/**"],
    requiredAnyOf: ["docs/architecture.md"],
    reason: "Persistent store or schema behavior changed",
  },
  {
    id: "providers",
    sourcePatterns: ["src/providers/**"],
    requiredAnyOf: ["docs/architecture.md", ...PROVIDER_DOCS],
    reason: "Provider behavior or provider contract changed",
  },
  {
    id: "config",
    sourcePatterns: ["src/config.ts", "src/config/**", "config.example.yaml"],
    requiredAnyOf: ["docs/architecture.md", ...RUNTIME_DOCS, ...PROVIDER_DOCS],
    reason: "Configuration schema, default, or example changed",
  },
  {
    id: "prompts",
    sourcePatterns: ["prompts/**", "src/agent/prompts.ts"],
    requiredAnyOf: ["docs/prompts.md"],
    requiredAllOf: ["src/__tests__/prompt-snapshot.test.ts"],
    reason: "Framework prompt asset or prompt loader changed",
  },
  {
    id: "quality-gates",
    sourcePatterns: ["scripts/quality-*", "src/quality/**", ".github/workflows/**", "scripts/git-hooks/**"],
    requiredAnyOf: ["docs/quality-gates.md"],
    reason: "Quality gate script, hook, or CI workflow changed",
  },
  {
    id: "auto-doctor",
    sourcePatterns: ["src/ops/doctor*", "scripts/doctor*"],
    requiredAnyOf: ["docs/features/13-auto-doctor.md", "docs/runtime/*.md"],
    reason: "Auto Doctor runtime or shipping behavior changed",
  },
  {
    id: "stage",
    sourcePatterns: ["src/stage/**"],
    requiredAnyOf: ["docs/features/01-stage.md", ...EXPERIMENT_DOCS],
    reason: "Stage behavior changed",
  },
];

function uniqueSorted(paths: string[]): string[] {
  return Array.from(new Set(paths.map(normalizePath))).sort();
}

function regexEscapeChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    source += regexEscapeChar(char);
  }
  return new RegExp(`^${source}$`);
}

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

export function matchesPathPattern(path: string, pattern: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedPattern = normalizePath(pattern);
  if (!normalizedPattern.includes("*")) return normalizedPath === normalizedPattern;
  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function matchesAnyPattern(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPathPattern(path, pattern));
}

export function isIgnoredChangedPath(path: string): boolean {
  return matchesAnyPattern(path, DOCS_DRIFT_IGNORED_PATTERNS);
}

function sourcePathsForRequirement(
  changedPaths: string[],
  requirement: DocsDriftRequirement,
): string[] {
  return changedPaths.filter((path) => {
    if (isIgnoredChangedPath(path)) return false;
    if (requirement.excludePatterns && matchesAnyPattern(path, requirement.excludePatterns)) return false;
    return matchesAnyPattern(path, requirement.sourcePatterns);
  });
}

export function matchDocRequirements(
  changedPaths: string[],
  requirements: DocsDriftRequirement[] = DOCS_DRIFT_REQUIREMENTS,
): MatchedDocsDriftRequirement[] {
  const normalized = uniqueSorted(changedPaths);
  return requirements
    .map((requirement) => ({
      requirement,
      sourcePaths: sourcePathsForRequirement(normalized, requirement),
    }))
    .filter((match) => match.sourcePaths.length > 0);
}

function changedPathMatchesAny(changedPaths: string[], patterns: string[]): boolean {
  return changedPaths.some((path) => matchesAnyPattern(path, patterns));
}

export function hasRequiredDocChange(
  requirement: DocsDriftRequirement,
  changedPaths: string[],
): boolean {
  const normalized = uniqueSorted(changedPaths);
  const hasAnyOf =
    requirement.requiredAnyOf.length === 0 || changedPathMatchesAny(normalized, requirement.requiredAnyOf);
  const hasAllOf = (requirement.requiredAllOf ?? []).every((path) =>
    changedPathMatchesAny(normalized, [path])
  );
  return hasAnyOf && hasAllOf;
}

export function findDocsDriftFindings(
  changedPaths: string[],
  requirements: DocsDriftRequirement[] = DOCS_DRIFT_REQUIREMENTS,
): DocsDriftFinding[] {
  const normalized = uniqueSorted(changedPaths);
  return matchDocRequirements(normalized, requirements)
    .map((match) => {
      const missingAnyOf = changedPathMatchesAny(normalized, match.requirement.requiredAnyOf)
        ? []
        : match.requirement.requiredAnyOf;
      const missingAllOf = (match.requirement.requiredAllOf ?? []).filter(
        (path) => !changedPathMatchesAny(normalized, [path]),
      );
      return {
        ...match,
        missingAnyOf,
        missingAllOf,
      };
    })
    .filter((finding) => finding.missingAnyOf.length > 0 || finding.missingAllOf.length > 0);
}

export function evaluateDocsDrift(changedPaths: string[]): {
  matchedRequirements: MatchedDocsDriftRequirement[];
  findings: DocsDriftFinding[];
} {
  return {
    matchedRequirements: matchDocRequirements(changedPaths),
    findings: findDocsDriftFindings(changedPaths),
  };
}
