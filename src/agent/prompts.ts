// Prompt 资产加载器。系统级 prompt 集中存 prompts/*.md，可被 ~/.miniclaw/prompts/ 用户级覆盖。
//
// frontmatter 必填字段：
//   description: 一句话说明
//   vars: [a, b, c]  (可空 [])  body 中除内置 date/time/iso/weekday 外的所有 {{xxx}} 必须 ⊆ vars，
//                                调用方传入的 keys 也必须 ⊆ vars
//
// 加载失败 throw（与 subagent 跳过坏文件不同）—— prompts 是核心系统资产，缺一不可。

import { readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { parseFrontmatter, asString, asStringArray } from "../lib/markdown.js";
import { renderTemplate } from "../cron/template.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_PROMPTS_DIR = resolve(__dirname, "../../prompts");

function userPromptsDir(): string {
  return process.env.MINICLAW_PROMPTS_DIR ?? join(homedir(), ".miniclaw/prompts");
}

const STRICT_CACHE = process.env.MINICLAW_PROMPT_CACHE === "strict";
const BUILTIN_VARS = new Set(["date", "time", "iso", "weekday"]);
const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

interface CachedPrompt {
  mtimeMs: number;
  body: string;
  declaredVars: string[];
  source: "repo" | "user";
  absPath: string;
}

const cache = new Map<string, CachedPrompt>();

function resolvePath(name: string): { absPath: string; source: "repo" | "user" } {
  const userPath = join(userPromptsDir(), `${name}.md`);
  if (existsSync(userPath)) return { absPath: userPath, source: "user" };
  const repoPath = join(REPO_PROMPTS_DIR, `${name}.md`);
  if (existsSync(repoPath)) return { absPath: repoPath, source: "repo" };
  throw new Error(
    `[prompts] '${name}' not found.\n` +
    `  searched: ${userPath} (user)\n` +
    `         + ${repoPath} (repo)\n` +
    `  hint: 在 prompts/${name}.md 创建，或定义 MINICLAW_PROMPTS_DIR 指向自定义目录`
  );
}

function load(name: string): CachedPrompt {
  const { absPath, source } = resolvePath(name);
  const cached = cache.get(name);
  if (cached && cached.absPath === absPath) {
    if (STRICT_CACHE) return cached;
    const stat = statSync(absPath);
    if (stat.mtimeMs === cached.mtimeMs) return cached;
  }

  const raw = readFileSync(absPath, "utf8");
  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (err) {
    throw new Error(
      `[prompts] '${name}' frontmatter parse failed at ${absPath} (${source}): ${(err as Error).message}`
    );
  }

  const description = asString(parsed.meta.description);
  if (!description) {
    throw new Error(
      `[prompts] '${name}' at ${absPath} (${source}): frontmatter must include 'description'`
    );
  }

  const declaredVars = asStringArray(parsed.meta.vars) ?? [];

  // 校验 body 内的 {{xxx}} 必须 ⊆ declaredVars ∪ builtins
  const usedInBody = new Set<string>();
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(parsed.body)) !== null) {
    usedInBody.add(m[1]);
  }
  const undeclared: string[] = [];
  for (const v of usedInBody) {
    if (!BUILTIN_VARS.has(v) && !declaredVars.includes(v)) {
      undeclared.push(v);
    }
  }
  if (undeclared.length) {
    throw new Error(
      `[prompts] '${name}' at ${absPath} (${source}):\n` +
      `  body uses {{${undeclared.join("}}, {{")}}} but frontmatter vars=[${declaredVars.join(", ")}]\n` +
      `  hint: 把缺失的 var 加到 frontmatter \`vars\` 数组里，或删掉 body 中的占位符`
    );
  }

  const stat = statSync(absPath);
  const entry: CachedPrompt = {
    mtimeMs: stat.mtimeMs,
    body: parsed.body,
    declaredVars,
    source,
    absPath,
  };
  cache.set(name, entry);
  return entry;
}

export function loadPrompt(name: string, vars: Record<string, string> = {}): string {
  const entry = load(name);

  // 校验调用方传入的 keys ⊆ declaredVars
  const extra = Object.keys(vars).filter((k) => !entry.declaredVars.includes(k));
  if (extra.length) {
    throw new Error(
      `[prompts] '${name}' called with undeclared vars: [${extra.join(", ")}]\n` +
      `  declared: [${entry.declaredVars.join(", ")}]\n` +
      `  hint: 把它们加到 ${entry.absPath} 的 frontmatter vars，或修正调用处的 key`
    );
  }

  return renderTemplate(entry.body, vars);
}

// 测试或开发时清缓存
export function __clearPromptCache(): void {
  cache.clear();
}
