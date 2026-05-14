import { createHash } from "node:crypto";
import {
  getAllMemories,
  isMemoryType,
  upsertMemory,
  type MemoryRow,
  type MemoryTtl,
  type MemoryType,
} from "../store/memory.js";

export interface RawMemoryCandidate {
  type?: unknown;
  name?: unknown;
  content?: unknown;
  confidence?: unknown;
}

export interface ValidMemoryCandidate {
  type: MemoryType;
  name: string;
  content: string;
  confidence?: number;
  ttl: MemoryTtl;
  canonical_key: string;
  source: string;
}

export interface MemoryValidationResult {
  ok: boolean;
  candidate?: ValidMemoryCandidate;
  reason?: string;
}

export type MemoryDecisionAction = "create" | "update" | "noop" | "reject";

export interface MemoryMergeDecision {
  action: MemoryDecisionAction;
  reason: string;
  candidate?: ValidMemoryCandidate;
  targetId?: string;
  similarity?: number;
}

export interface AppliedMemoryDecision {
  decision: MemoryMergeDecision;
  row?: MemoryRow;
}

const BLOCKED_NAME_RE = /^(json|memory_json|memory_extraction|extract|extraction|items?)$/i;
const SECRET_ASSIGNMENT_RE = /\b(token|cookie|validatekey|password|passwd|secret|api[_-]?key|session)\b\s*[:=]\s*\S+/i;
const VOLATILE_RE = /(当前|今天|本次|刚才|刚刚|现在|这次|last run|latest|current|incident|失败|正常吗|running|skipped|status)/i;

function sha(input: string, length = 12): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, length);
}

