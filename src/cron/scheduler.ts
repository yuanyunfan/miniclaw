import cron, { type ScheduledTask } from "node-cron";
import type { Client } from "discord.js";
import { randomUUID } from "node:crypto";
import { loadCronJobs } from "./loader.js";
import { runTask, runSkill } from "./runner-task.js";
import { runMessage } from "./runner-message.js";
import { runScript } from "./runner-script.js";
import { recordRun, getAllJobStates, updateJobState, type JobState } from "./state.js";
import type { CronJob, CronJobRunContext, CronJobRunOutcome } from "./types.js";
import {
  sanitizeCronError,
  sendOrUpdateCronFailureAlert,
  updateCronRecoveredAlert,
  type CronFailureAlertRef,
} from "./failure-notifier.js";
import { config } from "../config.js";
import { createLogger } from "../lib/log.js";
import { loadConnectivityState } from "../monitoring/connectivity-core.js";
import { enqueueCronFailureRecovery } from "../monitoring/recovery-outbox.js";
import { DRAINING_MESSAGE, isDraining } from "../runtime/shutdown.js";
import {
  createCronRun,
  getCronRunFailureWindow,
  hasCronRunForSchedule,
  markCronRunCompleted,
  markCronRunFailed,
  type CronRunStatus,
  type CronRunRow,
} from "../store/cron-runs.js";
import { appendIncidentEvent, createOrUpdateIncident } from "../store/incidents.js";

const log = createLogger("cron");

const tasks = new Map<string, ScheduledTask[]>();
const runningJobCounts = new Map<string, number>();
const retryWaiters = new Map<string, { runId: string; wake: () => void }>();
const runningMissedCatchUps = new Set<string>();
let missedRunAuditTimer: NodeJS.Timeout | undefined;
let missedRunAuditRunning = false;

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_FIRST_RETRY_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_BACKOFF_MULTIPLIER = 2;
const MINUTE_MS = 60 * 1000;
const DEFAULT_MISSED_RUN_AUDIT_INTERVAL_MS = 60 * 1000;
const DEFAULT_MISSED_RUN_GRACE_MS = 2 * MINUTE_MS;
const DEFAULT_MISSED_RUN_LOOKBACK_MS = 6 * 60 * MINUTE_MS;
const DEFAULT_MISSED_RUN_MAX_RECORDS = 1;
const DEFAULT_MISSED_RUN_MAX_CATCH_UP = 1;
const MAX_MISSED_RUN_LOOKBACK_MS = 24 * 60 * MINUTE_MS;
const MAX_MISSED_RUN_RECORDS = 50;
const MAX_MISSED_RUN_CATCH_UP = 10;
const SCHEDULE_LOOKUP_TOLERANCE_MS = 29 * 1000;

type RetryPolicy = {
  maxAttempts: number;
  firstDelayMs: number;
  backoffMultiplier: number;
  sleep: (ms: number) => Promise<void>;
};

type DispatchOptions = {
  notifyFailures?: boolean;
  failureAlert?: CronFailureAlertRef;
  scheduledAt?: Date;
};

type CronRetryBeforeRun = (pending: { status: "woke" | "started"; jobName: string }) => Promise<void>;

type CronRetryRequestOptions = {
  beforeRun?: CronRetryBeforeRun;
  failureAlert?: CronFailureAlertRef;
};

type CronControlBlock = {
  status: Extract<CronRunStatus, "skipped" | "circuit_open">;
  category: "cooldown" | "circuit_open";
  message: string;
  nextAllowedAt: Date;
  metadata: Record<string, unknown>;
};

type NormalizedMissedRunConfig = {
  enabled: boolean;
  graceMs: number;
  lookbackMs: number;
  maxRecords: number;
  catchUp: boolean;
  maxCatchUp: number;
};

type CronFieldMatcher = {
  any: boolean;
  values: Set<number>;
};

type ParsedCronSchedule = {
  minute: CronFieldMatcher;
  hour: CronFieldMatcher;
  dayOfMonth: CronFieldMatcher;
  month: CronFieldMatcher;
  dayOfWeek: CronFieldMatcher;
};

export type MissedRunAuditResult = {
  checked: number;
  missed: CronRunRow[];
  catchUpsStarted: number;
  unsupportedSchedules: string[];
};

export type CronRetryRequestResult =
  | { ok: true; status: "woke" | "started"; jobName: string }
  | { ok: false; reason: "not_found" | "disabled" | "already_running"; message: string; jobName?: string };

class CronJobTimeoutError extends Error {
  taskId?: string;
  readonly timeoutMs: number;
  readonly errorCategory = "cron_timeout";

  constructor(jobName: string, timeoutMs: number, taskId?: string) {
    super(`${jobName} timed out after ${timeoutMs}ms`);
    this.name = "CronJobTimeoutError";
    this.timeoutMs = timeoutMs;
    this.taskId = taskId;
  }
}

const sleepMs = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
};

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  firstDelayMs: DEFAULT_FIRST_RETRY_DELAY_MS,
  backoffMultiplier: DEFAULT_RETRY_BACKOFF_MULTIPLIER,
  sleep: sleepMs,
};

const NO_RETRY_POLICY: RetryPolicy = {
  ...DEFAULT_RETRY_POLICY,
  maxAttempts: 1,
};

