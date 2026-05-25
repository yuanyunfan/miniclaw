import { v4 as uuid } from "uuid";
import { getDb } from "./connection.js";
import {
  mapHookEventToPhase,
  isCliSessionProvider,
  isCliSessionPhase,
} from "../hookd/state.js";
import type {
  CliSessionApprovalDecision,
  CliSessionApprovalRow,
  CliSessionApprovalStatus,
  CliSessionEventRow,
  CliSessionHookEvent,
  CliSessionPhase,
  CliSessionProvider,
  CliSessionRow,
} from "../hookd/types.js";

export interface CliSessionListOptions {
  provider?: CliSessionProvider;
  status?: "all" | "active" | "idle" | "closed" | "hidden";
  cwdContains?: string;
  includeHidden?: boolean;
  includeClosed?: boolean;
  limit?: number;
}

const SENSITIVE_KEY = /(api[_-]?key|token|secret|password|authorization|cookie|session[_-]?token)/i;
const STRING_LIMIT = 2_000;

function iso(date = new Date()): string {
  return date.toISOString();
}

function normalizeNullableString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeNullableNumber(value: number | undefined): number | null {
  if (value === undefined) return null;
  return Number.isInteger(value) && value > 0 ? value : null;
}

function safeJson(value: unknown): string {
  return JSON.stringify(redactPayload(value));
}

export function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[redacted:depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > STRING_LIMIT ? `${value.slice(0, STRING_LIMIT)}...[truncated]` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactPayload(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactPayload(child, depth + 1);
  }
  return out;
}

function assertCliSessionRow(row: unknown): CliSessionRow {
  if (!row || typeof row !== "object") {
    throw new Error("Unexpected cli_sessions row shape");
  }
  const candidate = row as Record<string, unknown>;
  if (!isCliSessionProvider(String(candidate.provider))) {
    throw new Error(`Unexpected CLI session provider: ${String(candidate.provider)}`);
  }
  if (!isCliSessionPhase(String(candidate.phase))) {
    throw new Error(`Unexpected CLI session phase: ${String(candidate.phase)}`);
  }
  return row as CliSessionRow;
}

function assertCliSessionRows(rows: unknown[]): CliSessionRow[] {
  return rows.map(assertCliSessionRow);
}

function assertCliSessionApprovalRow(row: unknown): CliSessionApprovalRow {
  if (!row || typeof row !== "object") {
    throw new Error("Unexpected cli_session_approvals row shape");
  }
  const candidate = row as Record<string, unknown>;
  if (!isCliSessionProvider(String(candidate.provider))) {
    throw new Error(`Unexpected CLI session approval provider: ${String(candidate.provider)}`);
  }
  return row as CliSessionApprovalRow;
}

function approvalStatusForDecision(decision: CliSessionApprovalDecision): CliSessionApprovalStatus {
  if (decision === "allow") return "approved";
  if (decision === "deny") return "denied";
  return "ask";
}

function ensureProviderSessionId(event: CliSessionHookEvent): string {
  const id = event.providerSessionId.trim();
  if (!id) throw new Error("hook event is missing providerSessionId");
  return id;
}

