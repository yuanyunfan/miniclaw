import type Database from "better-sqlite3";

const DAY_MS = 24 * 60 * 60 * 1000;

export const STATE_CLEANUP_SCOPES = [
  "chat_history",
  "task_events",
  "smart_router_decisions",
  "incidents",
  "repair_runs",
  "market_forecasts",
] as const;

export type StateCleanupScope = typeof STATE_CLEANUP_SCOPES[number];

export interface StateRetentionConfig {
  chatHistoryDays: number;
  taskEventsDays: number;
  smartRouterDecisionsDays: number;
  incidentsDays: number;
  repairRunsDays: number;
  marketForecastsDays: number;
  dryRunDefault: boolean;
}

export interface StateCleanupOptions {
  retention: StateRetentionConfig;
  dryRun?: boolean;
  scope?: StateCleanupScope;
  olderThanDays?: number;
  now?: Date;
}

export interface StateCleanupTargetReport {
  id: string;
  scope: StateCleanupScope;
  table: string;
  retentionDays: number;
  cutoffIso: string;
  candidateCount: number;
  deletedCount: number;
  oldest: string | null;
  newest: string | null;
  sqlSummary: string;
}

export interface StateCleanupReport {
  dryRun: boolean;
  scope?: StateCleanupScope;
  olderThanDays?: number;
  nowIso: string;
  targets: StateCleanupTargetReport[];
  totalCandidateCount: number;
  totalDeletedCount: number;
}

interface CleanupTargetSpec {
  id: string;
  scope: StateCleanupScope;
  table: string;
  retentionDays: number;
  cutoffIso: string;
  candidateSelectSql: string;
  deleteSql: string;
  sqlSummary: string;
}