function normalizeRetryPolicy(policy: RetryPolicy): RetryPolicy {
  return {
    ...policy,
    maxAttempts: Math.max(1, Math.floor(policy.maxAttempts)),
    firstDelayMs: Math.max(0, Math.floor(policy.firstDelayMs)),
    backoffMultiplier: Math.max(1, policy.backoffMultiplier),
  };
}

function getRetryDelayMs(policy: RetryPolicy, failedAttempt: number): number {
  return Math.floor(policy.firstDelayMs * Math.pow(policy.backoffMultiplier, failedAttempt - 1));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0 && seconds > 0) return `${minutes}m${seconds}s`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function alertMetadata(ref: CronFailureAlertRef | undefined): Partial<JobState> {
  return {
    ...(ref?.messageId ? { failure_alert_message_id: ref.messageId } : {}),
    ...(ref?.channelId ? { failure_alert_channel_id: ref.channelId } : {}),
  };
}

function getJobMaxConcurrency(job: CronJob): number {
  const raw = job.max_concurrency ?? 1;
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.floor(raw));
}

function subtractMs(date: Date, ms: number): Date {
  return new Date(date.getTime() - ms);
}

function addMs(value: string, ms: number): Date | undefined {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp + ms);
}

function getCronControlBlock(job: CronJob, now = new Date()): CronControlBlock | undefined {
  const circuit = job.circuit_breaker;
  if (circuit?.enabled) {
    const failureWindow = getCronRunFailureWindow(job.name, subtractMs(now, circuit.window_ms));
    const openUntil = failureWindow.latest_failure_at
      ? addMs(failureWindow.latest_failure_at, circuit.open_ms)
      : undefined;
    if (
      openUntil
      && openUntil.getTime() > now.getTime()
      && failureWindow.failure_count >= circuit.failure_threshold
    ) {
      return {
        status: "circuit_open",
        category: "circuit_open",
        message: `${job.name} skipped: circuit breaker open until ${openUntil.toISOString()}`,
        nextAllowedAt: openUntil,
        metadata: {
          open_until: openUntil.toISOString(),
          failure_count: failureWindow.failure_count,
          failure_threshold: circuit.failure_threshold,
          window_ms: circuit.window_ms,
          open_ms: circuit.open_ms,
          latest_failure_at: failureWindow.latest_failure_at,
          latest_success_at: failureWindow.latest_success_at,
        },
      };
    }
  }

  const cooldown = job.cooldown;
  if (cooldown) {
    const failureWindow = getCronRunFailureWindow(job.name, subtractMs(now, cooldown.after_failure_ms));
    const cooldownUntil = failureWindow.latest_failure_at
      ? addMs(failureWindow.latest_failure_at, cooldown.after_failure_ms)
      : undefined;
    if (cooldownUntil && cooldownUntil.getTime() > now.getTime()) {
      return {
        status: "skipped",
        category: "cooldown",
        message: `${job.name} skipped: cooldown active until ${cooldownUntil.toISOString()}`,
        nextAllowedAt: cooldownUntil,
        metadata: {
          cooldown_until: cooldownUntil.toISOString(),
          after_failure_ms: cooldown.after_failure_ms,
          failure_count: failureWindow.failure_count,
          latest_failure_at: failureWindow.latest_failure_at,
          latest_success_at: failureWindow.latest_success_at,
        },
      };
    }
  }

  return undefined;
}

function getRunningJobCount(jobName: string): number {
  return runningJobCounts.get(jobName) ?? 0;
}

function tryAcquireJobSlot(job: CronJob): boolean {
  const count = getRunningJobCount(job.name);
  if (count >= getJobMaxConcurrency(job)) return false;
  runningJobCounts.set(job.name, count + 1);
  return true;
}

function releaseJobSlot(jobName: string): void {
  const count = getRunningJobCount(jobName);
  if (count <= 1) {
    runningJobCounts.delete(jobName);
    return;
  }
  runningJobCounts.set(jobName, count - 1);
}

async function waitForRetryDelay(
  jobName: string,
  runId: string,
  retryDelayMs: number,
  sleep: (ms: number) => Promise<void>
): Promise<void> {
  let wake!: () => void;
  const wakePromise = new Promise<void>((resolve) => {
    wake = resolve;
  });
  retryWaiters.set(jobName, { runId, wake });
  try {
    await Promise.race([sleep(retryDelayMs), wakePromise]);
  } finally {
    const current = retryWaiters.get(jobName);
    if (current?.runId === runId) retryWaiters.delete(jobName);
  }
}

function errorCategory(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  return "unknown_error";
}

function errorMessage(err: unknown): string {
  return sanitizeCronError(err instanceof Error ? err.message : String(err), 1500);
}

function safeConnectivitySnapshot() {
  try {
    return loadConnectivityState(config.connectivity.statePath);
  } catch {
    return undefined;
  }
}

