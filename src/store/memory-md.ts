import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";

export const MEMORY_TYPES = ["user", "project", "feedback", "reference"] as const;
export type MemoryType = typeof MEMORY_TYPES[number];
export type MemoryStatus = "active" | "archived";
export type MemoryTtl = "stable" | "project" | "volatile" | "reference";

const SECTION_EMOJI: Record<MemoryType, string> = {
  user: "🧑",
  project: "📋",
  feedback: "💬",
  reference: "📚",
};

const ENTRY_SEP = "\n§\n";
const META_COMMENT_REGEX = /<!--\s*([\s\S]*?)\s*-->/g;
const META_ATTR_REGEX = /([a-zA-Z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
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
  status?: MemoryStatus;
  ttl?: MemoryTtl;
  source?: string;
  confidence?: number;
  canonical_key?: string;
  archived_at?: string;
  archive_reason?: string;
}

function memoryPath(): string {
  return config.memoryPath;
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

export function isMemoryType(type: string): type is MemoryType {
  return (MEMORY_TYPES as readonly string[]).includes(type);
}

function normalizeType(type: string): MemoryType {
  return isMemoryType(type) ? type : "user";
}

function nowIso(): string {
  return new Date().toISOString();
}

function deriveName(content: string): string {
  return content.slice(0, 30).replace(/\n/g, " ");
}

function parseMetaAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(META_ATTR_REGEX)) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[key] = value
      .replaceAll("&quot;", "\"")
      .replaceAll("&#39;", "'")
      .replaceAll("&amp;", "&");
  }
  return attrs;
}

function extractMeta(entry: string): { attrs: Record<string, string>; content: string } {
  const matches = [...entry.matchAll(META_COMMENT_REGEX)];
  const meta = matches.at(-1);
  if (!meta || meta.index === undefined) return { attrs: {}, content: entry.trim() };

  const before = entry.slice(0, meta.index);
  const after = entry.slice(meta.index + meta[0].length);
  return {
    attrs: parseMetaAttributes(meta[1] ?? ""),
    content: `${before}${after}`.trim(),
  };
}

function parseConfidence(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseStatus(raw: string | undefined): MemoryStatus | undefined {
  return raw === "active" || raw === "archived" ? raw : undefined;
}

function parseTtl(raw: string | undefined): MemoryTtl | undefined {
  return raw === "stable" || raw === "project" || raw === "volatile" || raw === "reference"
    ? raw
    : undefined;
}

function readAll(): MemoryRow[] {
  const path = memoryPath();
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const rows: MemoryRow[] = [];

  for (const type of MEMORY_TYPES) {
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
      const { attrs, content } = extractMeta(entry);
      const id = attrs.id;
      const explicitName = attrs.name;
      if (!id || !content) continue;
      rows.push({
        id,
        type,
        name: (explicitName ?? deriveName(content)).slice(0, 30),
        content,
        created_at: attrs.created_at ?? "",
        updated_at: attrs.updated_at ?? "",
        ...(parseStatus(attrs.status) ? { status: parseStatus(attrs.status) } : {}),
        ...(parseTtl(attrs.ttl) ? { ttl: parseTtl(attrs.ttl) } : {}),
        ...(attrs.source ? { source: attrs.source } : {}),
        ...(parseConfidence(attrs.confidence) !== undefined ? { confidence: parseConfidence(attrs.confidence) } : {}),
        ...(attrs.canonical_key ? { canonical_key: attrs.canonical_key } : {}),
        ...(attrs.archived_at ? { archived_at: attrs.archived_at } : {}),
        ...(attrs.archive_reason ? { archive_reason: attrs.archive_reason } : {}),
      });
    }
  }
  return rows;
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("\n", " ")
    .trim();
}

function attr(key: string, value: string | number | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  return `${key}="${escapeAttr(String(value))}"`;
}

function formatMeta(row: MemoryRow): string {
  const derivedName = deriveName(row.content);
  const attrs = [
    row.name && row.name !== derivedName ? attr("name", row.name) : undefined,
    attr("id", row.id),
    attr("status", row.status),
    attr("ttl", row.ttl),
    attr("source", row.source),
    attr("confidence", row.confidence !== undefined ? Number(row.confidence.toFixed(3)) : undefined),
    attr("canonical_key", row.canonical_key),
    attr("created_at", row.created_at),
    attr("updated_at", row.updated_at),
    attr("archived_at", row.archived_at),
    attr("archive_reason", row.archive_reason),
  ].filter((v): v is string => Boolean(v));
  return `<!-- ${attrs.join(" ")} -->`;
}

