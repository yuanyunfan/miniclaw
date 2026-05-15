export type FrontmatterValue = string | string[] | Record<string, string[]>;

export interface ParsedFrontmatter {
  hasFrontmatter: boolean;
  data: Record<string, FrontmatterValue>;
  body: string;
}

export interface MarkdownHeading {
  level: number;
  title: string;
}

function cleanValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseFrontmatter(source: string): ParsedFrontmatter {
  if (!source.startsWith("---\n")) {
    return { hasFrontmatter: false, data: {}, body: source };
  }

  const endIndex = source.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { hasFrontmatter: false, data: {}, body: source };
  }

  const block = source.slice(4, endIndex);
  const afterEnd = source.indexOf("\n", endIndex + 4);
  const body = afterEnd === -1 ? "" : source.slice(afterEnd + 1);
  const data: Record<string, FrontmatterValue> = {};
  let currentKey: string | undefined;
  let nestedKey: string | undefined;

  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const root = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (root) {
      const [, key, rawValue = ""] = root;
      currentKey = key;
      nestedKey = undefined;
      data[key] = rawValue ? cleanValue(rawValue) : [];
      continue;
    }

    const nested = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (nested && currentKey) {
      const [, key] = nested;
      const current = data[currentKey];
      if (!current || Array.isArray(current) || typeof current === "string") {
        data[currentKey] = {};
      }
      const record = data[currentKey] as Record<string, string[]>;
      record[key] = [];
      nestedKey = key;
      continue;
    }

    const listItem = /^  -\s+(.+)$/.exec(line);
    if (listItem && currentKey) {
      const current = data[currentKey];
      if (!Array.isArray(current)) data[currentKey] = [];
      (data[currentKey] as string[]).push(cleanValue(listItem[1]));
      continue;
    }

    const nestedListItem = /^    -\s+(.+)$/.exec(line);
    if (nestedListItem && currentKey && nestedKey) {
      const record = data[currentKey] as Record<string, string[]>;
      record[nestedKey] ??= [];
      record[nestedKey].push(cleanValue(nestedListItem[1]));
    }
  }

  return { hasFrontmatter: true, data, body };
}

export function frontmatterString(
  data: Record<string, FrontmatterValue>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

export function frontmatterStringList(
  data: Record<string, FrontmatterValue>,
  key: string,
): string[] {
  const value = data[key];
  return Array.isArray(value) ? value : [];
}

export function frontmatterStringRecord(
  data: Record<string, FrontmatterValue>,
  key: string,
): Record<string, string[]> {
  const value = data[key];
  if (!value || Array.isArray(value) || typeof value === "string") return {};
  return value;
}

export function extractMarkdownHeadings(source: string): MarkdownHeading[] {
  return source
    .split("\n")
    .map((line) => /^(#{1,6})\s+(.+?)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({
      level: match[1].length,
      title: match[2].replace(/\s+#*$/, "").trim(),
    }));
}

export function headingLevelShape(source: string): string {
  return extractMarkdownHeadings(source).map((heading) => String(heading.level)).join(",");
}