const MONTH_ALIASES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const WEEKDAY_ALIASES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeMissedRunConfig(job: CronJob): NormalizedMissedRunConfig {
  const maxRecords = clampInteger(
    job.missed_run?.max_records,
    DEFAULT_MISSED_RUN_MAX_RECORDS,
    1,
    MAX_MISSED_RUN_RECORDS,
  );
  return {
    enabled: job.missed_run?.enabled !== false,
    graceMs: clampInteger(job.missed_run?.grace_ms, DEFAULT_MISSED_RUN_GRACE_MS, 0, MAX_MISSED_RUN_LOOKBACK_MS),
    lookbackMs: clampInteger(
      job.missed_run?.lookback_ms,
      DEFAULT_MISSED_RUN_LOOKBACK_MS,
      MINUTE_MS,
      MAX_MISSED_RUN_LOOKBACK_MS,
    ),
    maxRecords,
    catchUp: job.missed_run?.catch_up === true,
    maxCatchUp: Math.min(
      maxRecords,
      clampInteger(job.missed_run?.max_catch_up, DEFAULT_MISSED_RUN_MAX_CATCH_UP, 1, MAX_MISSED_RUN_CATCH_UP),
    ),
  };
}

function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function parseCronValue(
  raw: string,
  aliases: Record<string, number> | undefined,
  normalize: (value: number) => number,
): number | undefined {
  const upper = raw.trim().toUpperCase();
  const aliased = aliases?.[upper];
  if (aliased !== undefined) return normalize(aliased);
  if (!/^\d+$/.test(upper)) return undefined;
  return normalize(Number(upper));
}

function buildFullValueSet(min: number, max: number, normalize: (value: number) => number): Set<number> {
  const values = new Set<number>();
  for (let value = min; value <= max; value++) values.add(normalize(value));
  return values;
}

function parseCronField(
  rawField: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
  normalize: (value: number) => number = (value) => value,
): CronFieldMatcher | undefined {
  const values = new Set<number>();
  const fullSet = buildFullValueSet(min, max, normalize);
  const field = rawField.trim();
  if (!field) return undefined;

  for (const rawPart of field.split(",")) {
    const part = rawPart.trim();
    if (!part) return undefined;
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return undefined;

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart?.includes("-")) {
      const [rawStart, rawEnd] = rangePart.split("-");
      const parsedStart = parseCronValue(rawStart ?? "", aliases, (value) => value);
      const parsedEnd = parseCronValue(rawEnd ?? "", aliases, (value) => value);
      if (parsedStart === undefined || parsedEnd === undefined) return undefined;
      start = parsedStart;
      end = parsedEnd;
    } else if (rangePart) {
      const parsed = parseCronValue(rangePart, aliases, (value) => value);
      if (parsed === undefined) return undefined;
      start = parsed;
      end = stepPart === undefined ? parsed : max;
    } else {
      return undefined;
    }

    if (start < min || end > max || start > end) return undefined;
    for (let value = start; value <= end; value += step) {
      values.add(normalize(value));
    }
  }

  for (const value of values) {
    if (!fullSet.has(value)) return undefined;
  }
  const any = values.size === fullSet.size && [...fullSet].every((value) => values.has(value));
  return { any, values };
}

function parseCronScheduleForAudit(schedule: string): ParsedCronSchedule | undefined {
  let fields = schedule.trim().split(/\s+/);
  if (fields.length === 6) {
    const seconds = fields[0];
    if (seconds !== "0") return undefined;
    fields = fields.slice(1);
  }
  if (fields.length !== 5) return undefined;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const parsed = {
    minute: parseCronField(minute ?? "", 0, 59),
    hour: parseCronField(hour ?? "", 0, 23),
    dayOfMonth: parseCronField(dayOfMonth ?? "", 1, 31),
    month: parseCronField(month ?? "", 1, 12, MONTH_ALIASES),
    dayOfWeek: parseCronField(dayOfWeek ?? "", 0, 7, WEEKDAY_ALIASES, (value) => value === 7 ? 0 : value),
  };
  if (!parsed.minute || !parsed.hour || !parsed.dayOfMonth || !parsed.month || !parsed.dayOfWeek) {
    return undefined;
  }
  return parsed as ParsedCronSchedule;
}

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = zonedFormatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  zonedFormatterCache.set(timezone, formatter);
  return formatter;
}

function zonedClockParts(date: Date, timezone: string): {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
} {
  const parts = Object.fromEntries(
    zonedFormatter(timezone).formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const dayOfMonth = Number(parts.day);
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    dayOfMonth,
    month,
    dayOfWeek: new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay(),
  };
}

function cronScheduleMatches(parsed: ParsedCronSchedule, parts: ReturnType<typeof zonedClockParts>): boolean {
  if (!parsed.minute.values.has(parts.minute)) return false;
  if (!parsed.hour.values.has(parts.hour)) return false;
  if (!parsed.month.values.has(parts.month)) return false;
  const domMatches = parsed.dayOfMonth.values.has(parts.dayOfMonth);
  const dowMatches = parsed.dayOfWeek.values.has(parts.dayOfWeek);
  if (parsed.dayOfMonth.any && parsed.dayOfWeek.any) return true;
  if (parsed.dayOfMonth.any) return dowMatches;
  if (parsed.dayOfWeek.any) return domMatches;
  return domMatches || dowMatches;
}