function serialize(rows: MemoryRow[]): string {
  const grouped: Record<MemoryType, MemoryRow[]> = {
    user: [], project: [], feedback: [], reference: [],
  };
  for (const r of rows) grouped[normalizeType(r.type)].push(r);

  const sections = MEMORY_TYPES.map((type) => {
    const items = grouped[type];
    const body = items.length
      ? items.map((r) => `${r.content}\n${formatMeta(r)}`).join(ENTRY_SEP)
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

export interface MemoryUpsertInput {
  type: string;
  name: string;
  content: string;
  status?: MemoryStatus;
  ttl?: MemoryTtl;
  source?: string;
  confidence?: number;
  canonical_key?: string;
}

export interface MemoryUpsertOptions {
  targetId?: string;
  now?: string;
}

function findExistingIndex(rows: MemoryRow[], input: { type: string; name: string; canonical_key?: string }, targetId?: string): number {
  if (targetId) {
    const byId = rows.findIndex((r) => r.id === targetId);
    if (byId >= 0) return byId;
  }
  if (input.canonical_key) {
    const byCanonicalKey = rows.findIndex((r) => r.canonical_key === input.canonical_key);
    if (byCanonicalKey >= 0) return byCanonicalKey;
  }
  return rows.findIndex((r) => r.type === input.type && r.name === input.name);
}

export function upsertMemory(input: MemoryUpsertInput, options: MemoryUpsertOptions = {}): MemoryRow {
  const rows = readAll();
  const normalizedType = normalizeType(input.type);
  const trimmedContent = input.content.trim();
  const finalName = (input.name?.trim() || deriveName(trimmedContent)).slice(0, 30);
  const timestamp = options.now ?? nowIso();

  const existingIdx = findExistingIndex(rows, {
    type: normalizedType,
    name: finalName,
    canonical_key: input.canonical_key,
  }, options.targetId);

  if (existingIdx >= 0) {
    const existing = rows[existingIdx];
    const updated: MemoryRow = {
      ...existing,
      content: trimmedContent,
      name: finalName || existing.name,
      type: normalizedType,
      status: input.status ?? existing.status ?? "active",
      ttl: input.ttl ?? existing.ttl,
      source: input.source ?? existing.source,
      confidence: input.confidence ?? existing.confidence,
      canonical_key: input.canonical_key ?? existing.canonical_key,
      created_at: existing.created_at || timestamp,
      updated_at: timestamp,
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
    status: input.status ?? "active",
    ttl: input.ttl,
    source: input.source,
    confidence: input.confidence,
    canonical_key: input.canonical_key,
    created_at: timestamp,
    updated_at: timestamp,
  };
  rows.push(row);
  atomicWrite(serialize(rows));
  return row;
}

export function addMemory(
  type: string,
  name: string,
  content: string,
  options: Omit<MemoryUpsertInput, "type" | "name" | "content"> & MemoryUpsertOptions = {},
): MemoryRow {
  return upsertMemory({
    type,
    name,
    content,
    ...(options.status ? { status: options.status } : {}),
    ...(options.ttl ? { ttl: options.ttl } : {}),
    ...(options.source ? { source: options.source } : {}),
    ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
    ...(options.canonical_key ? { canonical_key: options.canonical_key } : {}),
  }, {
    ...(options.targetId ? { targetId: options.targetId } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
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

export function archiveMemory(id: string | number, reason = "archived by maintenance", now = nowIso()): boolean {
  const targetId = String(id);
  const rows = readAll();
  const idx = rows.findIndex((r) => r.id === targetId);
  if (idx < 0) return false;
  rows[idx] = {
    ...rows[idx],
    status: "archived",
    archived_at: now,
    archive_reason: reason,
    updated_at: now,
  };
  atomicWrite(serialize(rows));
  return true;
}

export function getAllMemories(): MemoryRow[] {
  return readAll();
}

export function getMemoriesByType(type: string): MemoryRow[] {
  if (!isMemoryType(type)) return [];
  return readAll().filter((r) => r.type === type);
}

export function searchMemories(query: string): MemoryRow[] {
  const q = query.toLowerCase();
  return readAll().filter(
    (r) => r.name.toLowerCase().includes(q) || r.content.toLowerCase().includes(q)
  );
}

export function writeMemories(rows: MemoryRow[]): void {
  atomicWrite(serialize(rows));
}

export const __testables = {
  deriveName,
  extractMeta,
  formatMeta,
  normalizeType,
  serialize,
};