export function recordCliSessionHookEvent(event: CliSessionHookEvent): CliSessionRow {
  const now = iso(event.receivedAt);
  const providerSessionId = ensureProviderSessionId(event);
  const phase = event.phase ?? mapHookEventToPhase(event.provider, event.eventName);
  const existing = getCliSessionByProviderSession(event.provider, providerSessionId);
  const sessionId = existing?.id ?? uuid();
  const transcriptPath = normalizeNullableString(event.transcriptPath) ?? existing?.transcript_path ?? null;
  const normalizedEventName = event.eventName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const transcriptActivity = Boolean(
    event.transcriptActivity ||
    (transcriptPath && !["sessionstart", "startup", "resume"].includes(normalizedEventName))
  );
  const promptSubmitted = normalizedEventName === "userpromptsubmit";
  const observedPromptCount = (existing?.observed_prompt_count ?? 0) + (promptSubmitted ? 1 : 0);
  const endedAt = phase === "ended" ? now : existing?.ended_at ?? null;

  getDb().prepare(
    `INSERT INTO cli_sessions (
       id, provider, provider_session_id, cwd, pid, tty, terminal_app, terminal_surface_json,
       transcript_path, phase, attention_kind, latest_summary, latest_prompt, last_event_name,
       last_activity_at, started_at, ended_at, hidden_at, observed_prompt_count, transcript_activity_at
     ) VALUES (
       @id, @provider, @provider_session_id, @cwd, @pid, @tty, @terminal_app, @terminal_surface_json,
       @transcript_path, @phase, @attention_kind, @latest_summary, @latest_prompt, @last_event_name,
       @last_activity_at, @started_at, @ended_at, @hidden_at, @observed_prompt_count, @transcript_activity_at
     )
     ON CONFLICT(provider, provider_session_id) DO UPDATE SET
       cwd = excluded.cwd,
       pid = COALESCE(excluded.pid, cli_sessions.pid),
       tty = COALESCE(excluded.tty, cli_sessions.tty),
       terminal_app = COALESCE(excluded.terminal_app, cli_sessions.terminal_app),
       terminal_surface_json = COALESCE(excluded.terminal_surface_json, cli_sessions.terminal_surface_json),
       transcript_path = COALESCE(excluded.transcript_path, cli_sessions.transcript_path),
       phase = excluded.phase,
       attention_kind = excluded.attention_kind,
       latest_summary = COALESCE(excluded.latest_summary, cli_sessions.latest_summary),
       latest_prompt = COALESCE(excluded.latest_prompt, cli_sessions.latest_prompt),
       last_event_name = excluded.last_event_name,
       last_activity_at = excluded.last_activity_at,
       ended_at = excluded.ended_at,
       observed_prompt_count = excluded.observed_prompt_count,
       transcript_activity_at = COALESCE(excluded.transcript_activity_at, cli_sessions.transcript_activity_at)`
  ).run({
    id: sessionId,
    provider: event.provider,
    provider_session_id: providerSessionId,
    cwd: event.cwd.trim() || existing?.cwd || process.cwd(),
    pid: normalizeNullableNumber(event.pid) ?? existing?.pid ?? null,
    tty: normalizeNullableString(event.tty) ?? existing?.tty ?? null,
    terminal_app: normalizeNullableString(event.terminalApp) ?? existing?.terminal_app ?? null,
    terminal_surface_json: event.terminalSurface ? safeJson(event.terminalSurface) : existing?.terminal_surface_json ?? null,
    transcript_path: transcriptPath,
    phase,
    attention_kind: normalizeNullableString(event.attentionKind) ?? (phase === "waiting_for_approval" ? "approval" : null),
    latest_summary: normalizeNullableString(event.summary) ?? existing?.latest_summary ?? null,
    latest_prompt: normalizeNullableString(event.prompt) ?? existing?.latest_prompt ?? null,
    last_event_name: event.eventName,
    last_activity_at: now,
    started_at: existing?.started_at ?? now,
    ended_at: endedAt,
    hidden_at: existing?.hidden_at ?? null,
    observed_prompt_count: observedPromptCount,
    transcript_activity_at: transcriptActivity ? now : existing?.transcript_activity_at ?? null,
  });

  const row = getCliSessionByProviderSession(event.provider, providerSessionId);
  if (!row) throw new Error("failed to retrieve recorded cli session");

  getDb().prepare(
    `INSERT INTO cli_session_events (
       id, cli_session_id, provider, event_name, phase, payload_json, created_at
     ) VALUES (
       @id, @cli_session_id, @provider, @event_name, @phase, @payload_json, @created_at
     )`
  ).run({
    id: uuid(),
    cli_session_id: row.id,
    provider: event.provider,
    event_name: event.eventName,
    phase,
    payload_json: safeJson(event.payload ?? event),
    created_at: now,
  });

  return row;
}

export function getCliSession(id: string): CliSessionRow | undefined {
  const row = getDb().prepare("SELECT * FROM cli_sessions WHERE id = ?").get(id);
  return row ? assertCliSessionRow(row) : undefined;
}

export function getCliSessionByProviderSession(
  provider: CliSessionProvider,
  providerSessionId: string,
): CliSessionRow | undefined {
  const row = getDb()
    .prepare("SELECT * FROM cli_sessions WHERE provider = ? AND provider_session_id = ?")
    .get(provider, providerSessionId);
  return row ? assertCliSessionRow(row) : undefined;
}