function normalizeSpace(input: string): string {
  return input.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeForComparison(input: string): string {
  return normalizeSpace(input)
    .toLowerCase()
    .replace(/claude code/g, "claudecode")
    .replace(/write\/edit/g, "write edit")
    .replace(/[|`*_~#>\[\]{}()（）【】<>《》"'“”‘’.,，。:：;；!?！？/\\-]/g, "")
    .replace(/\s+/g, "");
}

function normalizeKey(input: string): string {
  return normalizeForComparison(input).slice(0, 64);
}

function looksLikeJsonBlob(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed === "[]" || trimmed === "{}") return true;
  if (!/^[\[{]/.test(trimmed) || !/[\]}]$/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function meaningfulLength(input: string): number {
  return normalizeForComparison(input).length;
}

function confidenceValue(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function inferTtl(type: MemoryType, content: string): MemoryTtl {
  if (type === "feedback" || type === "user") return "stable";
  if (type === "reference") return "reference";
  return VOLATILE_RE.test(content) ? "volatile" : "project";
}

export function buildCanonicalKey(type: MemoryType, name: string, content: string): string {
  const nameKey = normalizeKey(name);
  if (nameKey) return `${type}:${nameKey}`;
  return `${type}:${sha(normalizeForComparison(content), 16)}`;
}

export function validateMemoryCandidate(raw: RawMemoryCandidate, source = "auto_extract"): MemoryValidationResult {
  const typeRaw = typeof raw.type === "string" ? raw.type.trim() : "";
  if (!isMemoryType(typeRaw)) return { ok: false, reason: `invalid type: ${typeRaw || "<empty>"}` };

  const name = normalizeSpace(typeof raw.name === "string" ? raw.name : "");
  const content = normalizeSpace(typeof raw.content === "string" ? raw.content : "");
  if (!name) return { ok: false, reason: "missing name" };
  if (!content) return { ok: false, reason: "missing content" };
  if (BLOCKED_NAME_RE.test(name)) return { ok: false, reason: `blocked name: ${name}` };
  if (looksLikeJsonBlob(content)) return { ok: false, reason: "json-like blob content" };
  if (meaningfulLength(content) < 6) return { ok: false, reason: "content too short" };
  if (content.length > 1200) return { ok: false, reason: "content too long" };
  if (SECRET_ASSIGNMENT_RE.test(content)) return { ok: false, reason: "secret-like assignment" };

  const type = typeRaw;
  const finalName = name.slice(0, 30);
  const confidence = confidenceValue(raw.confidence);
  return {
    ok: true,
    candidate: {
      type,
      name: finalName,
      content,
      ...(confidence !== undefined ? { confidence } : {}),
      ttl: inferTtl(type, content),
      canonical_key: buildCanonicalKey(type, finalName, content),
      source,
    },
  };
}

function tokens(input: string): Set<string> {
  const normalized = normalizeForComparison(input);
  const out = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9]{3,}/g)) out.add(match[0]);
  const cjk = normalized.replace(/[a-z0-9]+/g, "");
  const chars = Array.from(cjk);
  for (let i = 0; i < chars.length - 1; i += 1) out.add(`${chars[i]}${chars[i + 1]}`);
  if (!out.size && normalized) out.add(normalized);
  return out;
}

export function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union ? intersection / union : 0;
}

function combinedSimilarity(candidate: ValidMemoryCandidate, row: MemoryRow): number {
  const nameScore = similarity(candidate.name, row.name);
  const contentScore = similarity(candidate.content, row.content);
  return Math.max(contentScore, nameScore * 0.35 + contentScore * 0.65);
}

function isSameContent(candidate: ValidMemoryCandidate, row: MemoryRow): boolean {
  return normalizeForComparison(candidate.content) === normalizeForComparison(row.content);
}

export function decideMemoryMerge(
  candidate: ValidMemoryCandidate,
  existingMemories: MemoryRow[],
): MemoryMergeDecision {
  const active = existingMemories.filter((row) => row.status !== "archived");
  const canonical = active.find((row) => row.canonical_key && row.canonical_key === candidate.canonical_key);
  if (canonical) {
    return isSameContent(candidate, canonical)
      ? { action: "noop", reason: "same canonical key and content", candidate, targetId: canonical.id, similarity: 1 }
      : { action: "update", reason: "same canonical key", candidate, targetId: canonical.id, similarity: 1 };
  }

  const exact = active.find((row) => row.type === candidate.type && isSameContent(candidate, row));
  if (exact) {
    return { action: "noop", reason: "same normalized content", candidate, targetId: exact.id, similarity: 1 };
  }

  const sameName = active.find((row) => row.type === candidate.type && normalizeForComparison(row.name) === normalizeForComparison(candidate.name));
  if (sameName) {
    return { action: "update", reason: "same normalized name", candidate, targetId: sameName.id, similarity: combinedSimilarity(candidate, sameName) };
  }

  let best: { row: MemoryRow; score: number } | undefined;
  for (const row of active.filter((r) => r.type === candidate.type)) {
    const score = combinedSimilarity(candidate, row);
    if (!best || score > best.score) best = { row, score };
  }
  if (best && best.score >= 0.82) {
    return { action: "update", reason: "high semantic similarity", candidate, targetId: best.row.id, similarity: best.score };
  }

  return { action: "create", reason: "new durable memory", candidate };
}

function mergeContent(existing: MemoryRow | undefined, candidate: ValidMemoryCandidate): string {
  if (!existing) return candidate.content;
  const existingNorm = normalizeForComparison(existing.content);
  const candidateNorm = normalizeForComparison(candidate.content);
  if (existingNorm === candidateNorm) return existing.content;
  if (existingNorm.includes(candidateNorm)) return existing.content;
  if (candidateNorm.includes(existingNorm)) return candidate.content;
  return candidate.content;
}

export function applyMemoryMergeDecision(decision: MemoryMergeDecision, existingMemories = getAllMemories()): AppliedMemoryDecision {
  if (!decision.candidate || decision.action === "reject" || decision.action === "noop") {
    return { decision };
  }
  const target = decision.targetId ? existingMemories.find((row) => row.id === decision.targetId) : undefined;
  const row = upsertMemory({
    type: decision.candidate.type,
    name: target?.name ?? decision.candidate.name,
    content: mergeContent(target, decision.candidate),
    status: "active",
    ttl: decision.candidate.ttl,
    source: decision.candidate.source,
    confidence: decision.candidate.confidence,
    canonical_key: target?.canonical_key ?? decision.candidate.canonical_key,
  }, {
    ...(decision.targetId ? { targetId: decision.targetId } : {}),
  });
  return { decision, row };
}

export function curateAndApplyMemoryCandidates(
  rawCandidates: RawMemoryCandidate[],
  options: { source?: string; existingMemories?: MemoryRow[]; apply?: boolean } = {},
): AppliedMemoryDecision[] {
  const source = options.source ?? "auto_extract";
  let existing = options.existingMemories ?? getAllMemories();
  const results: AppliedMemoryDecision[] = [];
  for (const raw of rawCandidates) {
    const validation = validateMemoryCandidate(raw, source);
    if (!validation.ok || !validation.candidate) {
      results.push({ decision: { action: "reject", reason: validation.reason ?? "invalid candidate" } });
      continue;
    }
    const decision = decideMemoryMerge(validation.candidate, existing);
    const result = options.apply === false
      ? { decision }
      : applyMemoryMergeDecision(decision, existing);
    results.push(result);
    if (result.row) existing = getAllMemories();
  }
  return results;
}
