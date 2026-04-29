// Persona 加载器 — 复用 subagents.ts 的 parseFrontmatter
// 加载顺序：repo personas/*.md（默认） → ~/.miniclaw/personas/*.md（用户覆盖）

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, type FrontmatterValue } from "../agent/subagents.js";
import { createLogger } from "../lib/log.js";
import type { Persona } from "./types.js";

const log = createLogger("personas");

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_PERSONAS_DIR = resolve(__dirname, "../../personas");
const USER_PERSONAS_DIR = join(homedir(), ".miniclaw", "personas");

function asString(v: FrontmatterValue | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asArray(v: FrontmatterValue | undefined): string[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

export interface LoadedPersonas {
  byId: Map<string, Persona>;
  errors: Array<{ file: string; error: string }>;
}

let cache: LoadedPersonas | null = null;

export function resetPersonasCache(): void {
  cache = null;
}

export function loadPersonas(): LoadedPersonas {
  if (cache) return cache;
  const byId = new Map<string, Persona>();
  const errors: Array<{ file: string; error: string }> = [];

  for (const { dir, source } of [
    { dir: REPO_PERSONAS_DIR, source: "repo" as const },
    { dir: USER_PERSONAS_DIR, source: "user" as const },
  ]) {
    if (!existsSync(dir)) {
      if (source === "repo") log.warn(`repo personas dir missing: ${dir}`);
      continue;
    }
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch (err) {
      log.warn(`无法读取 ${dir}:`, err);
      continue;
    }
    for (const file of files) {
      const path = join(dir, file);
      try {
        const raw = readFileSync(path, "utf8");
        const { meta, body } = parseFrontmatter(raw);
        const id = file.replace(/\.md$/, "").toLowerCase();
        const name = asString(meta.name) ?? id;
        const emoji = asString(meta.emoji) ?? "🤖";
        const persona: Persona = {
          id,
          name,
          emoji,
          systemPrompt: body,
          ...(asString(meta.model) ? { model: asString(meta.model)! } : {}),
          ...(asArray(meta.tools) ? { tools: asArray(meta.tools)! } : {}),
          ...(asString(meta.budget_per_turn_usd)
            ? { budgetPerTurnUsd: Number(asString(meta.budget_per_turn_usd)!) }
            : {}),
        };
        if (byId.has(id) && source === "user") {
          log.info(`user persona '${id}' overrides repo`);
        }
        byId.set(id, persona);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ file: path, error: msg });
        log.warn(`persona parse failed ${path}: ${msg}`);
      }
    }
  }

  log.info(`loaded ${byId.size} persona(s): ${[...byId.keys()].join(", ") || "(none)"}`);
  cache = { byId, errors };
  return cache;
}

/**
 * 解析消息文本里的 @persona-id 引用。
 * 规则：@后跟字母数字下划线连字符；忽略大小写匹配 registry。
 * 自引用（speaker 自己 @ 自己）由调用方过滤，不在此处理。
 */
export function parseMentions(text: string, registry: Map<string, Persona>): string[] {
  const re = /@([A-Za-z0-9_-]+)/g;
  const result: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[1].toLowerCase();
    if (registry.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
