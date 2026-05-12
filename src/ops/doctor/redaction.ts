export function redactSensitive(input: string): string {
  return input
    .replace(/(authorization|cookie|password|passwd|pass|token|secret|api[_-]?key|session)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_./+=-]{12,}\b/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_./+=-]{48,}\b/g, "[redacted]");
}

export function cleanText(value: unknown, max: number): string {
  const text = redactSensitive(String(value ?? ""));
  return text.length > max ? text.slice(0, max) + "\n... (truncated)" : text;
}

export function nullableCleanText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return cleanText(value, max);
}

export function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

export function nullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
