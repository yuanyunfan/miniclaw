import { getDb, getTask, type TaskRow } from "./db.js";
import { countTaskEvents, listTaskEvents, type TaskEventRow, type TaskEventSeverity } from "./task-events.js";

export type TaskTraceErrorCode = "missing_id" | "not_found" | "ambiguous_prefix" | "no_events";

export interface TaskTraceError {
  code: TaskTraceErrorCode;
  message: string;
  matches?: string[];
}

export type TaskTraceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TaskTraceError };

export type TaskTracePayloadValue =
  | string
  | number
  | boolean
  | null
  | TaskTracePayloadValue[]
  | { [key: string]: TaskTracePayloadValue };

export interface TaskTraceEvent {
  id: number;
  eventType: string;
  severity: TaskEventSeverity;
  message?: string;
  payload: Record<string, TaskTracePayloadValue>;
  redactedPayloadKeys: number;
  payloadParseError: boolean;
  createdAt: string;
  elapsedMs: number | null;
}

export interface TaskTraceModel {
  task: {
    id: string;
    status: string;
    cwd: string | null;
    sessionId: string | null;
    durationMs: number | null;
    costUsd: number | null;
    createdAt: string;
    completedAt: string | null;
    sourceRouteType: string | null;
    sourceChannelId: string | null;
    sourceThreadId: string | null;
    sourceMessageId: string | null;
    sourceMessageUrl: string | null;
  };
  events: TaskTraceEvent[];
  totalEventCount: number;
  renderedEventCount: number;
  omittedEventCount: number;
  generatedAt: string;
  redactionPolicy: string;
}

export interface TaskTraceModelOptions {
  maxEvents?: number;
  maxFieldChars?: number;
}

export interface TaskTraceRenderOptions {
  maxBytes?: number;
}

const DEFAULT_MAX_EVENTS = 200;
const DEFAULT_FIELD_CHARS = 500;
const DEFAULT_MARKDOWN_BYTES = 96_000;
const REDACTION_POLICY =
  "payload allowlist only; prompt/raw provider/email/cookie/token fields omitted; free text redacted and truncated";

const BASE_ALLOWED_PAYLOAD_KEYS = new Set([
  "attachments",
  "cost_usd",
  "cwd",
  "duration_ms",
  "event_type",
  "has_parent_context",
  "has_source_metadata",
  "item_type",
  "model",
  "operation",
  "output_mode",
  "parent_tool_use_id",
  "provider",
  "resume",
  "route",
  "session_id",
  "source_channel_id",
  "source_message_id",
  "source_message_url",
  "source_route_type",
  "status",
  "stream_event",
  "subtype",
  "thread_id",
  "tool_count",
  "tool_name",
  "turn",
  "turns",
  "usage",
  "user_id",
]);

const EVENT_ALLOWED_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  task_started: ["model", "output_mode", "resume"],
  task_accepted: ["attachments", "route", "thread_id"],
  task_context_captured: ["has_parent_context", "has_source_metadata"],
  session_started: ["session_id"],
  turn_completed: ["usage"],
  task_completed: ["status"],
  task_finished: ["status"],
};

const USAGE_ALLOWED_KEYS = new Set([
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "cached_input_tokens",
  "input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
]);

const AUTHORIZATION_PATTERN = /\b(authorization\s*[:=]\s*)(?:Bearer\s+)?[A-Za-z0-9._~+/=-]+/gi;
const COOKIE_PATTERN = /\b((?:set-)?cookie\s*[:=]\s*)[^\s,]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|pwd|session[_-]?id|session|account(?:[_-]?number)?|acct|card(?:[_-]?number)?)\b(\s*[:=]\s*)(["']?)[^\s"',;]+["']?/gi;
const BODY_ASSIGNMENT_PATTERN =
  /\b(email[_ -]?body|raw[_ -]?email|message[_ -]?body|full[_ -]?prompt|prompt)\b(\s*[:=]\s*)(["']?)[^"']{8,}/gi;
const STANDALONE_BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const KNOWN_TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,})\b/g;

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, Math.max(0, maxChars));
  return `${value.slice(0, maxChars - 3)}...`;
}

export function redactTaskTraceText(value: string, maxChars = DEFAULT_FIELD_CHARS): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const redacted = compact
    .replace(AUTHORIZATION_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(COOKIE_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string, separator: string, quote: string) => {
      const q = quote || "";
      return `${key}${separator}${q}[REDACTED]${q}`;
    })
    .replace(BODY_ASSIGNMENT_PATTERN, (_match, key: string, separator: string, quote: string) => {
      const q = quote || "";
      return `${key}${separator}${q}[REDACTED]${q}`;
    })
    .replace(STANDALONE_BEARER_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(KNOWN_TOKEN_PATTERN, "[REDACTED]");
  return truncateText(redacted, maxChars);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function allowedPayloadKeys(eventType: string): Set<string> {
  return new Set([
    ...BASE_ALLOWED_PAYLOAD_KEYS,
    ...(EVENT_ALLOWED_PAYLOAD_KEYS[eventType] ?? []),
  ]);
}

function parsePayload(raw: string | null): { value?: Record<string, unknown>; parseError: boolean } {
  if (!raw) return { parseError: false };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return { parseError: true };
    return { value: parsed, parseError: false };
  } catch {
    return { parseError: true };
  }
}