function enumerateExpectedSchedules(
  schedule: string,
  timezone: string,
  since: Date,
  until: Date,
): Date[] | undefined {
  const parsed = parseCronScheduleForAudit(schedule);
  if (!parsed) return undefined;
  const start = Math.ceil(since.getTime() / MINUTE_MS) * MINUTE_MS;
  const end = Math.floor(until.getTime() / MINUTE_MS) * MINUTE_MS;
  if (end < start) return [];
  const results: Date[] = [];
  for (let ts = start; ts <= end; ts += MINUTE_MS) {
    const candidate = new Date(ts);
    if (cronScheduleMatches(parsed, zonedClockParts(candidate, timezone))) {
      results.push(candidate);
    }
  }
  return results;
}

function queueMissedCronFailureAlert(input: {
  job: CronJob;
  cronRunId: string;
  failureRunId: string;
  taskId?: string;
  incidentId?: string;
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  err: unknown;
  recordedError: string;
  alertError?: string;
  status: "failed" | "retry_scheduled";
}): void {
  try {
    const snapshot = safeConnectivitySnapshot();
    enqueueCronFailureRecovery({
      channelId: input.job.channel,
      cronRunId: input.cronRunId,
      failureRunId: input.failureRunId,
      jobName: input.job.name,
      jobType: input.job.type,
      status: input.status,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      failedAt: new Date(),
      taskId: input.taskId,
      incidentId: input.incidentId,
      errorCategory: errorCategory(input.err),
      errorMessage: input.recordedError,
      alertError: input.alertError,
      connectivityStatus: snapshot?.status,
      outageStartedAt: snapshot?.outage_started_at ?? snapshot?.last_outage_started_at,
    });
  } catch (err) {
    log.error(`${input.job.name} failed to enqueue missed cron failure alert:`, err);
  }
}

function errorMetadata(err: unknown): Partial<Pick<CronJobRunOutcome, "taskId" | "providerName" | "providerStatus" | "providerCategory" | "errorCategory">> {
  if (!err || typeof err !== "object") return {};
  const record = err as Record<string, unknown>;
  return {
    ...(typeof record.taskId === "string" ? { taskId: record.taskId } : {}),
    ...(typeof record.providerName === "string" ? { providerName: record.providerName } : {}),
    ...(typeof record.providerStatus === "string" ? { providerStatus: record.providerStatus } : {}),
    ...(typeof record.providerCategory === "string" ? { providerCategory: record.providerCategory } : {}),
    ...(typeof record.errorCategory === "string" ? { errorCategory: record.errorCategory } : {}),
  };
}

function isCronTimeoutError(err: unknown): err is CronJobTimeoutError {
  return err instanceof CronJobTimeoutError
    || (Boolean(err) && typeof err === "object" && (err as Record<string, unknown>).errorCategory === "cron_timeout");
}

function cronTimeoutMetadata(err: unknown): { timeoutMs?: number; taskId?: string } {
  if (!err || typeof err !== "object") return {};
  const record = err as Record<string, unknown>;
  return {
    ...(typeof record.timeoutMs === "number" ? { timeoutMs: record.timeoutMs } : {}),
    ...(typeof record.taskId === "string" ? { taskId: record.taskId } : {}),
  };
}

function markRunSkipped(
  job: CronJob,
  scheduledAt: Date,
  startedAt: Date,
  msg: string,
  category: string,
  options: {
    status?: Extract<CronRunStatus, "skipped" | "circuit_open">;
    metadata?: Record<string, unknown>;
  } = {},
): CronRunRow {
  const run = createCronRun({
    jobName: job.name,
    jobType: job.type,
    attempt: 1,
    scheduledAt,
    startedAt,
  });
  return markCronRunCompleted(run.id, {
    status: options.status ?? "skipped",
    completedAt: new Date(),
    durationMs: Date.now() - startedAt.getTime(),
    errorCategory: category,
    errorMessage: sanitizeCronError(msg, 1500),
    metadata: options.metadata,
  });
}

function markRunMissed(input: {
  job: CronJob;
  schedule: string;
  timezone: string;
  scheduledAt: Date;
  detectedAt: Date;
  config: NormalizedMissedRunConfig;
}): CronRunRow {
  const msg = `${input.job.name} missed scheduled execution at ${input.scheduledAt.toISOString()}`
    + ` (schedule="${input.schedule}", timezone=${input.timezone})`;
  const run = createCronRun({
    jobName: input.job.name,
    jobType: input.job.type,
    attempt: 0,
    scheduledAt: input.scheduledAt,
    startedAt: input.detectedAt,
    metadata: {
      detected_at: input.detectedAt.toISOString(),
      schedule: input.schedule,
      timezone: input.timezone,
      catch_up_enabled: input.config.catchUp,
    },
  });
  const incident = createOrUpdateIncident({
    dedupeKey: `cron:${input.job.name}:missed:${input.scheduledAt.toISOString()}`,
    type: "cron_missed",
    severity: "warning",
    title: `Cron missed scheduled execution: ${input.job.name}`,
    summary: `Scheduler audit found no cron_runs row for an expected ${input.job.name} trigger.`,
    subjectId: input.job.name,
    subjectType: "cron",
    source: {
      cron_name: input.job.name,
      cron_run_id: run.id,
      schedule: input.schedule,
      timezone: input.timezone,
      scheduled_at: input.scheduledAt.toISOString(),
      detected_at: input.detectedAt.toISOString(),
      catch_up_enabled: input.config.catchUp,
    },
    evidence: {
      missing_run_status: "no cron_runs row found inside schedule tolerance",
      tolerance_ms: SCHEDULE_LOOKUP_TOLERANCE_MS,
      grace_ms: input.config.graceMs,
      lookback_ms: input.config.lookbackMs,
    },
    diagnosis: {
      incidentType: "cron_missed",
      severity: "warning",
      category: "cron_missed_execution",
      repairAllowed: false,
      recommendedAction: "Check MiniClaw process uptime, host sleep/wake history, node-cron missed execution logs, and whether catch_up should be enabled for this job.",
    },
  });
  appendIncidentEvent(incident.row.id, incident.created ? "cron_missed_created" : "cron_missed_observed", {
    cron_run_id: run.id,
    scheduled_at: input.scheduledAt.toISOString(),
    detected_at: input.detectedAt.toISOString(),
    schedule: input.schedule,
    timezone: input.timezone,
    catch_up_enabled: input.config.catchUp,
  });
  const completed = markCronRunCompleted(run.id, {
    status: "missed",
    completedAt: input.detectedAt,
    durationMs: 0,
    incidentId: incident.row.id,
    errorCategory: "missed_execution",
    errorMessage: sanitizeCronError(msg, 1500),
    metadata: {
      detected_at: input.detectedAt.toISOString(),
      schedule: input.schedule,
      timezone: input.timezone,
      catch_up_enabled: input.config.catchUp,
      incident_created: incident.created,
    },
  });
  recordRun(input.job.name, false, 0, msg);
  return completed;
}

