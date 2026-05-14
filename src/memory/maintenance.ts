import {
  archiveMemory,
  deleteMemory,
  getAllMemories,
  upsertMemory,
  writeMemories,
  type MemoryRow,
} from "../store/memory.js";
import {
  buildCanonicalKey,
  similarity,
  validateMemoryCandidate,
} from "./curation.js";

export type MemoryMaintenanceKind = "dirty" | "duplicate" | "stale" | "metadata_missing";
export type MemoryMaintenanceAction = "delete" | "merge" | "archive" | "metadata";

export interface MemoryMaintenanceFinding {
  kind: MemoryMaintenanceKind;
  action: MemoryMaintenanceAction;
  id: string;
  target_id?: string;
  name: string;
  reason: string;
  similarity?: number;
}

export interface MemoryMaintenanceReport {
  generated_at: string;
  dry_run: boolean;
  total_memories: number;
  findings: MemoryMaintenanceFinding[];
  applied: MemoryMaintenanceFinding[];
}

export interface MemoryMaintenanceOptions {
  dryRun?: boolean;
  now?: Date;
  staleDays?: {
    volatile: number;
    project: number;
    reference: number;
  };
}

const DEFAULT_STALE_DAYS = {
  volatile: 30,
  project: 180,
  reference: 365,
};