function usageValue(value: unknown): { value?: TaskTracePayloadValue; redactedKeys: number } {
  if (!isPlainObject(value)) return { redactedKeys: value === undefined ? 0 : 1 };
  const out: Record<string, TaskTracePayloadValue> = {};
  let redactedKeys = 0;
  for (const [key, inner] of Object.entries(value)) {
    if (!USAGE_ALLOWED_KEYS.has(key)) {
      redactedKeys++;
      continue;
    }
    if (typeof inner === "number" || typeof inner === "string" || typeof inner === "boolean" || inner === null) {
      out[key] = inner;
    } else {
      redactedKeys++;
    }
  }
  return { value: Object.keys(out).length ? out : undefined, redactedKeys };
}

function payloadValue(
  key: string,
  value: unknown,
  maxChars: number
): { value?: TaskTracePayloadValue; redactedKeys: number } {
  if (value === undefined) return { redactedKeys: 0 };
  if (key === "usage") return usageValue(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return { value, redactedKeys: 0 };
  if (typeof value === "string") return { value: redactTaskTraceText(value, maxChars), redactedKeys: 0 };
  if (Array.isArray(value) || isPlainObject(value)) {
    return { value: redactTaskTraceText(JSON.stringify(value), maxChars), redactedKeys: 0 };
  }
  return { value: redactTaskTraceText(String(value), maxChars), redactedKeys: 0 };
}

function projectPayload(
  eventType: string,
  payload: Record<string, unknown> | undefined,
  maxChars: number
): { payload: Record<string, TaskTracePayloadValue>; redactedPayloadKeys: number } {
  if (!payload) return { payload: {}, redactedPayloadKeys: 0 };
  const allowed = allowedPayloadKeys(eventType);
  const out: Record<string, TaskTracePayloadValue> = {};
  let redactedPayloadKeys = 0;

  for (const [key, value] of Object.entries(payload)) {
    if (!allowed.has(key)) {
      redactedPayloadKeys++;
      continue;
    }
    const projected = payloadValue(key, value, maxChars);
    redactedPayloadKeys += projected.redactedKeys;
    if (projected.value !== undefined) out[key] = projected.value;
  }

  return { payload: out, redactedPayloadKeys };
}

function timestampMs(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveIntOption(value: number | undefined, fallback: number, min = 1): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

function traceTask(row: TaskRow): TaskTraceModel["task"] {
  return {
    id: row.id,
    status: row.status,
    cwd: row.cwd,
    sessionId: row.session_id,
    durationMs: row.duration_ms,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    sourceRouteType: row.source_route_type,
    sourceChannelId: row.source_channel_id,
    sourceThreadId: row.discord_thread_id,
    sourceMessageId: row.source_message_id,
    sourceMessageUrl: row.source_message_url,
  };
}

function traceEvent(row: TaskEventRow, previous: TaskEventRow | undefined, maxChars: number): TaskTraceEvent {
  const parsed = parsePayload(row.payload_json);
  const projected = projectPayload(row.event_type, parsed.value, maxChars);
  const currentMs = timestampMs(row.created_at);
  const previousMs = previous ? timestampMs(previous.created_at) : undefined;
  const elapsedMs = currentMs !== undefined && previousMs !== undefined
    ? Math.max(0, currentMs - previousMs)
    : null;
  const message = row.message ? redactTaskTraceText(row.message, maxChars) : undefined;

  return {
    id: row.id,
    eventType: row.event_type,
    severity: row.severity,
    ...(message ? { message } : {}),
    payload: projected.payload,
    redactedPayloadKeys: projected.redactedPayloadKeys + (parsed.parseError ? 1 : 0),
    payloadParseError: parsed.parseError,
    createdAt: row.created_at,
    elapsedMs,
  };
}

export function resolveTaskForTrace(idPrefix: string, maxMatches = 6): TaskTraceResult<TaskRow> {
  const prefix = idPrefix.trim();
  if (!prefix) {
    return { ok: false, error: { code: "missing_id", message: "task id 不能为空" } };
  }

  const exact = getTask(prefix);
  if (exact) return { ok: true, value: exact };

  const matches = getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE id LIKE @prefix ESCAPE '\\'
       ORDER BY created_at DESC, rowid DESC
       LIMIT @limit`
    )
    .all({ prefix: `${escapeLike(prefix)}%`, limit: maxMatches }) as TaskRow[];

  if (matches.length === 1) return { ok: true, value: matches[0] };
  if (matches.length > 1) {
    return {
      ok: false,
      error: {
        code: "ambiguous_prefix",
        message: `task id 前缀 \`${prefix}\` 匹配多条任务`,
        matches: matches.map((row) => row.id),
      },
    };
  }

  return { ok: false, error: { code: "not_found", message: `找不到 task \`${prefix}\`` } };
}

