import { getDb } from "../connection.js";

export interface SmartRouterDecisionRow {
  id: number;
  message_id: string;
  channel_id: string;
  user_id: string;
  prompt_hash: string;
  prompt_preview: string | null;
  full_prompt: string | null;
  intent: string;
  confidence: number;
  reason: string | null;
  matched_signals: string;
  risk_flags: string;
  capabilities_json: string | null;
  classifier_elapsed_ms: number | null;
  classifier_error_type: string | null;
  classifier_error_message: string | null;
  action_result: string | null;
  created_task_id: string | null;
  user_choice: string | null;
  final_route: string | null;
  task_final_status: string | null;
  correction_type: string | null;
  correction_note: string | null;
  resolved_at: string | null;
  created_at: string;
}

export type SmartRouterUserChoice =
  | "accepted_task"
  | "continued_chat"
  | "cancelled"
  | "ignored"
  | "auto_task_no_choice";
export type SmartRouterFinalRoute = "chat" | "task" | "none";
export type SmartRouterTaskFinalStatus = "completed" | "failed" | "cancelled" | "interrupted" | "not_created";
export type SmartRouterCorrectionType =
  | "false_positive"
  | "false_negative"
  | "classifier_error"
  | "policy_blocked"
  | "user_override"
  | "none";

export interface SmartRouterReviewRow extends SmartRouterDecisionRow {
  linked_task_status: string | null;
}

export function recordSmartRouterDecision(row: {
  message_id: string;
  channel_id: string;
  user_id: string;
  prompt_hash: string;
  prompt_preview?: string;
  full_prompt?: string;
  intent: string;
  confidence: number;
  reason?: string;
  matched_signals?: string[];
  risk_flags?: string[];
  capabilities_json?: string;
  classifier_elapsed_ms?: number;
  classifier_error_type?: string;
  classifier_error_message?: string;
  action_result?: string;
  created_task_id?: string;
  user_choice?: SmartRouterUserChoice;
  final_route?: SmartRouterFinalRoute;
  task_final_status?: SmartRouterTaskFinalStatus;
  correction_type?: SmartRouterCorrectionType;
  correction_note?: string;
  resolved_at?: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO smart_router_decisions (
        message_id, channel_id, user_id, prompt_hash, prompt_preview, full_prompt,
        intent, confidence, reason, matched_signals, risk_flags, capabilities_json,
        classifier_elapsed_ms, classifier_error_type, classifier_error_message,
        action_result, created_task_id, user_choice, final_route, task_final_status,
        correction_type, correction_note, resolved_at
      ) VALUES (
        @message_id, @channel_id, @user_id, @prompt_hash, @prompt_preview, @full_prompt,
        @intent, @confidence, @reason, @matched_signals, @risk_flags, @capabilities_json,
        @classifier_elapsed_ms, @classifier_error_type, @classifier_error_message,
        @action_result, @created_task_id, @user_choice, @final_route, @task_final_status,
        @correction_type, @correction_note, @resolved_at
      )`
    )
    .run({
      message_id: row.message_id,
      channel_id: row.channel_id,
      user_id: row.user_id,
      prompt_hash: row.prompt_hash,
      prompt_preview: row.prompt_preview ?? null,
      full_prompt: row.full_prompt ?? null,
      intent: row.intent,
      confidence: row.confidence,
      reason: row.reason ?? null,
      matched_signals: JSON.stringify(row.matched_signals ?? []),
      risk_flags: JSON.stringify(row.risk_flags ?? []),
      capabilities_json: row.capabilities_json ?? null,
      classifier_elapsed_ms: row.classifier_elapsed_ms ?? null,
      classifier_error_type: row.classifier_error_type ?? null,
      classifier_error_message: row.classifier_error_message ?? null,
      action_result: row.action_result ?? null,
      created_task_id: row.created_task_id ?? null,
      user_choice: row.user_choice ?? null,
      final_route: row.final_route ?? null,
      task_final_status: row.task_final_status ?? null,
      correction_type: row.correction_type ?? null,
      correction_note: row.correction_note ?? null,
      resolved_at: row.resolved_at ?? null,
    });
  return Number(result.lastInsertRowid);
}

export interface SmartRouterDecisionUpdate {
  action_result?: string | null;
  created_task_id?: string | null;
  user_choice?: SmartRouterUserChoice | null;
  final_route?: SmartRouterFinalRoute | null;
  task_final_status?: SmartRouterTaskFinalStatus | null;
  correction_type?: SmartRouterCorrectionType | null;
  correction_note?: string | null;
  resolved_at?: string | null;
}

export function updateSmartRouterDecision(id: number, updates: SmartRouterDecisionUpdate): void {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const key of [
    "action_result",
    "created_task_id",
    "user_choice",
    "final_route",
    "task_final_status",
    "correction_type",
    "correction_note",
    "resolved_at",
  ] as const) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = @${key}`);
      params[key] = updates[key];
    }
  }
  if (!fields.length) return;
  getDb().prepare(`UPDATE smart_router_decisions SET ${fields.join(", ")} WHERE id = @id`).run(params);
}

function resolvedAtNow(): string {
  return new Date().toISOString();
}

function normalizeTaskFinalStatus(status: string): SmartRouterTaskFinalStatus | undefined {
  if (status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted") {
    return status;
  }
  return undefined;
}

export function recordSmartRouterUserChoice(
  id: number,
  choice: SmartRouterUserChoice,
  finalRoute: SmartRouterFinalRoute,
  updates: Omit<SmartRouterDecisionUpdate, "user_choice" | "final_route"> = {}
): void {
  const terminal = finalRoute !== "task" || updates.task_final_status !== undefined;
  updateSmartRouterDecision(id, {
    user_choice: choice,
    final_route: finalRoute,
    correction_type: "none",
    ...updates,
    ...(terminal && updates.resolved_at === undefined ? { resolved_at: resolvedAtNow() } : {}),
  });
}

export function recordSmartRouterTaskOutcome(taskId: string, status: string): number {
  const taskFinalStatus = normalizeTaskFinalStatus(status);
  if (!taskFinalStatus) return 0;
  const result = getDb()
    .prepare(
      `UPDATE smart_router_decisions
       SET task_final_status = @task_final_status,
           final_route = COALESCE(final_route, 'task'),
           correction_type = COALESCE(correction_type, 'none'),
           resolved_at = @resolved_at
       WHERE created_task_id = @task_id`
    )
    .run({
      task_id: taskId,
      task_final_status: taskFinalStatus,
      resolved_at: resolvedAtNow(),
    });
  return Number(result.changes ?? 0);
}

export function getRecentSmartRouterDecisions(limit = 20): SmartRouterDecisionRow[] {
  return getDb()
    .prepare("SELECT * FROM smart_router_decisions ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as SmartRouterDecisionRow[];
}

export function listSmartRouterReviewRows(options: {
  since?: string;
  until?: string;
  channelId?: string;
  limit?: number;
} = {}): SmartRouterReviewRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {
    limit: Math.max(1, Math.min(options.limit ?? 200, 1000)),
  };
  if (options.since) {
    where.push("d.created_at >= @since");
    params.since = options.since;
  }
  if (options.until) {
    where.push("d.created_at <= @until");
    params.until = options.until;
  }
  if (options.channelId) {
    where.push("d.channel_id = @channel_id");
    params.channel_id = options.channelId;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return getDb()
    .prepare(
      `SELECT d.*, t.status AS linked_task_status
       FROM smart_router_decisions d
       LEFT JOIN tasks t ON t.id = d.created_task_id
       ${whereSql}
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT @limit`
    )
    .all(params) as SmartRouterReviewRow[];
}
