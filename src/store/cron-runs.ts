import { randomUUID } from "node:crypto";
import { getDb } from "./connection.js";
import type { CronJobType } from "../cron/types.js";

export const CRON_RUN_STATUSES = [
  "running",
  "success",
  "skipped",
  "failed",
  "retry_scheduled",
  "cancelled",
  "circuit_open",
] as const;

export type CronRunStatus = typeof CRON_RUN_STATUSES[number];

export interface CronRunRow {
  id: string;
  job_name: string;
  job_type: string;
  status: CronRunStatus;
  attempt: number;
  scheduled_at: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  task_id: string | null;
  incident_id: string | null;
  provider_name: string | null;
  provider_status: string | null;
  provider_category: string | null;
  error_category: string | null;
  error_message: string | null;
  alert_message_id: string | null;
  alert_channel_id: string | null;
  metadata_json: string | null;
}

export interface CronRunSummaryRow {
  job_name: string;
  total_runs: number;
  running_runs: number;
  success_runs: number;
  skipped_runs: number;
  failed_runs: number;
  retry_scheduled_runs: number;
  cancelled_runs: number;
  circuit_open_runs: number;
  avg_duration_ms: number | null;
  last_started_at: string;
  last_status: CronRunStatus;
}

export interface CronRunFailureWindow {
  job_name: string;
  failure_count: number;
  latest_failure_at: string | null;
  latest_success_at: string | null;
}

export type CronRunLookupError =
  | { code: "empty_id"; message: string }
  | { code: "not_found"; message: string }
  | { code: "ambiguous_prefix"; message: string; matches: string[] };

export type CronRunLookupResult =
  | { ok: true; value: CronRunRow }
  | { ok: false; error: CronRunLookupError };

export interface CreateCronRunInput {
  id?: string;
  jobName: string;
  jobType: CronJobType;
  attempt?: number;
  scheduledAt?: Date | string | null;
  startedAt?: Date | string;
  taskId?: string | null;
  providerName?: string | null;
  providerStatus?: string | null;
  providerCategory?: string | null;
  metadata?: unknown;
}

export interface CompleteCronRunInput {
  status?: Extract<CronRunStatus, "success" | "skipped" | "cancelled" | "circuit_open">;
  completedAt?: Date | string;
  durationMs?: number;
  taskId?: string | null;
  incidentId?: string | null;
  providerName?: string | null;
  providerStatus?: string | null;
  providerCategory?: string | null;
  errorCategory?: string | null;
  errorMessage?: string | null;
  alertMessageId?: string | null;
  alertChannelId?: string | null;
  metadata?: unknown;
}

export interface FailCronRunInput {
  status?: Extract<CronRunStatus, "failed" | "retry_scheduled">;
  completedAt?: Date | string;
  durationMs?: number;
  taskId?: string | null;
  incidentId?: string | null;
  providerName?: string | null;
  providerStatus?: string | null;
  providerCategory?: string | null;
  errorCategory?: string | null;
  errorMessage?: string | null;
  alertMessageId?: string | null;
  alertChannelId?: string | null;
  metadata?: unknown;
}

export interface ListCronRunsOptions {
  jobName?: string;
  status?: CronRunStatus | CronRunStatus[];
  since?: Date | string;
  until?: Date | string;
  limit?: number;
  offset?: number;
}

export interface SummarizeCronRunsOptions {
  jobName?: string;
  since?: Date | string;
  until?: Date | string;
  limit?: number;
}

type SqlParams = Record<string, unknown>;

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null) return null;
  if (value === undefined) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function json(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function normalizePositiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

function durationMs(startedAt: string, completedAt: string, explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit)) return Math.max(0, Math.floor(explicit));
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return 0;
  return Math.max(0, completed - started);
}

function assertCronRunRow(row: unknown): CronRunRow {
  if (!row || typeof row !== "object" || !("id" in row) || !("status" in row)) {
    throw new Error("Unexpected cron run row shape from database");
  }
  return row as CronRunRow;
}

function whereClause(options: ListCronRunsOptions | SummarizeCronRunsOptions): { sql: string; params: SqlParams } {
  const filters: string[] = [];
  const params: SqlParams = {};

  if (options.jobName) {
    filters.push("job_name = @job_name");
    params.job_name = options.jobName;
  }
  if ("status" in options && options.status !== undefined) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    const placeholders = statuses.map((status, index) => {
      const key = `status_${index}`;
      params[key] = status;
      return `@${key}`;
    });
    if (placeholders.length) filters.push(`status IN (${placeholders.join(", ")})`);
  }
  if (options.since) {
    filters.push("datetime(started_at) >= datetime(@since)");
    params.since = toIso(options.since);
  }
  if (options.until) {
    filters.push("datetime(started_at) <= datetime(@until)");
    params.until = toIso(options.until);
  }

  return {
    sql: filters.length ? `WHERE ${filters.join(" AND ")}` : "",
    params,
  };
}

