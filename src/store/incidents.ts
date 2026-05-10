import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

export type IncidentSeverity = "info" | "warning" | "critical";
export type IncidentStatus =
  | "open"
  | "diagnosing"
  | "diagnosed"
  | "repair_blocked"
  | "repairing"
  | "repair_ready"
  | "shipped"
  | "resolved"
  | "ignored";

export const OPEN_INCIDENT_STATUSES: readonly IncidentStatus[] = [
  "open",
  "diagnosing",
  "diagnosed",
  "repair_blocked",
  "repairing",
  "repair_ready",
] as const;

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

const STATUS_PRESERVED_ON_REDIAGNOSIS: readonly IncidentStatus[] = [
  "repair_blocked",
  "repairing",
  "repair_ready",
  "shipped",
  "resolved",
  "ignored",
];

export interface IncidentRow {
  id: string;
  dedupe_key: string;
  type: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  summary: string | null;
  subject_id: string | null;
  subject_type: string | null;
  source_json: string | null;
  evidence_json: string | null;
  diagnosis_json: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface IncidentEventRow {
  id: number;
  incident_id: string;
  event_type: string;
  payload_json: string | null;
  created_at: string;
}

export interface RepairRunRow {
  id: string;
  incident_id: string;
  status: string;
  workspace_path: string | null;
  branch: string | null;
  base_sha: string | null;
  commit_sha: string | null;
  verification_json: string | null;
  report_json: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface IncidentInput {
  dedupeKey: string;
  type: string;
  severity: IncidentSeverity;
  status?: IncidentStatus;
  title: string;
  summary?: string;
  subjectId?: string;
  subjectType?: string;
  source?: unknown;
  evidence?: unknown;
  diagnosis?: unknown;
}

export interface CreateOrUpdateIncidentResult {
  row: IncidentRow;
  created: boolean;
  severityEscalated: boolean;
}

function json(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function parseIncidentRow(row: unknown): IncidentRow {
  if (!row || typeof row !== "object") {
    throw new Error("Unexpected incident row shape from database");
  }
  return row as IncidentRow;
}

function nowSql(): string {
  return new Date().toISOString();
}

function isOpen(status: string): boolean {
  return (OPEN_INCIDENT_STATUSES as readonly string[]).includes(status);
}

export function createOrUpdateIncident(input: IncidentInput): CreateOrUpdateIncidentResult {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM incidents WHERE dedupe_key = ?").get(input.dedupeKey) as IncidentRow | undefined;
  const nextStatus = input.status ?? "diagnosed";

  if (!existing) {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO incidents (
        id, dedupe_key, type, severity, status, title, summary,
        subject_id, subject_type, source_json, evidence_json, diagnosis_json,
        created_at, updated_at
      ) VALUES (
        @id, @dedupe_key, @type, @severity, @status, @title, @summary,
        @subject_id, @subject_type, @source_json, @evidence_json, @diagnosis_json,
        @created_at, @updated_at
      )`
    ).run({
      id,
      dedupe_key: input.dedupeKey,
      type: input.type,
      severity: input.severity,
      status: nextStatus,
      title: input.title,
      summary: input.summary ?? null,
      subject_id: input.subjectId ?? null,
      subject_type: input.subjectType ?? null,
      source_json: json(input.source),
      evidence_json: json(input.evidence),
      diagnosis_json: json(input.diagnosis),
      created_at: nowSql(),
      updated_at: nowSql(),
    });
    return { row: getIncidentByDedupeKey(input.dedupeKey)!, created: true, severityEscalated: false };
  }

  const severityEscalated = SEVERITY_RANK[input.severity] > SEVERITY_RANK[existing.severity] && isOpen(existing.status);
  db.prepare(
    `UPDATE incidents SET
      type = @type,
      severity = @severity,
      status = CASE
        WHEN status IN ('repair_blocked', 'repairing', 'repair_ready', 'shipped', 'resolved', 'ignored') THEN status
        ELSE @status
      END,
      title = @title,
      summary = @summary,
      subject_id = @subject_id,
      subject_type = @subject_type,
      source_json = @source_json,
      evidence_json = @evidence_json,
      diagnosis_json = @diagnosis_json,
      updated_at = @updated_at
     WHERE dedupe_key = @dedupe_key`
  ).run({
    dedupe_key: input.dedupeKey,
    type: input.type,
    severity: input.severity,
    status: nextStatus,
    title: input.title,
    summary: input.summary ?? null,
    subject_id: input.subjectId ?? null,
    subject_type: input.subjectType ?? null,
    source_json: json(input.source),
    evidence_json: json(input.evidence),
    diagnosis_json: json(input.diagnosis),
    updated_at: nowSql(),
  });

  return { row: getIncidentByDedupeKey(input.dedupeKey)!, created: false, severityEscalated };
}

export function getIncident(id: string): IncidentRow | undefined {
  const row = getDb().prepare("SELECT * FROM incidents WHERE id = ?").get(id);
  return row ? parseIncidentRow(row) : undefined;
}

export function getIncidentByDedupeKey(dedupeKey: string): IncidentRow | undefined {
  const row = getDb().prepare("SELECT * FROM incidents WHERE dedupe_key = ?").get(dedupeKey);
  return row ? parseIncidentRow(row) : undefined;
}

export function listOpenIncidents(limit = 20): IncidentRow[] {
  const placeholders = OPEN_INCIDENT_STATUSES.map(() => "?").join(", ");
  return getDb()
    .prepare(`SELECT * FROM incidents WHERE status IN (${placeholders}) ORDER BY updated_at DESC, created_at DESC LIMIT ?`)
    .all(...OPEN_INCIDENT_STATUSES, limit) as IncidentRow[];
}

export function countOpenIncidents(): number {
  const placeholders = OPEN_INCIDENT_STATUSES.map(() => "?").join(", ");
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM incidents WHERE status IN (${placeholders})`)
    .get(...OPEN_INCIDENT_STATUSES) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

export function appendIncidentEvent(incidentId: string, eventType: string, payload?: unknown): number {
  const result = getDb().prepare(
    `INSERT INTO incident_events (incident_id, event_type, payload_json)
     VALUES (@incident_id, @event_type, @payload_json)`
  ).run({
    incident_id: incidentId,
    event_type: eventType,
    payload_json: json(payload),
  });
  return Number(result.lastInsertRowid);
}

export function listIncidentEvents(incidentId: string, limit = 20): IncidentEventRow[] {
  return getDb()
    .prepare("SELECT * FROM incident_events WHERE incident_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(incidentId, limit) as IncidentEventRow[];
}

export function markIncidentStatus(id: string, status: IncidentStatus): void {
  getDb().prepare(
    `UPDATE incidents
     SET status = @status,
         updated_at = @updated_at,
         resolved_at = CASE WHEN @status IN ('resolved', 'ignored') THEN @updated_at ELSE resolved_at END
     WHERE id = @id`
  ).run({ id, status, updated_at: nowSql() });
}

export function createRepairRun(row: {
  incidentId: string;
  status: string;
  workspacePath?: string;
  branch?: string;
  baseSha?: string;
}): RepairRunRow {
  const id = randomUUID();
  getDb().prepare(
    `INSERT INTO repair_runs (id, incident_id, status, workspace_path, branch, base_sha)
     VALUES (@id, @incident_id, @status, @workspace_path, @branch, @base_sha)`
  ).run({
    id,
    incident_id: row.incidentId,
    status: row.status,
    workspace_path: row.workspacePath ?? null,
    branch: row.branch ?? null,
    base_sha: row.baseSha ?? null,
  });
  return getRepairRun(id)!;
}

export function updateRepairRun(
  id: string,
  updates: {
    status?: string;
    workspacePath?: string | null;
    branch?: string | null;
    baseSha?: string | null;
    commitSha?: string | null;
    verification?: unknown;
    report?: unknown;
    completedAt?: string | null;
  }
): void {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  const mapping = {
    status: "status",
    workspacePath: "workspace_path",
    branch: "branch",
    baseSha: "base_sha",
    commitSha: "commit_sha",
    completedAt: "completed_at",
  } as const;

  for (const [key, column] of Object.entries(mapping) as Array<[keyof typeof mapping, string]>) {
    if (key in updates) {
      fields.push(`${column} = @${column}`);
      params[column] = updates[key] ?? null;
    }
  }
  if ("verification" in updates) {
    fields.push("verification_json = @verification_json");
    params.verification_json = json(updates.verification);
  }
  if ("report" in updates) {
    fields.push("report_json = @report_json");
    params.report_json = json(updates.report);
  }
  if (!fields.length) return;
  getDb().prepare(`UPDATE repair_runs SET ${fields.join(", ")} WHERE id = @id`).run(params);
}

export function getRepairRun(id: string): RepairRunRow | undefined {
  return getDb().prepare("SELECT * FROM repair_runs WHERE id = ?").get(id) as RepairRunRow | undefined;
}

export function getLatestRepairRunForIncident(incidentId: string): RepairRunRow | undefined {
  return getDb()
    .prepare("SELECT * FROM repair_runs WHERE incident_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(incidentId) as RepairRunRow | undefined;
}

export function countRepairRunsSince(sinceIso: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM repair_runs WHERE created_at >= ?")
    .get(sinceIso) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

export function countRepairRunsByStatus(statuses: readonly string[]): number {
  if (!statuses.length) return 0;
  const placeholders = statuses.map(() => "?").join(", ");
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM repair_runs WHERE status IN (${placeholders})`)
    .get(...statuses) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

export const __testables = {
  STATUS_PRESERVED_ON_REDIAGNOSIS,
};