async function runJob(job: CronJob, client: Client, context: CronJobRunContext = {}): Promise<CronJobRunOutcome> {
  if (job.type === "task") return await runTask(job, client, context);
  if (job.type === "script") return await runScript(job, client, context);
  if (job.type === "skill") return await runSkill(job, client, context);
  if (job.type === "message") return await runMessage(job, client, context);
  return { status: "success" };
}

async function runJobWithTimeout(job: CronJob, client: Client, context: CronJobRunContext): Promise<CronJobRunOutcome> {
  const timeoutMs = job.timeout_ms;
  if (!timeoutMs) return await runJob(job, client, context);

  const controller = new AbortController();
  let observedTaskId: string | undefined;
  let timedOut = false;
  let timeoutError = new CronJobTimeoutError(job.name, timeoutMs);
  const forwardAbort = () => {
    controller.abort(context.signal?.reason ?? new Error("cron job aborted"));
  };
  if (context.signal?.aborted) forwardAbort();
  else context.signal?.addEventListener("abort", forwardAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    timeoutError = new CronJobTimeoutError(job.name, timeoutMs, observedTaskId);
    controller.abort(timeoutError);
  }, timeoutMs);
  timer.unref?.();

  const jobPromise = runJob(job, client, {
    ...context,
    signal: controller.signal,
    onTaskId: (taskId) => {
      observedTaskId = taskId;
      context.onTaskId?.(taskId);
    },
  });
  jobPromise.catch((err) => {
    if (timedOut) {
      log.warn(`${job.name} settled after timeout:`, err instanceof Error ? err.message : String(err));
    }
  });

  try {
    return await Promise.race([
      jobPromise,
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          if (timedOut) reject(timeoutError);
        }, { once: true });
      }),
    ]);
  } catch (err) {
    if (timedOut) {
      const metadata = errorMetadata(err);
      timeoutError.taskId = timeoutError.taskId ?? metadata.taskId ?? observedTaskId;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", forwardAbort);
  }
}

function getCronSchedules(job: CronJob): string[] {
  return Array.isArray(job.schedule) ? job.schedule : [job.schedule];
}

async function auditMissedRuns(
  jobs: CronJob[],
  client: Client,
  now = new Date(),
): Promise<MissedRunAuditResult> {
  const result: MissedRunAuditResult = {
    checked: 0,
    missed: [],
    catchUpsStarted: 0,
    unsupportedSchedules: [],
  };

  for (const job of jobs) {
    if (!job.enabled) continue;
    const missedRunConfig = normalizeMissedRunConfig(job);
    if (!missedRunConfig.enabled) continue;

    const timezone = job.timezone ?? defaultTimezone();
    const since = new Date(now.getTime() - missedRunConfig.lookbackMs);
    const cutoff = new Date(now.getTime() - missedRunConfig.graceMs);
    if (cutoff.getTime() < since.getTime()) continue;
    let jobCatchUpsStarted = 0;

    for (const schedule of getCronSchedules(job)) {
      let expectedSchedules: Date[] | undefined;
      try {
        expectedSchedules = enumerateExpectedSchedules(schedule, timezone, since, cutoff);
      } catch (err) {
        result.unsupportedSchedules.push(`${job.name}:${schedule}`);
        log.warn(`${job.name} missed-run audit skipped schedule "${schedule}":`, err);
        continue;
      }
      if (!expectedSchedules) {
        result.unsupportedSchedules.push(`${job.name}:${schedule}`);
        continue;
      }

      const candidates = expectedSchedules.slice(-missedRunConfig.maxRecords);
      for (const scheduledAt of candidates) {
        result.checked++;
        if (hasCronRunForSchedule(job.name, scheduledAt, { toleranceMs: SCHEDULE_LOOKUP_TOLERANCE_MS })) {
          continue;
        }

        const missedRun = markRunMissed({
          job,
          schedule,
          timezone,
          scheduledAt,
          detectedAt: now,
          config: missedRunConfig,
        });
        result.missed.push(missedRun);
        log.warn(`${job.name} missed scheduled execution detected for ${scheduledAt.toISOString()}`);

        if (!missedRunConfig.catchUp || jobCatchUpsStarted >= missedRunConfig.maxCatchUp) continue;
        const catchUpKey = `${job.name}:${scheduledAt.toISOString()}`;
        if (runningMissedCatchUps.has(catchUpKey)) continue;
        if (hasCronRunForSchedule(job.name, scheduledAt, {
          toleranceMs: SCHEDULE_LOOKUP_TOLERANCE_MS,
          excludeStatuses: ["missed"],
        })) {
          continue;
        }

        runningMissedCatchUps.add(catchUpKey);
        jobCatchUpsStarted++;
        result.catchUpsStarted++;
        try {
          log.info(`${job.name} starting catch-up for missed schedule ${scheduledAt.toISOString()}`);
          await dispatch(job, client, DEFAULT_RETRY_POLICY, {
            notifyFailures: true,
            scheduledAt,
          });
        } catch (err) {
          log.error(`${job.name} catch-up dispatch failed unexpectedly:`, err);
        } finally {
          runningMissedCatchUps.delete(catchUpKey);
        }
      }
    }
  }

  return result;
}

