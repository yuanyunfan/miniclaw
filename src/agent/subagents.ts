import { readdirSync, readFileSync } from "node:fs";
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

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Subagent markdown 缺少 YAML frontmatter (--- ... ---)");
  }
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[m[1]] = value;
  }
  return { meta, body: match[2].trim() };
}

let cache: Record<string, AgentDefinition> | null = null;

export function loadSubagents(): Record<string, AgentDefinition> {
  if (cache) return cache;
  const result: Record<string, AgentDefinition> = {};

  let files: string[];
  try {
    files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
  } catch (err) {
    console.warn(`[subagents] 无法读取 ${AGENTS_DIR}:`, err);
    cache = result;
    return result;
  }

  for (const file of files) {
    const path = join(AGENTS_DIR, file);
    const raw = readFileSync(path, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    if (!meta.description) {
      console.warn(`[subagents] 跳过 ${file}: frontmatter 缺少 description`);
      continue;
    }
    const name = file.replace(/\.md$/, "");
    result[name] = {
      description: meta.description,
      prompt: body,
      ...(meta.model ? { model: meta.model } : {}),
    };
  }

  cache = result;
  return result;
}

export function listSubagentNames(): string[] {
  return Object.keys(loadSubagents());
}