export function createCronRun(input: CreateCronRunInput): CronRunRow {
  const id = input.id ?? randomUUID();
  getDb().prepare(
    `INSERT INTO cron_runs (
      id, job_name, job_type, status, attempt, scheduled_at, started_at,
      task_id, provider_name, provider_status, provider_category, metadata_json
    ) VALUES (
      @id, @job_name, @job_type, 'running', @attempt, @scheduled_at, @started_at,
      @task_id, @provider_name, @provider_status, @provider_category, @metadata_json
    )`
  ).run({
    id,
    job_name: input.jobName,
    job_type: input.jobType,
    attempt: Math.max(1, Math.floor(input.attempt ?? 1)),
    scheduled_at: toIso(input.scheduledAt ?? null),
    started_at: toIso(input.startedAt) ?? new Date().toISOString(),
    task_id: input.taskId ?? null,
    provider_name: input.providerName ?? null,
    provider_status: input.providerStatus ?? null,
    provider_category: input.providerCategory ?? null,
    metadata_json: json(input.metadata),
  });
  return getCronRun(id)!;
}

export function getCronRun(id: string): CronRunRow | undefined {
  const row = getDb().prepare("SELECT * FROM cron_runs WHERE id = ?").get(id);
  return row ? assertCronRunRow(row) : undefined;
}

export function listCronRunsByIdPrefix(idPrefix: string, limit = 10): CronRunRow[] {
  const prefix = idPrefix.trim();
  if (!prefix) return [];
  return getDb().prepare(
    `SELECT * FROM cron_runs
     WHERE substr(id, 1, @prefix_length) = @prefix
     ORDER BY datetime(started_at) DESC, id DESC
     LIMIT @limit`
  ).all({
    prefix,
    prefix_length: prefix.length,
    limit: normalizePositiveInteger(limit, 10, 50),
  }).map(assertCronRunRow);
}

export function resolveCronRunByIdPrefix(input: string): CronRunLookupResult {
  const id = input.trim();
  if (!id) {
    return {
      ok: false,
      error: { code: "empty_id", message: "cron run id is required" },
    };
  }

  const exact = getCronRun(id);
  if (exact) return { ok: true, value: exact };

  const matches = listCronRunsByIdPrefix(id, 6);
  if (matches.length === 1) return { ok: true, value: matches[0]! };
  if (matches.length > 1) {
    return {
      ok: false,
      error: {
        code: "ambiguous_prefix",
        message: `cron run id prefix "${id}" matched multiple rows`,
        matches: matches.map((row) => row.id),
      },
    };
  }

  return {
    ok: false,
    error: { code: "not_found", message: `cron run not found: ${id}` },
  };
}

function finishCronRun(
  id: string,
  input: (CompleteCronRunInput | FailCronRunInput) & { status: CronRunStatus },
): CronRunRow {
  const existing = getCronRun(id);
  if (!existing) throw new Error(`cron run not found: ${id}`);
  if (existing.completed_at) return existing;

  const completedAt = toIso(input.completedAt) ?? new Date().toISOString();
  getDb().prepare(
    `UPDATE cron_runs SET
      status = @status,
      completed_at = @completed_at,
      duration_ms = @duration_ms,
      task_id = COALESCE(@task_id, task_id),
      incident_id = COALESCE(@incident_id, incident_id),
      provider_name = COALESCE(@provider_name, provider_name),
      provider_status = COALESCE(@provider_status, provider_status),
      provider_category = COALESCE(@provider_category, provider_category),
      error_category = COALESCE(@error_category, error_category),
      error_message = COALESCE(@error_message, error_message),
      alert_message_id = COALESCE(@alert_message_id, alert_message_id),
      alert_channel_id = COALESCE(@alert_channel_id, alert_channel_id),
      metadata_json = COALESCE(@metadata_json, metadata_json)
     WHERE id = @id`
  ).run({
    id,
    status: input.status,
    completed_at: completedAt,
    duration_ms: durationMs(existing.started_at, completedAt, input.durationMs),
    task_id: input.taskId ?? null,
    incident_id: input.incidentId ?? null,
    provider_name: input.providerName ?? null,
    provider_status: input.providerStatus ?? null,
    provider_category: input.providerCategory ?? null,
    error_category: input.errorCategory ?? null,
    error_message: input.errorMessage ?? null,
    alert_message_id: input.alertMessageId ?? null,
    alert_channel_id: input.alertChannelId ?? null,
    metadata_json: json(input.metadata),
  });
  return getCronRun(id)!;
}

export function markCronRunCompleted(id: string, input: CompleteCronRunInput = {}): CronRunRow {
  return finishCronRun(id, { ...input, status: input.status ?? "success" });
}

export function markCronRunFailed(id: string, input: FailCronRunInput = {}): CronRunRow {
  return finishCronRun(id, { ...input, status: input.status ?? "failed" });
}

export function markCronRunAlertDelivered(id: string, input: { messageId: string; channelId: string }): CronRunRow | undefined {
  getDb().prepare(
    `UPDATE cron_runs SET
      alert_message_id = @alert_message_id,
      alert_channel_id = @alert_channel_id
     WHERE id = @id`
  ).run({
    id,
    alert_message_id: input.messageId,
    alert_channel_id: input.channelId,
  });
  return getCronRun(id);
}

