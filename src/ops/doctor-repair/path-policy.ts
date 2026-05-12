export interface RepairPathPolicy {
  allowedPaths: readonly string[];
  blockedPaths: readonly string[];
}

export function parseChangedFiles(status: string): string[] {
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const raw = line.slice(3).trim();
      return raw.includes(" -> ") ? raw.split(" -> ").pop()!.trim() : raw;
    });
}

function normalizeGlobPath(value: string): string {
  return value.replace(/^~\//, "").replace(/^\.\//, "");
}

function escapeRegexChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeGlobPath(pattern);
  let out = "^";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    const afterNext = normalized[i + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      out += "(?:.*/)?";
      i += 2;
    } else if (char === "*" && next === "*") {
      out += ".*";
      i += 1;
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += escapeRegexChar(char);
    }
  }
  out += "$";
  return new RegExp(out);
}

function matchesPattern(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(normalizeGlobPath(path));
}

export function validateChangedPaths(paths: readonly string[], policy: RepairPathPolicy): string[] {
  const violations: string[] = [];
  for (const path of paths) {
    if (policy.blockedPaths.some((pattern) => matchesPattern(pattern, path))) {
      violations.push(`${path}: blocked path`);
      continue;
    }
    if (!policy.allowedPaths.some((pattern) => matchesPattern(pattern, path))) {
      violations.push(`${path}: not in allowed_paths`);
    }
  }
  return violations;
}