interface CandidateSummaryRow {
  count?: number;
  oldest?: string | null;
  newest?: string | null;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function isStateCleanupScope(value: string): value is StateCleanupScope {
  return (STATE_CLEANUP_SCOPES as readonly string[]).includes(value);
}

function cutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function retentionDaysForScope(retention: StateRetentionConfig, scope: StateCleanupScope): number {
  switch (scope) {
    case "chat_history":
      return retention.chatHistoryDays;
    case "task_events":
      return retention.taskEventsDays;
    case "smart_router_decisions":
      return retention.smartRouterDecisionsDays;
    case "incidents":
      return retention.incidentsDays;
    case "repair_runs":
      return retention.repairRunsDays;
    case "market_forecasts":
      return retention.marketForecastsDays;
  }
}

function makeTarget(
  input: Omit<CleanupTargetSpec, "retentionDays" | "cutoffIso">,
  retention: StateRetentionConfig,
  now: Date,
  olderThanDays?: number,
): CleanupTargetSpec {
  const retentionDays = olderThanDays ?? retentionDaysForScope(retention, input.scope);
  assertPositiveInteger(retentionDays, `${input.scope} retention days`);
  return {
    ...input,
    retentionDays,
    cutoffIso: cutoffIso(now, retentionDays),
  };
}

function allTargetSpecs(
  retention: StateRetentionConfig,
  now: Date,
  olderThanDays?: number,
): CleanupTargetSpec[] {
  return [
    makeTarget({
      id: "chat_history",
      scope: "chat_history",
      table: "chat_history",
      candidateSelectSql: "SELECT created_at AS candidate_at FROM chat_history WHERE datetime(created_at) < datetime(@cutoff)",
      deleteSql: "DELETE FROM chat_history WHERE datetime(created_at) < datetime(@cutoff)",
      sqlSummary: "delete chat messages older than the retention cutoff",
    }, retention, now, olderThanDays),
    makeTarget({
      id: "task_events",
      scope: "task_events",
      table: "task_events",
      candidateSelectSql: "SELECT created_at AS candidate_at FROM task_events WHERE datetime(created_at) < datetime(@cutoff)",
      deleteSql: "DELETE FROM task_events WHERE datetime(created_at) < datetime(@cutoff)",
      sqlSummary: "delete task trace events older than the retention cutoff",
    }, retention, now, olderThanDays),
    makeTarget({
      id: "smart_router_decisions",
      scope: "smart_router_decisions",
      table: "smart_router_decisions",
      candidateSelectSql: "SELECT created_at AS candidate_at FROM smart_router_decisions WHERE datetime(created_at) < datetime(@cutoff)",
      deleteSql: "DELETE FROM smart_router_decisions WHERE datetime(created_at) < datetime(@cutoff)",
      sqlSummary: "delete Smart Router decisions older than the retention cutoff",
    }, retention, now, olderThanDays),
    makeTarget({
      id: "incident_events",
      scope: "incidents",
      table: "incident_events",
      candidateSelectSql: [
        "SELECT e.created_at AS candidate_at FROM incident_events e",
        "WHERE datetime(e.created_at) < datetime(@cutoff)",
        "AND (",
        "NOT EXISTS (SELECT 1 FROM incidents i WHERE i.id = e.incident_id)",
        "OR EXISTS (SELECT 1 FROM incidents i WHERE i.id = e.incident_id AND i.status IN ('shipped', 'resolved', 'ignored'))",
        ")",
      ].join(" "),
      deleteSql: [
        "DELETE FROM incident_events",
        "WHERE datetime(created_at) < datetime(@cutoff)",
        "AND (",
        "NOT EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_events.incident_id)",
        "OR EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_events.incident_id AND i.status IN ('shipped', 'resolved', 'ignored'))",
        ")",
      ].join(" "),
      sqlSummary: "delete old incident events only for closed or orphan incidents",
    }, retention, now, olderThanDays),
    makeTarget({
      id: "repair_runs",
      scope: "repair_runs",
      table: "repair_runs",
      candidateSelectSql: [
        "SELECT r.created_at AS candidate_at FROM repair_runs r",
        "WHERE datetime(r.created_at) < datetime(@cutoff)",
        "AND (",
        "NOT EXISTS (SELECT 1 FROM incidents i WHERE i.id = r.incident_id)",
        "OR EXISTS (SELECT 1 FROM incidents i WHERE i.id = r.incident_id AND i.status IN ('shipped', 'resolved', 'ignored'))",
        ")",
      ].join(" "),
      deleteSql: [
        "DELETE FROM repair_runs",
        "WHERE datetime(created_at) < datetime(@cutoff)",
        "AND (",
        "NOT EXISTS (SELECT 1 FROM incidents i WHERE i.id = repair_runs.incident_id)",
        "OR EXISTS (SELECT 1 FROM incidents i WHERE i.id = repair_runs.incident_id AND i.status IN ('shipped', 'resolved', 'ignored'))",
        ")",
      ].join(" "),
      sqlSummary: "delete old repair runs only for closed or orphan incidents",
    }, retention, now, olderThanDays),
    makeTarget({
      id: "incidents",
      scope: "incidents",
      table: "incidents",
      candidateSelectSql: [
        "SELECT updated_at AS candidate_at FROM incidents",
        "WHERE status IN ('shipped', 'resolved', 'ignored')",
        "AND datetime(updated_at) < datetime(@cutoff)",
        "AND NOT EXISTS (SELECT 1 FROM incident_events e WHERE e.incident_id = incidents.id)",
        "AND NOT EXISTS (SELECT 1 FROM repair_runs r WHERE r.incident_id = incidents.id)",
      ].join(" "),
      deleteSql: [
        "DELETE FROM incidents",
        "WHERE status IN ('shipped', 'resolved', 'ignored')",
        "AND datetime(updated_at) < datetime(@cutoff)",
        "AND NOT EXISTS (SELECT 1 FROM incident_events e WHERE e.incident_id = incidents.id)",
        "AND NOT EXISTS (SELECT 1 FROM repair_runs r WHERE r.incident_id = incidents.id)",
      ].join(" "),
      sqlSummary: "delete closed incidents older than the retention cutoff after child rows are gone",
    }, retention, now, olderThanDays),
    makeTarget({
      id: "market_forecast_items",
      scope: "market_forecasts",
      table: "market_forecast_items",
      candidateSelectSql: [
        "SELECT i.created_at AS candidate_at FROM market_forecast_items i",
        "WHERE i.forecast_id IN (",
        "SELECT f.id FROM market_forecasts f WHERE datetime(f.generated_at) < datetime(@cutoff)",
        ")",
      ].join(" "),
      deleteSql: [
        "DELETE FROM market_forecast_items",
        "WHERE forecast_id IN (",
        "SELECT id FROM market_forecasts WHERE datetime(generated_at) < datetime(@cutoff)",
        ")",
      ].join(" "),
      sqlSummary: "delete forecast items for forecasts older than the retention cutoff",
    }, retention, now, olderThanDays),
    makeTarget({
      id: "market_forecast_evaluations",
      scope: "market_forecasts",
      table: "market_forecast_evaluations",
      candidateSelectSql: [
        "SELECT e.created_at AS candidate_at FROM market_forecast_evaluations e",
        "WHERE e.forecast_id IN (",
        "SELECT f.id FROM market_forecasts f WHERE datetime(f.generated_at) < datetime(@cutoff)",
        ")",
      ].join(" "),
      deleteSql: [
        "DELETE FROM market_forecast_evaluations",
        "WHERE forecast_id IN (",
        "SELECT id FROM market_forecasts WHERE datetime(generated_at) < datetime(@cutoff)",
        ")",
      ].join(" "),
      sqlSummary: "delete forecast evaluations for forecasts older than the retention cutoff",
    }, retention, now, olderThanDays),
    makeTarget({
      id: "market_forecasts",
      scope: "market_forecasts",
      table: "market_forecasts",
      candidateSelectSql: "SELECT generated_at AS candidate_at FROM market_forecasts WHERE datetime(generated_at) < datetime(@cutoff)",
      deleteSql: "DELETE FROM market_forecasts WHERE datetime(generated_at) < datetime(@cutoff)",
      sqlSummary: "delete market forecasts older than the retention cutoff",
    }, retention, now, olderThanDays),
  ];
}

function selectedSpecs(options: StateCleanupOptions): CleanupTargetSpec[] {
  const now = options.now ?? new Date();
  const specs = allTargetSpecs(options.retention, now, options.olderThanDays);
  return options.scope ? specs.filter((spec) => spec.scope === options.scope) : specs;
}

export function buildStateCleanupPlan(options: StateCleanupOptions): Omit<StateCleanupTargetReport, "candidateCount" | "deletedCount" | "oldest" | "newest">[] {
  return selectedSpecs(options).map((spec) => ({
    id: spec.id,
    scope: spec.scope,
    table: spec.table,
    retentionDays: spec.retentionDays,
    cutoffIso: spec.cutoffIso,
    sqlSummary: spec.sqlSummary,
  }));
}

function inspectTarget(db: Database.Database, spec: CleanupTargetSpec): Pick<StateCleanupTargetReport, "candidateCount" | "oldest" | "newest"> {
  const row = db
    .prepare(`SELECT COUNT(*) AS count, MIN(candidate_at) AS oldest, MAX(candidate_at) AS newest FROM (${spec.candidateSelectSql})`)
    .get({ cutoff: spec.cutoffIso }) as CandidateSummaryRow | undefined;
  return {
    candidateCount: Number(row?.count ?? 0),
    oldest: row?.oldest ?? null,
    newest: row?.newest ?? null,
  };
}

function cleanupTargets(db: Database.Database, specs: CleanupTargetSpec[]): StateCleanupTargetReport[] {
  const reports: StateCleanupTargetReport[] = [];
  for (const spec of specs) {
    const inspected = inspectTarget(db, spec);
    const result = db.prepare(spec.deleteSql).run({ cutoff: spec.cutoffIso });
    reports.push({
      id: spec.id,
      scope: spec.scope,
      table: spec.table,
      retentionDays: spec.retentionDays,
      cutoffIso: spec.cutoffIso,
      ...inspected,
      deletedCount: Number(result.changes ?? 0),
      sqlSummary: spec.sqlSummary,
    });
  }
  return reports;
}

function runDryCleanup(db: Database.Database, specs: CleanupTargetSpec[]): StateCleanupTargetReport[] {
  db.exec("SAVEPOINT state_cleanup_dry_run");
  try {
    const reports = cleanupTargets(db, specs);
    db.exec("ROLLBACK TO state_cleanup_dry_run");
    db.exec("RELEASE state_cleanup_dry_run");
    return reports;
  } catch (err) {
    try {
      db.exec("ROLLBACK TO state_cleanup_dry_run");
    } finally {
      db.exec("RELEASE state_cleanup_dry_run");
    }
    throw err;
  }
}

export function runStateCleanup(db: Database.Database, options: StateCleanupOptions): StateCleanupReport {
  if (options.olderThanDays !== undefined) {
    assertPositiveInteger(options.olderThanDays, "olderThanDays");
  }
  const dryRun = options.dryRun ?? options.retention.dryRunDefault;
  const now = options.now ?? new Date();
  const specs = selectedSpecs({ ...options, now });
  const targets = dryRun
    ? runDryCleanup(db, specs)
    : db.transaction(() => cleanupTargets(db, specs))();
  return {
    dryRun,
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.olderThanDays !== undefined ? { olderThanDays: options.olderThanDays } : {}),
    nowIso: now.toISOString(),
    targets,
    totalCandidateCount: targets.reduce((sum, target) => sum + target.candidateCount, 0),
    totalDeletedCount: targets.reduce((sum, target) => sum + target.deletedCount, 0),
  };
}

export function formatStateCleanupReport(report: StateCleanupReport): string {
  const mode = report.dryRun ? "dry-run" : "execute";
  const scopeText = report.scope ? `scope: ${report.scope}` : "scope: all";
  const overrideText = report.olderThanDays ? `older_than_days: ${report.olderThanDays}` : "older_than_days: config";
  const rows = report.targets.map((target) => [
    `- ${target.id}: ${target.candidateCount} candidate(s), ${report.dryRun ? "would delete" : "deleted"} ${target.deletedCount}`,
    `  table: ${target.table}`,
    `  retention: ${target.retentionDays}d, cutoff: ${target.cutoffIso}`,
    `  oldest/newest: ${target.oldest ?? "-"} / ${target.newest ?? "-"}`,
    `  rule: ${target.sqlSummary}`,
  ].join("\n"));

  return [
    `State cleanup ${mode}`,
    scopeText,
    overrideText,
    `now: ${report.nowIso}`,
    `total_candidates: ${report.totalCandidateCount}`,
    `${report.dryRun ? "total_would_delete" : "total_deleted"}: ${report.totalDeletedCount}`,
    "",
    ...rows,
    "",
  ].join("\n");
}
