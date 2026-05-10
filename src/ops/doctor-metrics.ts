import { config } from "../config.js";
import { getDb } from "../store/db.js";

interface RepairMetricRow {
  id: string;
  incident_id: string;
  status: string;
  verification_json: string | null;
  report_json: string | null;
  created_at: string;
  completed_at: string | null;
  incident_type: string | null;
  category: string | null;
}

export interface DoctorRepairMetrics {
  sinceIso: string;
  attempts: number;
  successful: number;
  blocked: number;
  verificationFailed: number;
  pushed: number;
  shipped: number;
  possibleRegressionIncidents: number;
  byStatus: Record<string, number>;
  byIncidentType: Record<string, number>;
  byCategory: Record<string, number>;
  averageChangedFiles: number | null;
  averageGateDurationMs: number | null;
  promotion: {
    eligible: boolean;
    blockers: string[];
  };
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function increment(map: Record<string, number>, key: string | null | undefined): void {
  const normalized = key?.trim() || "unknown";
  map[normalized] = (map[normalized] ?? 0) + 1;
}

function changedFileCount(row: RepairMetricRow): number | undefined {
  const report = parseJsonObject(row.report_json);
  const files = report.changedFiles;
  return Array.isArray(files) ? files.length : undefined;
}

function gateDurationMs(row: RepairMetricRow): number | undefined {
  const verification = parseJsonArray(row.verification_json);
  const total = verification.reduce<number>((sum, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return sum;
    const record = item as Record<string, unknown>;
    const duration = Number(record.durationMs ?? record.duration_ms);
    return Number.isFinite(duration) ? sum + duration : sum;
  }, 0);
  return total > 0 ? total : undefined;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function collectRows(sinceIso: string, limit: number): RepairMetricRow[] {
  return getDb()
    .prepare(`
      SELECT
        rr.id,
        rr.incident_id,
        rr.status,
        rr.verification_json,
        rr.report_json,
        rr.created_at,
        rr.completed_at,
        i.type AS incident_type,
        json_extract(i.diagnosis_json, '$.category') AS category
      FROM repair_runs rr
      LEFT JOIN incidents i ON i.id = rr.incident_id
      WHERE datetime(rr.created_at) >= datetime(?)
      ORDER BY rr.created_at DESC, rr.id DESC
      LIMIT ?
    `)
    .all(sinceIso, limit) as RepairMetricRow[];
}

function countShippedRepairsSince(sinceIso: string): number {
  const row = getDb()
    .prepare(`
      SELECT COUNT(DISTINCT incident_id) AS count
      FROM incident_events
      WHERE event_type = 'repair_main_updated'
        AND datetime(created_at) >= datetime(?)
    `)
    .get(sinceIso) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

function countPossibleRegressionIncidents(sinceIso: string): number {
  const row = getDb()
    .prepare(`
      WITH shipped AS (
        SELECT incident_id, created_at
        FROM incident_events
        WHERE event_type = 'repair_main_updated'
          AND datetime(created_at) >= datetime(?)
      )
      SELECT COUNT(DISTINCT i.id) AS count
      FROM shipped s
      JOIN incidents i
        ON i.id <> s.incident_id
       AND datetime(i.created_at) >= datetime(s.created_at)
       AND datetime(i.created_at) <= datetime(s.created_at, '+72 hours')
       AND i.type IN ('task_failed', 'cron_failed', 'chat_error')
    `)
    .get(sinceIso) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

function evaluatePromotionPolicy(metrics: Omit<DoctorRepairMetrics, "promotion">): DoctorRepairMetrics["promotion"] {
  const blockers: string[] = [];
  if (config.doctor.requireApprovalForMain) {
    blockers.push("doctor.require_approval_for_main is still enabled");
  }
  if (metrics.successful < 5) {
    blockers.push(`successful repairs ${metrics.successful}/5`);
  }
  if (metrics.blocked > 0 || metrics.verificationFailed > 0) {
    blockers.push("recent blocked or verification-failed repairs exist");
  }
  if (metrics.possibleRegressionIncidents > 0) {
    blockers.push(`possible post-ship regression incidents: ${metrics.possibleRegressionIncidents}`);
  }
  blockers.push("live restart must continue to use safe-restart without --force");
  return { eligible: false, blockers };
}

export function collectRepairMetrics(options: { sinceDays?: number; limit?: number; now?: Date } = {}): DoctorRepairMetrics {
  const now = options.now ?? new Date();
  const sinceDays = options.sinceDays ?? 14;
  const sinceIso = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = collectRows(sinceIso, options.limit ?? 100);
  const shipped = countShippedRepairsSince(sinceIso);
  const possibleRegressionIncidents = countPossibleRegressionIncidents(sinceIso);
  const byStatus: Record<string, number> = {};
  const byIncidentType: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const changedCounts: number[] = [];
  const gateDurations: number[] = [];

  for (const row of rows) {
    increment(byStatus, row.status);
    increment(byIncidentType, row.incident_type);
    increment(byCategory, row.category);
    const changed = changedFileCount(row);
    if (changed !== undefined) changedCounts.push(changed);
    const duration = gateDurationMs(row);
    if (duration !== undefined) gateDurations.push(duration);
  }

  const metrics = {
    sinceIso,
    attempts: rows.length,
    successful: rows.filter((row) => ["repair_ready", "repair_pushed"].includes(row.status)).length,
    blocked: rows.filter((row) => ["blocked", "commit_failed", "push_failed"].includes(row.status)).length,
    verificationFailed: rows.filter((row) => row.status === "verification_failed").length,
    pushed: rows.filter((row) => row.status === "repair_pushed").length,
    shipped,
    possibleRegressionIncidents,
    byStatus,
    byIncidentType,
    byCategory,
    averageChangedFiles: average(changedCounts),
    averageGateDurationMs: average(gateDurations),
  };
  return { ...metrics, promotion: evaluatePromotionPolicy(metrics) };
}

function compactCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "-";
}

function formatMs(value: number | null): string {
  if (value === null) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

export function formatRepairMetrics(metrics: DoctorRepairMetrics): string {
  return [
    "Repair Metrics",
    `- window_since: ${metrics.sinceIso}`,
    `- attempts/successful/pushed: ${metrics.attempts}/${metrics.successful}/${metrics.pushed}`,
    `- shipped/possible_regressions_72h: ${metrics.shipped}/${metrics.possibleRegressionIncidents}`,
    `- blocked/verification_failed: ${metrics.blocked}/${metrics.verificationFailed}`,
    `- by_status: ${compactCounts(metrics.byStatus)}`,
    `- by_type: ${compactCounts(metrics.byIncidentType)}`,
    `- by_category: ${compactCounts(metrics.byCategory)}`,
    `- avg_changed_files: ${metrics.averageChangedFiles === null ? "-" : metrics.averageChangedFiles.toFixed(1)}`,
    `- avg_gate_duration: ${formatMs(metrics.averageGateDurationMs)}`,
    "Promotion Policy",
    `- approval_relaxation_eligible: ${metrics.promotion.eligible ? "yes" : "no"}`,
    ...metrics.promotion.blockers.slice(0, 4).map((blocker) => `- blocker: ${blocker}`),
  ].join("\n");
}