function startMissedRunAudit(jobs: CronJob[], client: Client): void {
  const runAudit = async (reason: "startup" | "interval") => {
    if (missedRunAuditRunning) return;
    missedRunAuditRunning = true;
    try {
      const result = await auditMissedRuns(jobs, client);
      if (result.missed.length || result.catchUpsStarted) {
        log.warn(
          `missed-run audit ${reason}: missed=${result.missed.length}, catch_up=${result.catchUpsStarted}, checked=${result.checked}`
        );
      }
    } catch (err) {
      log.error(`missed-run audit ${reason} failed:`, err);
    } finally {
      missedRunAuditRunning = false;
    }
  };

  void runAudit("startup");
  missedRunAuditTimer = setInterval(() => {
    void runAudit("interval");
  }, DEFAULT_MISSED_RUN_AUDIT_INTERVAL_MS);
  missedRunAuditTimer.unref?.();
}

function recordCronTimeoutIncident(input: {
  job: CronJob;
  cronRunId: string;
  failureRunId: string;
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  err: unknown;
  errorMessage: string;
}): string | undefined {
  if (!isCronTimeoutError(input.err)) return undefined;
  const timeout = cronTimeoutMetadata(input.err);
  const timeoutMs = timeout.timeoutMs ?? input.job.timeout_ms;
  const result = createOrUpdateIncident({
    dedupeKey: `cron:${input.job.name}:timeout:${input.failureRunId}`,
    type: "cron_failed",
    severity: "warning",
    title: `Cron timed out: ${input.job.name}`,
    summary: timeoutMs
      ? `Cron job exceeded timeout_ms=${timeoutMs}.`
      : "Cron job exceeded its configured timeout.",
    subjectId: input.job.name,
    subjectType: "cron",
    source: {
      cron_name: input.job.name,
      cron_run_id: input.cronRunId,
      failure_run_id: input.failureRunId,
      attempt: input.attempt,
      max_attempts: input.maxAttempts,
      timeout_ms: timeoutMs,
      task_id: timeout.taskId,
    },
    evidence: {
      error: input.errorMessage,
      duration_ms: input.durationMs,
      job_type: input.job.type,
    },
    diagnosis: {
      incidentType: "cron_failed",
      severity: "warning",
      category: "cron_timeout",
      repairAllowed: false,
      recommendedAction: "Review the job timeout, provider latency, and downstream task trace before widening timeout_ms.",
    },
  });
  appendIncidentEvent(result.row.id, result.created ? "cron_timeout_created" : "cron_timeout_observed", {
    cron_run_id: input.cronRunId,
    failure_run_id: input.failureRunId,
    attempt: input.attempt,
    max_attempts: input.maxAttempts,
    timeout_ms: timeoutMs,
    task_id: timeout.taskId,
  });
  return result.row.id;
}

