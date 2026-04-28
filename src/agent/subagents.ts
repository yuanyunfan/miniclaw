import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = resolve(__dirname, "../../agents");

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
    throw new Error("Subagent markdown 缺少 YAML frontmatter (--- ... ---)");
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

let cache: Record<string, AgentDefinition> | null = null;

function asString(v: FrontmatterValue | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asStringArray(v: FrontmatterValue | undefined): string[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

export function loadSubagents(): Record<string, AgentDefinition> {
  if (cache) return cache;
  const result: Record<string, AgentDefinition> = {};

  // 加载顺序：repo agents/ → user ~/.miniclaw/skills/（同名 user 覆盖 repo）
  const dirs: Array<{ path: string; source: string }> = [
    { path: AGENTS_DIR, source: "repo" },
  ];
  const userSkillsDir = process.env.MINICLAW_SKILLS_DIR
    ?? `${process.env.HOME ?? ""}/.miniclaw/skills`;
  if (userSkillsDir && existsSync(userSkillsDir)) {
    dirs.push({ path: userSkillsDir, source: "user" });
  }

  for (const { path: dir, source } of dirs) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch (err) {
      if (source === "repo") console.warn(`[subagents] 无法读取 ${dir}:`, err);
      continue;
    }

    for (const file of files) {
      const path = join(dir, file);
      const raw = readFileSync(path, "utf8");
      const { meta, body } = parseFrontmatter(raw);
      const description = asString(meta.description);
      if (!description) {
        console.warn(`[subagents] 跳过 ${file} (${source}): frontmatter 缺少 description`);
        continue;
      }
      const name = file.replace(/\.md$/, "");
      if (result[name] && source === "user") {
        console.warn(`[subagents] user skill '${name}' 覆盖 repo subagent`);
      }
      const model = asString(meta.model);
      const tools = asStringArray(meta.tools);
      result[name] = {
        description,
        prompt: body,
        ...(model ? { model } : {}),
        ...(tools ? { tools } : {}),
      };
    }
  }

  cache = result;
  return result;
}

export function listSubagentNames(): string[] {
  return Object.keys(loadSubagents());
}