export function listCronRuns(options: ListCronRunsOptions = {}): CronRunRow[] {
  const limit = normalizePositiveInteger(options.limit, 20, 500);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const where = whereClause(options);
  return getDb().prepare(
    `SELECT * FROM cron_runs
     ${where.sql}
     ORDER BY datetime(started_at) DESC, id DESC
     LIMIT @limit OFFSET @offset`
  ).all({ ...where.params, limit, offset }).map(assertCronRunRow);
}

export function listCronRunsMissingAlerts(options: { since?: Date | string; until?: Date | string; limit?: number } = {}): CronRunRow[] {
  const filters = [
    "status IN ('failed', 'retry_scheduled')",
    "alert_message_id IS NULL",
  ];
  const params: Record<string, unknown> = {
    limit: normalizePositiveInteger(options.limit, 100, 500),
  };
  if (options.since) {
    filters.push("datetime(COALESCE(completed_at, started_at)) >= datetime(@since)");
    params.since = toIso(options.since);
  }
  if (options.until) {
    filters.push("datetime(COALESCE(completed_at, started_at)) <= datetime(@until)");
    params.until = toIso(options.until);
  }
  return getDb().prepare(
    `SELECT * FROM cron_runs
     WHERE ${filters.join(" AND ")}
     ORDER BY datetime(COALESCE(completed_at, started_at)) ASC, id ASC
     LIMIT @limit`
  ).all(params).map(assertCronRunRow);
}

export function listCronRunsForIncident(incidentId: string, limit = 5): CronRunRow[] {
  const normalized = incidentId.trim();
  if (!normalized) return [];
  return getDb().prepare(
    `SELECT * FROM cron_runs
     WHERE incident_id = @incident_id
     ORDER BY datetime(started_at) DESC, id DESC
     LIMIT @limit`
  ).all({
    incident_id: normalized,
    limit: normalizePositiveInteger(limit, 5, 50),
  }).map(assertCronRunRow);
}

export function summarizeCronRuns(options: SummarizeCronRunsOptions = {}): CronRunSummaryRow[] {
  const limit = normalizePositiveInteger(options.limit, 20, 200);
  const where = whereClause(options);
  return getDb().prepare(
    `WITH filtered AS (
       SELECT * FROM cron_runs ${where.sql}
     ),
     ranked AS (
       SELECT
         *,
         ROW_NUMBER() OVER (PARTITION BY job_name ORDER BY datetime(started_at) DESC, id DESC) AS recency_rank
       FROM filtered
     )
     SELECT
       job_name,
       COUNT(*) AS total_runs,
       SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_runs,
       SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_runs,
       SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_runs,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_runs,
       SUM(CASE WHEN status = 'retry_scheduled' THEN 1 ELSE 0 END) AS retry_scheduled_runs,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_runs,
       SUM(CASE WHEN status = 'circuit_open' THEN 1 ELSE 0 END) AS circuit_open_runs,
       AVG(duration_ms) AS avg_duration_ms,
       MAX(CASE WHEN recency_rank = 1 THEN started_at ELSE NULL END) AS last_started_at,
       MAX(CASE WHEN recency_rank = 1 THEN status ELSE NULL END) AS last_status
     FROM ranked
     GROUP BY job_name
     ORDER BY datetime(last_started_at) DESC, job_name ASC
     LIMIT @limit`
  ).all({ ...where.params, limit }).map((row) => row as CronRunSummaryRow);
}

export function getCronRunFailureWindow(jobName: string, since: Date | string): CronRunFailureWindow {
  const sinceIso = toIso(since);
  const latestSuccess = getDb().prepare(
    `SELECT COALESCE(completed_at, started_at) AS at
     FROM cron_runs
     WHERE job_name = @job_name
       AND status = 'success'
     ORDER BY COALESCE(completed_at, started_at) DESC, id DESC
     LIMIT 1`
  ).get({ job_name: jobName }) as { at: string } | undefined;
  const latestSuccessAt = latestSuccess?.at ?? null;
  const row = getDb().prepare(
    `SELECT
       COUNT(*) AS failure_count,
       MAX(COALESCE(completed_at, started_at)) AS latest_failure_at
     FROM cron_runs
     WHERE job_name = @job_name
       AND status IN ('failed', 'retry_scheduled')
       AND COALESCE(completed_at, started_at) >= @since
       AND (@latest_success_at IS NULL OR COALESCE(completed_at, started_at) > @latest_success_at)`
  ).get({
    job_name: jobName,
    since: sinceIso,
    latest_success_at: latestSuccessAt,
  }) as { failure_count: number; latest_failure_at: string | null };
  return {
    job_name: jobName,
    failure_count: row.failure_count,
    latest_failure_at: row.latest_failure_at,
    latest_success_at: latestSuccessAt,
  };
}
