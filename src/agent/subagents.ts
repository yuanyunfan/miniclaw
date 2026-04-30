import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../lib/log.js";
import { parseFrontmatter, asString, asStringArray, type FrontmatterValue } from "../lib/markdown.js";

const log = createLogger("subagents");

export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = resolve(__dirname, "../../agents");

export { parseFrontmatter, type FrontmatterValue };

let cache: Record<string, AgentDefinition> | null = null;

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
      if (source === "repo") log.warn(`无法读取 ${dir}:`, err);
      continue;
    }

    for (const file of files) {
      const path = join(dir, file);
      const raw = readFileSync(path, "utf8");
      const { meta, body } = parseFrontmatter(raw);
      const description = asString(meta.description);
      if (!description) {
        log.warn(`跳过 ${file} (${source}): frontmatter 缺少 description`);
        continue;
      }
      const name = file.replace(/\.md$/, "");
      if (result[name] && source === "user") {
        log.warn(`user skill '${name}' 覆盖 repo subagent`);
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