async function dispatch(
  job: CronJob,
  client: Client,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
  options: DispatchOptions = {}
): Promise<void> {
  const scheduledAt = options.scheduledAt ?? new Date();
  if (isDraining()) {
    const startedAt = new Date();
    const msg = `${job.name} skipped: ${DRAINING_MESSAGE}`;
    log.warn(msg);
    markRunSkipped(job, scheduledAt, startedAt, msg, "draining");
    recordRun(job.name, false, 0, msg);
    return;
  }

  if (!tryAcquireJobSlot(job)) {
    const startedAt = new Date();
    const active = getRunningJobCount(job.name);
    const maxConcurrency = getJobMaxConcurrency(job);
    const msg = maxConcurrency === 1
      ? `${job.name} skipped: previous run still active`
      : `${job.name} skipped: max_concurrency=${maxConcurrency} already active (${active})`;
    log.warn(msg);
    markRunSkipped(job, scheduledAt, startedAt, msg, maxConcurrency === 1 ? "already_running" : "max_concurrency");
    recordRun(job.name, false, 0, msg);
    return;
  }

  const policy = normalizeRetryPolicy(retryPolicy);
  const notifyFailures = options.notifyFailures ?? false;
  const failureRunId = randomUUID();
  let failureAlert: CronFailureAlertRef | undefined = options.failureAlert;
  try {
    const controlBlock = getCronControlBlock(job);
    if (controlBlock) {
      const startedAt = new Date();
      log.warn(controlBlock.message);
      markRunSkipped(job, scheduledAt, startedAt, controlBlock.message, controlBlock.category, {
        status: controlBlock.status,
        metadata: controlBlock.metadata,
      });
      recordRun(job.name, false, 0, controlBlock.message, {
        next_retry_at: controlBlock.nextAllowedAt.toISOString(),
      });
      return;
    }

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      const startedAt = Date.now();
      const cronRun = createCronRun({
        jobName: job.name,
        jobType: job.type,
        attempt,
        scheduledAt,
        startedAt: new Date(startedAt),
        metadata: { failure_run_id: failureRunId },
      });
      try {
        if (attempt > 1) {
          log.info(`${job.name} retry attempt ${attempt}/${policy.maxAttempts}`);
        }
        const outcome = await runJobWithTimeout(job, client, {});
        const durationMs = Date.now() - startedAt;
        markCronRunCompleted(cronRun.id, {
          status: outcome.status,
          durationMs,
          taskId: outcome.taskId,
          providerName: outcome.providerName,
          providerStatus: outcome.providerStatus,
          providerCategory: outcome.providerCategory,
          errorCategory: outcome.errorCategory,
          errorMessage: outcome.errorMessage,
          metadata: outcome.metadata ?? { failure_run_id: failureRunId },
        });
        recordRun(job.name, true, durationMs, undefined, {
          last_attempt: attempt,
          max_attempts: policy.maxAttempts,
        });
        if (failureAlert) {
          await updateCronRecoveredAlert(job, {
            runId: failureRunId,
            attempt,
            maxAttempts: policy.maxAttempts,
            durationMs,
            recoveredAt: new Date(),
          }, failureAlert);
        }
        return;
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const errorMsg = errorMessage(err);
        const metadata = errorMetadata(err);
        const willRetry = attempt < policy.maxAttempts;
        const retryDelayMs = willRetry ? getRetryDelayMs(policy, attempt) : 0;
        const nextRetryAt = willRetry ? new Date(Date.now() + retryDelayMs) : undefined;
        const recordedError = willRetry
          ? `${errorMsg} (attempt ${attempt}/${policy.maxAttempts}; retry in ${formatDuration(retryDelayMs)})`
          : `${errorMsg} (attempt ${attempt}/${policy.maxAttempts}; retries exhausted)`;

        log.error(`${job.name} failed attempt ${attempt}/${policy.maxAttempts}:`, errorMsg);
        recordRun(job.name, false, durationMs, recordedError, {
          last_attempt: attempt,
          max_attempts: policy.maxAttempts,
          failure_run_id: failureRunId,
          ...(nextRetryAt ? { next_retry_at: nextRetryAt.toISOString() } : {}),
          ...alertMetadata(failureAlert),
        });

        const incidentId = recordCronTimeoutIncident({
          job,
          cronRunId: cronRun.id,
          failureRunId,
          attempt,
          maxAttempts: policy.maxAttempts,
          durationMs,
          err,
          errorMessage: recordedError,
        });

        if (notifyFailures) {
          try {
            failureAlert = await sendOrUpdateCronFailureAlert(client, job, {
              runId: failureRunId,
              cronRunId: cronRun.id,
              taskId: metadata.taskId,
              incidentId,
              attempt,
              maxAttempts: policy.maxAttempts,
              durationMs,
              error: recordedError,
              failedAt: new Date(),
              ...(nextRetryAt ? { nextRetryAt } : {}),
            }, failureAlert);
            if (failureAlert) {
              updateJobState(job.name, alertMetadata(failureAlert));
            } else {
              queueMissedCronFailureAlert({
                job,
                cronRunId: cronRun.id,
                failureRunId,
                taskId: metadata.taskId,
                incidentId,
                attempt,
                maxAttempts: policy.maxAttempts,
                durationMs,
                err,
                recordedError,
                status: willRetry ? "retry_scheduled" : "failed",
                alertError: "cron failure alert was not delivered",
              });
            }
          } catch (notifyErr) {
            log.error(`${job.name} failed to send cron failure alert:`, notifyErr);
            queueMissedCronFailureAlert({
              job,
              cronRunId: cronRun.id,
              failureRunId,
              taskId: metadata.taskId,
              incidentId,
              attempt,
              maxAttempts: policy.maxAttempts,
              durationMs,
              err,
              recordedError,
              status: willRetry ? "retry_scheduled" : "failed",
              alertError: errorMessage(notifyErr),
            });
          }
        }

        markCronRunFailed(cronRun.id, {
          status: willRetry ? "retry_scheduled" : "failed",
          durationMs,
          taskId: metadata.taskId,
          incidentId,
          providerName: metadata.providerName,
          providerStatus: metadata.providerStatus,
          providerCategory: metadata.providerCategory,
          errorCategory: metadata.errorCategory ?? errorCategory(err),
          errorMessage: recordedError,
          alertMessageId: failureAlert?.messageId,
          alertChannelId: failureAlert?.channelId,
          metadata: {
            failure_run_id: failureRunId,
            ...(nextRetryAt ? { next_retry_at: nextRetryAt.toISOString() } : {}),
            ...(willRetry ? { retry_delay_ms: retryDelayMs } : {}),
          },
        });

        if (!willRetry) return;
        log.warn(`${job.name} retrying in ${formatDuration(retryDelayMs)} (next attempt ${attempt + 1}/${policy.maxAttempts})`);
        await waitForRetryDelay(job.name, failureRunId, retryDelayMs, policy.sleep);
        updateJobState(job.name, {}, ["next_retry_at"]);
      }
    }
  } finally {
    releaseJobSlot(job.name);
  }
}