function timestamp(row: MemoryRow): Date | undefined {
  const raw = row.updated_at || row.created_at;
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function ageDays(row: MemoryRow, now: Date): number | undefined {
  const date = timestamp(row);
  if (!date) return undefined;
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

function hasMetadata(row: MemoryRow): boolean {
  return Boolean(row.status && row.ttl && row.source && row.canonical_key && row.created_at && row.updated_at);
}

function dirtyReason(row: MemoryRow): string | undefined {
  const validation = validateMemoryCandidate({
    type: row.type,
    name: row.name,
    content: row.content,
    confidence: row.confidence,
  }, row.source ?? "maintenance");
  return validation.ok ? undefined : validation.reason;
}

function staleReason(row: MemoryRow, now: Date, staleDays: Required<MemoryMaintenanceOptions>["staleDays"]): string | undefined {
  if (row.status === "archived" || row.ttl === "stable" || !row.ttl) return undefined;
  const age = ageDays(row, now);
  if (age === undefined) return undefined;
  const limit = staleDays[row.ttl as keyof typeof staleDays];
  if (!limit || age <= limit) return undefined;
  return `ttl=${row.ttl} age=${age}d > ${limit}d`;
}

function duplicateFindings(rows: MemoryRow[]): MemoryMaintenanceFinding[] {
  const findings: MemoryMaintenanceFinding[] = [];
  const active = rows.filter((row) => row.status !== "archived");
  for (let i = 0; i < active.length; i += 1) {
    const left = active[i];
    for (let j = i + 1; j < active.length; j += 1) {
      const right = active[j];
      if (left.type !== right.type) continue;
      const sameCanonical = Boolean(left.canonical_key && right.canonical_key && left.canonical_key === right.canonical_key);
      const score = sameCanonical ? 1 : similarity(`${left.name}\n${left.content}`, `${right.name}\n${right.content}`);
      if (!sameCanonical && score < 0.88) continue;
      const target = left.content.length >= right.content.length ? left : right;
      const duplicate = target.id === left.id ? right : left;
      if (findings.some((finding) => finding.id === duplicate.id)) continue;
      findings.push({
        kind: "duplicate",
        action: "merge",
        id: duplicate.id,
        target_id: target.id,
        name: duplicate.name,
        reason: sameCanonical ? "same canonical_key" : "high similarity",
        similarity: score,
      });
    }
  }
  return findings;
}

export function analyzeMemoryMaintenance(
  rows: MemoryRow[] = getAllMemories(),
  options: MemoryMaintenanceOptions = {},
): MemoryMaintenanceFinding[] {
  const now = options.now ?? new Date();
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS;
  const findings: MemoryMaintenanceFinding[] = [];

  for (const row of rows) {
    const reason = dirtyReason(row);
    if (reason) {
      findings.push({
        kind: "dirty",
        action: "delete",
        id: row.id,
        name: row.name,
        reason,
      });
      continue;
    }
    if (!hasMetadata(row)) {
      findings.push({
        kind: "metadata_missing",
        action: "metadata",
        id: row.id,
        name: row.name,
        reason: "missing lifecycle metadata",
      });
    }
    const stale = staleReason(row, now, staleDays);
    if (stale) {
      findings.push({
        kind: "stale",
        action: "archive",
        id: row.id,
        name: row.name,
        reason: stale,
      });
    }
  }

  return [...findings, ...duplicateFindings(rows)];
}

function applyMetadata(row: MemoryRow): MemoryMaintenanceFinding | undefined {
  const validation = validateMemoryCandidate({
    type: row.type,
    name: row.name,
    content: row.content,
    confidence: row.confidence,
  }, row.source ?? "legacy_import");
  if (!validation.ok || !validation.candidate) return undefined;
  upsertMemory({
    type: validation.candidate.type,
    name: row.name,
    content: row.content,
    status: row.status ?? "active",
    ttl: row.ttl ?? validation.candidate.ttl,
    source: row.source ?? "legacy_import",
    confidence: row.confidence ?? validation.candidate.confidence,
    canonical_key: row.canonical_key ?? buildCanonicalKey(validation.candidate.type, row.name, row.content),
  }, { targetId: row.id });
  return {
    kind: "metadata_missing",
    action: "metadata",
    id: row.id,
    name: row.name,
    reason: "filled lifecycle metadata",
  };
}

function applyMerge(finding: MemoryMaintenanceFinding): MemoryMaintenanceFinding | undefined {
  if (!finding.target_id) return undefined;
  const rows = getAllMemories();
  const duplicate = rows.find((row) => row.id === finding.id);
  const target = rows.find((row) => row.id === finding.target_id);
  if (!duplicate || !target) return undefined;
  const content = target.content.length >= duplicate.content.length ? target.content : duplicate.content;
  upsertMemory({
    type: target.type,
    name: target.name,
    content,
    status: "active",
    ttl: target.ttl ?? duplicate.ttl,
    source: "maintenance_merge",
    confidence: target.confidence ?? duplicate.confidence,
    canonical_key: target.canonical_key ?? duplicate.canonical_key,
  }, { targetId: target.id });
  deleteMemory(duplicate.id);
  return finding;
}

export function runMemoryMaintenance(options: MemoryMaintenanceOptions = {}): MemoryMaintenanceReport {
  const dryRun = options.dryRun ?? true;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const rows = getAllMemories();
  const findings = analyzeMemoryMaintenance(rows, options);
  const applied: MemoryMaintenanceFinding[] = [];

  if (!dryRun) {
    for (const finding of findings.filter((f) => f.kind === "dirty")) {
      if (deleteMemory(finding.id)) applied.push(finding);
    }
    for (const finding of findings.filter((f) => f.kind === "duplicate")) {
      const result = applyMerge(finding);
      if (result) applied.push(result);
    }
    for (const finding of findings.filter((f) => f.kind === "stale")) {
      if (archiveMemory(finding.id, finding.reason)) applied.push(finding);
    }
    for (const finding of findings.filter((f) => f.kind === "metadata_missing")) {
      const row = getAllMemories().find((memory) => memory.id === finding.id);
      if (!row) continue;
      const result = applyMetadata(row);
      if (result) applied.push(result);
    }
    // Normalize section ordering after mixed operations.
    writeMemories(getAllMemories());
  }

  return {
    generated_at: generatedAt,
    dry_run: dryRun,
    total_memories: rows.length,
    findings,
    applied,
  };
}

export function formatMemoryMaintenanceReport(report: MemoryMaintenanceReport): string {
  const lines = [
    `Memory maintenance (${report.dry_run ? "dry-run" : "apply"})`,
    `generated_at: ${report.generated_at}`,
    `total_memories: ${report.total_memories}`,
    `findings: ${report.findings.length}`,
    `applied: ${report.applied.length}`,
    "",
  ];
  if (!report.findings.length) {
    lines.push("No memory maintenance findings.");
    return `${lines.join("\n")}\n`;
  }
  for (const finding of report.findings) {
    const target = finding.target_id ? ` -> ${finding.target_id}` : "";
    const score = finding.similarity !== undefined ? ` similarity=${finding.similarity.toFixed(3)}` : "";
    lines.push(`- [${finding.kind}/${finding.action}] ${finding.id}${target} ${finding.name}: ${finding.reason}${score}`);
  }
  return `${lines.join("\n")}\n`;
}