export function listCliSessions(options: CliSessionListOptions = {}): CliSessionRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (options.provider) {
    where.push("provider = @provider");
    params.provider = options.provider;
  }
  if (options.cwdContains?.trim()) {
    where.push("cwd LIKE @cwd");
    params.cwd = `%${options.cwdContains.trim()}%`;
  }
  const status = options.status ?? "all";
  if (status === "hidden") {
    where.push("hidden_at IS NOT NULL");
  } else if (!options.includeHidden) {
    where.push("hidden_at IS NULL");
  }
  if (status === "closed") {
    where.push("(phase = 'ended' OR ended_at IS NOT NULL)");
  } else if (!options.includeClosed) {
    where.push("phase <> 'ended' AND ended_at IS NULL");
  }
  if (status === "idle") {
    where.push("phase = 'waiting_for_input'");
  }
  if (status === "active") {
    where.push("phase IN ('processing', 'running_tool', 'waiting_for_approval', 'compacting', 'starting', 'unknown')");
  }

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const sql = [
    "SELECT * FROM cli_sessions",
    where.length ? `WHERE ${where.join(" AND ")}` : "",
    "ORDER BY datetime(last_activity_at) DESC, rowid DESC LIMIT @limit",
  ].filter(Boolean).join(" ");
  params.limit = limit;
  return assertCliSessionRows(getDb().prepare(sql).all(params));
}