export function startScheduler(client: Client): { scheduled: number; errors: Array<{ file: string; error: string }> } {
  stopScheduler(); // 防重复 startup
  const { jobs, errors } = loadCronJobs();

  for (const e of errors) log.warn(`load error: ${e.file}: ${e.error}`);

  let scheduled = 0;
  const activeJobs: CronJob[] = [];
  for (const job of jobs) {
    if (!job.enabled) {
      log.info(`${job.name} ⏸ disabled (skipped)`);
      continue;
    }
    try {
      const scheduledTasks = getCronSchedules(job).map((schedule) => cron.schedule(
        schedule,
        () => { void dispatch(job, client, DEFAULT_RETRY_POLICY, { notifyFailures: true }); },
        { timezone: job.timezone }
      ));
      tasks.set(job.name, scheduledTasks);
      scheduled += scheduledTasks.length;
      activeJobs.push(job);
      const scheduleLabel = getCronSchedules(job).map((schedule) => `"${schedule}"`).join(", ");
      log.info(`✓ ${job.name} (${job.type}) ${scheduleLabel}${job.timezone ? ` tz=${job.timezone}` : ""}`);
    } catch (err) {
      log.error(`failed to schedule ${job.name}:`, err);
    }
  }
  startMissedRunAudit(activeJobs, client);
  log.info(`scheduler started: ${scheduled} schedule(s) active, ${errors.length} load error(s)`);
  return { scheduled, errors };
}

export function stopScheduler(): void {
  if (missedRunAuditTimer) {
    clearInterval(missedRunAuditTimer);
    missedRunAuditTimer = undefined;
  }
  for (const scheduledTasks of tasks.values()) {
    for (const t of scheduledTasks) {
      try { void t.stop(); } catch { /* ignore */ }
    }
  }
  tasks.clear();
}

export function listScheduled(): Array<{ name: string; state?: JobState }> {
  const states = getAllJobStates();
  return Array.from(tasks.keys()).map((name) => ({ name, state: states[name] }));
}

// 暴露给 CLI: 立刻试跑一个 job 不影响调度
export async function runJobNow(name: string, client: Client): Promise<void> {
  const { jobs } = loadCronJobs();
  const job = jobs.find((j) => j.name === name);
  if (!job) throw new Error(`job not found: ${name}`);
  await dispatch(job, client, NO_RETRY_POLICY, { notifyFailures: false });
}

export async function requestCronRetryNow(
  runId: string,
  client: Client,
  options: CronRetryRequestOptions = {}
): Promise<CronRetryRequestResult> {
  const entry = Object.entries(getAllJobStates()).find(([, state]) => (
    state.last_status === "error" && state.failure_run_id === runId
  ));
  if (!entry) {
    return {
      ok: false,
      reason: "not_found",
      message: "这个失败记录已经过期，或定时任务已经恢复成功。",
    };
  }

  const [jobName] = entry;
  const waiter = retryWaiters.get(jobName);
  if (waiter?.runId === runId) {
    await options.beforeRun?.({ status: "woke", jobName });
    waiter.wake();
    return { ok: true, status: "woke", jobName };
  }

  const { jobs } = loadCronJobs();
  const job = jobs.find((j) => j.name === jobName);
  if (!job) {
    return {
      ok: false,
      reason: "not_found",
      jobName,
      message: `找不到定时任务配置: ${jobName}`,
    };
  }

  if (getRunningJobCount(jobName) >= getJobMaxConcurrency(job)) {
    return {
      ok: false,
      reason: "already_running",
      jobName,
      message: "该定时任务正在执行中，请等待当前执行完成。",
    };
  }

  if (!job.enabled) {
    return {
      ok: false,
      reason: "disabled",
      jobName,
      message: `定时任务已禁用: ${jobName}`,
    };
  }

  await options.beforeRun?.({ status: "started", jobName });
  void dispatch(job, client, NO_RETRY_POLICY, {
    notifyFailures: true,
    failureAlert: options.failureAlert,
  }).catch((err) => {
    log.error(`${jobName} immediate retry failed unexpectedly:`, err);
  });
  return { ok: true, status: "started", jobName };
}

export const __testables = {
  dispatch,
  DEFAULT_RETRY_POLICY,
  getRetryDelayMs,
  waitForRetryDelay,
  getCronSchedules,
  parseCronScheduleForAudit,
  enumerateExpectedSchedules,
  auditMissedRuns,
  markRunMissed,
  normalizeMissedRunConfig,
};
