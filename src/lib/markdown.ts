// 公共 markdown frontmatter 解析。subagents.ts / personas.ts / prompts.ts 都从这里 import，避免三套实现。
// 支持：
// - 简单 key: value（含引号去除）
// - 块标量 key: |（保留换行）/ key: >（折叠空白）
// - flow 数组 key: [a, b, c]

export type FrontmatterValue = string | string[];

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFlowArray(raw: string): string[] {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((s) => stripQuotes(s.trim())).filter(Boolean);
}

export function parseFrontmatter(raw: string): { meta: Record<string, FrontmatterValue>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error("markdown 缺少 YAML frontmatter (--- ... ---)");
  }
  const meta: Record<string, FrontmatterValue> = {};
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const rawValue = m[2].trim();

    if (rawValue === "|" || rawValue === ">") {
      const collected: string[] = [];
      let j = i + 1;
      let baseIndent: number | null = null;
      while (j < lines.length) {
        const next = lines[j];
        if (/^\S/.test(next)) break;
        const indentMatch = next.match(/^(\s*)(.*)$/);
        const indent = indentMatch![1].length;
        if (baseIndent === null && indentMatch![2] !== "") baseIndent = indent;
        collected.push(baseIndent === null ? indentMatch![2] : next.slice(baseIndent));
        j++;
      }
      i = j - 1;
      const joined = rawValue === "|" ? collected.join("\n") : collected.join(" ");
      meta[key] = joined.replace(/\s+$/, "");
    } else if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      meta[key] = parseFlowArray(rawValue);
    } else {
      meta[key] = stripQuotes(rawValue);
    }
  }

  return { meta, body: match[2].trim() };
}

export function asString(v: FrontmatterValue | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function asStringArray(v: FrontmatterValue | undefined): string[] | undefined {
  return Array.isArray(v) ? v : undefined;
}
