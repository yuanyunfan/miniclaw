import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const TYPES = ["user", "project", "feedback", "reference"] as const;
type MemoryType = typeof TYPES[number];

const SECTION_EMOJI: Record<MemoryType, string> = {
  user: "🧑",
  project: "📋",
  feedback: "💬",
  reference: "📚",
};

const ENTRY_SEP = "\n§\n";
const META_REGEX = /<!--\s*(?:name="([^"]*)"\s+)?id=([a-f0-9]{4,8})\s*-->/;
const EMPTY_PLACEHOLDER = "（暂无）";

const HEADER = `# MiniClaw Memory

> 直接 vim 编辑生效。每条用 \`§\` 分隔。每条末尾的 \`<!-- id=xxx -->\` 是自动 ID（供 /forget 用）。
> 4 个 section 固定：user / project / feedback / reference。新增其他 type 会被归入 user。

`;

export interface MemoryRow {
  id: string;
  type: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function memoryPath(): string {
  return process.env.MINICLAW_MEMORY_PATH ?? join(homedir(), ".miniclaw/memories/MEMORY.md");
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function genId(existing: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const id = randomBytes(2).toString("hex");
    if (!existing.has(id)) return id;
  }
  throw new Error("memory id collision after 100 tries");
}

function normalizeType(type: string): MemoryType {
  return (TYPES as readonly string[]).includes(type) ? (type as MemoryType) : "user";
}

function nowIso(): string {
  return new Date().toISOString();
}

function deriveName(content: string): string {
  return content.slice(0, 30).replace(/\n/g, " ");
}

function readAll(): MemoryRow[] {
  const path = memoryPath();
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const rows: MemoryRow[] = [];

  for (const type of TYPES) {
    const sectionRe = new RegExp(
      `##\\s+\\S+\\s+${type}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
      "i"
    );
    const m = raw.match(sectionRe);
    if (!m) continue;
    const body = m[1].trim();
    if (!body || body === EMPTY_PLACEHOLDER) continue;

    const entries = body.split(/^§$/m).map((e) => e.trim()).filter(Boolean);
    for (const entry of entries) {
      const metaMatch = entry.match(META_REGEX);
      const id = metaMatch?.[2];
      const explicitName = metaMatch?.[1];
      const content = entry.replace(META_REGEX, "").trim();
      if (!id || !content) continue;
      rows.push({
        id,
        type,
        name: (explicitName ?? deriveName(content)).slice(0, 30),
        content,
        created_at: "",
        updated_at: "",
      });
    }
  }
  return rows;
}

function serialize(rows: MemoryRow[]): string {
  const grouped: Record<MemoryType, MemoryRow[]> = {
    user: [], project: [], feedback: [], reference: [],
  };
  for (const r of rows) grouped[normalizeType(r.type)].push(r);

  const sections = TYPES.map((type) => {
    const items = grouped[type];
    const body = items.length
      ? items.map((r) => {
          const derivedName = deriveName(r.content);
          // 仅当 name 与从 content 派生的不同时，才显式存 name=（避免冗余）
          const safeName = r.name.replace(/"/g, "'"); // 简单防注入
          const nameTag = r.name && r.name !== derivedName
            ? `name="${safeName}" `
            : "";
          return `${r.content}\n<!-- ${nameTag}id=${r.id} -->`;
        }).join(ENTRY_SEP)
      : EMPTY_PLACEHOLDER;
    return `## ${SECTION_EMOJI[type]} ${type}\n${body}`;
  });

  return HEADER + sections.join("\n\n") + "\n";
}

function atomicWrite(content: string): void {
  const path = memoryPath();
  ensureDir(path);
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

export function addMemory(type: string, name: string, content: string): MemoryRow {
  const rows = readAll();
  const normalizedType = normalizeType(type);
  const trimmedContent = content.trim();
  const finalName = (name?.trim() || deriveName(trimmedContent)).slice(0, 30);

  // dedupe by (type, name): same key updates content
  const existingIdx = rows.findIndex(
    (r) => r.type === normalizedType && r.name === finalName
  );

  if (existingIdx >= 0) {
    const existing = rows[existingIdx];
    const updated: MemoryRow = {
      ...existing,
      content: trimmedContent,
      name: finalName,
      updated_at: nowIso(),
    };
    rows[existingIdx] = updated;
    atomicWrite(serialize(rows));
    return updated;
  }

  const id = genId(new Set(rows.map((r) => r.id)));
  const row: MemoryRow = {
    id,
    type: normalizedType,
    name: finalName,
    content: trimmedContent,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  rows.push(row);
  atomicWrite(serialize(rows));
  return row;
}

export function deleteMemory(id: string | number): boolean {
  const targetId = String(id);
  const rows = readAll();
  const idx = rows.findIndex((r) => r.id === targetId);
  if (idx < 0) return false;
  rows.splice(idx, 1);
  atomicWrite(serialize(rows));
  return true;
}

export function getAllMemories(): MemoryRow[] {
  return readAll();
}

export function getMemoriesByType(type: string): MemoryRow[] {
  if (!(TYPES as readonly string[]).includes(type)) return [];
  return readAll().filter((r) => r.type === type);
}

export function searchMemories(query: string): MemoryRow[] {
  const q = query.toLowerCase();
  return readAll().filter(
    (r) => r.name.toLowerCase().includes(q) || r.content.toLowerCase().includes(q)
  );
}