export function listCliSessionEvents(sessionId: string, limit = 20): CliSessionEventRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM cli_session_events
       WHERE cli_session_id = ?
       ORDER BY datetime(created_at) DESC, rowid DESC
       LIMIT ?`
    )
    .all(sessionId, Math.min(Math.max(limit, 1), 100));
  return rows as CliSessionEventRow[];
}

export function createCliSessionApproval(params: {
  session: CliSessionRow;
  event: CliSessionHookEvent;
  timeoutMs: number;
  now?: Date;
}): CliSessionApprovalRow {
  const requestedAt = params.now ?? params.event.receivedAt ?? new Date();
  const requestedAtIso = iso(requestedAt);
  const expiresAt = new Date(requestedAt.getTime() + Math.max(params.timeoutMs, 1));
  const id = params.event.approvalRequestId?.trim() || uuid();
  getDb().prepare(
    `INSERT INTO cli_session_approvals (
       id, cli_session_id, provider, provider_session_id, tool_name, tool_use_id,
       request_json, status, decision_json, actor_id, requested_at, resolved_at, expires_at
     ) VALUES (
       @id, @cli_session_id, @provider, @provider_session_id, @tool_name, @tool_use_id,
       @request_json, 'pending', NULL, NULL, @requested_at, NULL, @expires_at
     )
     ON CONFLICT(id) DO UPDATE SET
       cli_session_id = excluded.cli_session_id,
       provider = excluded.provider,
       provider_session_id = excluded.provider_session_id,
       tool_name = excluded.tool_name,
       tool_use_id = excluded.tool_use_id,
       request_json = excluded.request_json,
       expires_at = excluded.expires_at`
  ).run({
    id,
    cli_session_id: params.session.id,
    provider: params.session.provider,
    provider_session_id: params.session.provider_session_id,
    tool_name: normalizeNullableString(params.event.toolName),
    tool_use_id: normalizeNullableString(params.event.toolUseId),
    request_json: safeJson({
      tool_name: params.event.toolName,
      tool_use_id: params.event.toolUseId,
      tool_input: params.event.toolInput,
      payload: params.event.payload,
    }),
    requested_at: requestedAtIso,
    expires_at: expiresAt.toISOString(),
  });
  const row = getCliSessionApproval(id);
  if (!row) throw new Error("failed to retrieve recorded cli session approval");
  return row;
}

export function getCliSessionApproval(id: string): CliSessionApprovalRow | undefined {
  const row = getDb().prepare("SELECT * FROM cli_session_approvals WHERE id = ?").get(id);
  return row ? assertCliSessionApprovalRow(row) : undefined;
}

export function getPendingCliSessionApprovalForSession(sessionId: string): CliSessionApprovalRow | undefined {
  const row = getDb().prepare(
    `SELECT * FROM cli_session_approvals
     WHERE cli_session_id = ? AND status = 'pending'
     ORDER BY datetime(requested_at) DESC, rowid DESC
     LIMIT 1`
  ).get(sessionId);
  return row ? assertCliSessionApprovalRow(row) : undefined;
}

export function listPendingCliSessionApprovals(limit = 100): CliSessionApprovalRow[] {
  const rows = getDb().prepare(
    `SELECT * FROM cli_session_approvals
     WHERE status = 'pending'
     ORDER BY datetime(requested_at) DESC, rowid DESC
     LIMIT ?`
  ).all(Math.min(Math.max(limit, 1), 500));
  return rows.map(assertCliSessionApprovalRow);
}

export function resolveCliSessionApproval(params: {
  id: string;
  decision: CliSessionApprovalDecision;
  actorId?: string;
  reason?: string;
  now?: Date;
}): CliSessionApprovalRow | undefined {
  const now = iso(params.now);
  const decisionJson = safeJson({
    decision: params.decision,
    ...(params.reason ? { reason: params.reason } : {}),
  });
  getDb().prepare(
    `UPDATE cli_session_approvals
     SET status = @status,
         decision_json = @decision_json,
         actor_id = @actor_id,
         resolved_at = @resolved_at
     WHERE id = @id AND status = 'pending'`
  ).run({
    id: params.id,
    status: approvalStatusForDecision(params.decision),
    decision_json: decisionJson,
    actor_id: params.actorId ?? null,
    resolved_at: now,
  });
  return getCliSessionApproval(params.id);
}

export function timeoutCliSessionApproval(params: {
  id: string;
  reason?: string;
  now?: Date;
}): CliSessionApprovalRow | undefined {
  const now = iso(params.now);
  const decisionJson = safeJson({
    decision: "deny",
    reason: params.reason ?? "Permission request timed out in MiniClaw",
  });
  getDb().prepare(
    `UPDATE cli_session_approvals
     SET status = 'timed_out',
         decision_json = @decision_json,
         resolved_at = @resolved_at
     WHERE id = @id AND status = 'pending'`
  ).run({
    id: params.id,
    decision_json: decisionJson,
    resolved_at: now,
  });
  return getCliSessionApproval(params.id);
}

export function expirePendingCliSessionApprovals(params: {
  status: Extract<CliSessionApprovalStatus, "timed_out" | "expired">;
  now?: Date;
  reason?: string;
  includeUnexpired?: boolean;
}): number {
  const now = iso(params.now);
  const decisionJson = safeJson({
    decision: "deny",
    reason: params.reason ?? params.status,
  });
  const result = getDb().prepare(
    `UPDATE cli_session_approvals
     SET status = @status,
         decision_json = @decision_json,
         resolved_at = @resolved_at
     WHERE status = 'pending'
       AND (@include_unexpired = 1 OR datetime(expires_at) <= datetime(@resolved_at))`
  ).run({
    status: params.status,
    decision_json: decisionJson,
    resolved_at: now,
    include_unexpired: params.includeUnexpired ? 1 : 0,
  });
  return result.changes;
}

export function hideCliSession(id: string, hiddenAt = new Date()): boolean {
  const result = getDb()
    .prepare("UPDATE cli_sessions SET hidden_at = @hidden_at WHERE id = @id AND hidden_at IS NULL")
    .run({ id, hidden_at: iso(hiddenAt) });
  return result.changes > 0;
}

export function markCliSessionEnded(id: string, reason: string, endedAt = new Date()): boolean {
  const now = iso(endedAt);
  const result = getDb()
    .prepare(
      `UPDATE cli_sessions
       SET phase = 'ended',
           ended_at = COALESCE(ended_at, @ended_at),
           last_activity_at = @ended_at,
           last_event_name = @reason,
           attention_kind = NULL
       WHERE id = @id AND ended_at IS NULL`
    )
    .run({ id, ended_at: now, reason });
  return result.changes > 0;
}

export function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function markDeadCliSessions(options: {
  isPidAlive?: (pid: number) => boolean;
  now?: Date;
} = {}): number {
  const isPidAlive = options.isPidAlive ?? defaultPidAlive;
  const candidates = listCliSessions({ includeClosed: false, includeHidden: true, limit: 500 })
    .filter((session) => session.pid !== null);
  let ended = 0;
  for (const session of candidates) {
    if (session.pid !== null && !isPidAlive(session.pid)) {
      if (markCliSessionEnded(session.id, "pid_dead", options.now)) ended++;
    }
  }
  return ended;
}