export function buildTaskTraceModel(
  taskId: string,
  options: TaskTraceModelOptions = {}
): TaskTraceResult<TaskTraceModel> {
  const task = getTask(taskId);
  if (!task) return { ok: false, error: { code: "not_found", message: `找不到 task \`${taskId}\`` } };

  const totalEventCount = countTaskEvents(taskId);
  if (totalEventCount === 0) {
    return { ok: false, error: { code: "no_events", message: `task \`${taskId.slice(0, 8)}\` 没有 trace events` } };
  }

  const maxEvents = positiveIntOption(options.maxEvents, DEFAULT_MAX_EVENTS);
  const maxFieldChars = positiveIntOption(options.maxFieldChars, DEFAULT_FIELD_CHARS, 20);
  const rows = listTaskEvents(taskId, maxEvents).reverse();
  const events = rows.map((row, index) => traceEvent(row, rows[index - 1], maxFieldChars));

  return {
    ok: true,
    value: {
      task: traceTask(task),
      events,
      totalEventCount,
      renderedEventCount: events.length,
      omittedEventCount: Math.max(0, totalEventCount - events.length),
      generatedAt: new Date().toISOString(),
      redactionPolicy: REDACTION_POLICY,
    },
  };
}

function valueText(value: TaskTracePayloadValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function formatElapsed(ms: number | null): string {
  if (ms === null) return "+?";
  if (ms < 1000) return `+${ms}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(1);
  return `+${minutes}m ${seconds}s`;
}

function taskFieldLines(task: TaskTraceModel["task"]): string[] {
  return [
    `- id: ${task.id}`,
    `- status: ${task.status}`,
    `- cwd: ${task.cwd ?? "-"}`,
    `- session_id: ${task.sessionId ?? "-"}`,
    `- duration_ms: ${task.durationMs ?? "-"}`,
    `- cost_usd: ${task.costUsd ?? "-"}`,
    `- created_at: ${task.createdAt}`,
    `- completed_at: ${task.completedAt ?? "-"}`,
    `- source_route_type: ${task.sourceRouteType ?? "-"}`,
    `- source_channel_id: ${task.sourceChannelId ?? "-"}`,
    `- source_thread_id: ${task.sourceThreadId ?? "-"}`,
    `- source_message_id: ${task.sourceMessageId ?? "-"}`,
    `- source_message_url: ${task.sourceMessageUrl ?? "-"}`,
    "- prompt: [redacted]",
  ];
}

function eventLines(event: TaskTraceEvent, index: number): string[] {
  const payloadEntries = Object.entries(event.payload);
  return [
    `### ${index + 1}. ${event.createdAt} (${formatElapsed(event.elapsedMs)})`,
    `- event: ${event.severity}/${event.eventType}`,
    ...(event.message ? [`- message: ${event.message}`] : []),
    ...(payloadEntries.length
      ? [
          "- payload:",
          ...payloadEntries.map(([key, value]) => `  - ${key}: ${valueText(value)}`),
        ]
      : ["- payload: (none)"]),
    ...(event.redactedPayloadKeys ? [`- redacted_payload_keys: ${event.redactedPayloadKeys}`] : []),
    ...(event.payloadParseError ? ["- payload_parse_error: true"] : []),
    "",
  ];
}

export function taskTraceFileName(taskId: string): string {
  return `task-${taskId.slice(0, 8)}-trace.md`;
}

export function formatTaskTraceSummary(model: TaskTraceModel): string {
  return [
    `Task trace ${model.task.id.slice(0, 8)} (${model.task.status})`,
    `events=${model.renderedEventCount}/${model.totalEventCount}`,
    `cwd=${model.task.cwd ?? "-"}`,
  ].join(" | ");
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const notice = "\n\n_Trace truncated by max_bytes limit._\n";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(notice, "utf8"));
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), "utf8") <= budget) low = mid;
    else high = mid - 1;
  }
  return value.slice(0, low) + notice;
}

export function renderTaskTraceMarkdown(
  model: TaskTraceModel,
  options: TaskTraceRenderOptions = {}
): string {
  const lines = [
    `# Task Trace: ${model.task.id}`,
    "",
    "## Task",
    ...taskFieldLines(model.task),
    "",
    "## Summary",
    `- generated_at: ${model.generatedAt}`,
    `- total_events: ${model.totalEventCount}`,
    `- rendered_events: ${model.renderedEventCount}`,
    `- omitted_events: ${model.omittedEventCount}`,
    `- redaction_policy: ${model.redactionPolicy}`,
    "",
    "## Timeline",
    ...(model.events.length ? model.events.flatMap(eventLines) : ["- (none)", ""]),
  ];
  return truncateUtf8(lines.join("\n").trimEnd() + "\n", positiveIntOption(options.maxBytes, DEFAULT_MARKDOWN_BYTES));
}

export const __testables = {
  projectPayload,
  truncateUtf8,
};
