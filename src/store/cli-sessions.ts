import { v4 as uuid } from "uuid";
import { getDb } from "./connection.js";
import {
  mapHookEventToPhase,
  isCliSessionProvider,
  isCliSessionPhase,
} from "../hookd/state.js";
import type {
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
