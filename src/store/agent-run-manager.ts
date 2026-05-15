import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getDb } from "./connection.js";

export const AGENT_RUN_STATUSES = ["queued", "running", "waiting", "completed", "failed", "cancelled"] as const;
export type AgentRunStatus = typeof AGENT_RUN_STATUSES[number];
export const AGENT_CONTEXT_MODES = ["isolated", "fork"] as const;
export type AgentContextMode = "isolated" | "fork";
export const AGENT_CONTROL_SCOPES = ["root", "child", "peer"] as const;
export type AgentControlScope = "root" | "child" | "peer";
export const AGENT_RUNTIME_IDS = ["claude", "codex", "external-acp", "fake"] as const;
export type AgentRuntimeId = "claude" | "codex" | "external-acp" | "fake";
export const AGENT_MESSAGE_KINDS = [
  "finding",
  "question",
  "answer",
  "challenge",
  "decision",
  "handoff",
  "artifact",
  "verdict",
  "error",
] as const;
export type AgentMessageKind =
  | "finding"
  | "question"
  | "answer"
  | "challenge"
  | "decision"
  | "handoff"
  | "artifact"
  | "verdict"
  | "error";
export const BLACKBOARD_FACT_CONFIDENCES = ["low", "medium", "high"] as const;
export type BlackboardFactConfidence = "low" | "medium" | "high";
export const BLACKBOARD_FACT_STATUSES = ["active", "superseded", "rejected"] as const;
export type BlackboardFactStatus = "active" | "superseded" | "rejected";
export const AGENT_ARTIFACT_KINDS = ["markdown", "json", "diff", "log", "file_ref"] as const;
export type AgentArtifactKind = "markdown" | "json" | "diff" | "log" | "file_ref";

export interface DiscordRouteState {
  discord_channel_id?: string;
  discord_thread_id?: string;
  discord_message_id?: string;
  requester_user_id?: string;
  root_task_id?: string;
}

export interface AgentRun {
  id: string;
  task_id: string;
  parent_run_id: string | null;
  controller_run_id: string | null;
  requester_run_id: string | null;
  role: string;
  runtime: AgentRuntimeId;
  provider_session_id: string | null;
  status: AgentRunStatus;
  spawn_depth: number;
  control_scope: AgentControlScope;
  context_mode: AgentContextMode;
  cwd: string;
  tool_policy_id: string;
  can_spawn: boolean;
  can_write_workspace: boolean;
  can_send_kinds: string[];
  can_receive_kinds: string[];
  route?: DiscordRouteState;
  prompt_context_hash: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface AgentMessage {
  id: string;
  task_id: string;
  from_run_id: string;
  to_run_id: string | null;
  kind: AgentMessageKind;
  content_text: string | null;
  payload_json: unknown;
  artifact_ids: string[];
  causal_message_id: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface BlackboardFact {
  id: string;
  task_id: string;
  key: string;
  content: string;
  source_message_id: string;
  confidence: BlackboardFactConfidence;
  status: BlackboardFactStatus;
  created_at: string;
  updated_at: string;
}

export interface AgentArtifact {
  id: string;
  task_id: string;
  run_id: string;
  kind: AgentArtifactKind;
  path: string;
  title: string | null;
  summary: string | null;
  content_hash: string;
  created_at: string;
}

type AgentRunRow = Omit<AgentRun, "can_spawn" | "can_write_workspace" | "can_send_kinds" | "can_receive_kinds" | "route"> & {
  can_spawn: number;
  can_write_workspace: number;
  can_send_kinds_json: string;
  can_receive_kinds_json: string;
  route_json: string | null;
};

type AgentMessageRow = Omit<AgentMessage, "payload_json" | "artifact_ids"> & {
  payload_json: string | null;
  artifact_ids_json: string;
};

function includesReadonly<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isAgentMessageKind(value: unknown): value is AgentMessageKind {
  return includesReadonly(AGENT_MESSAGE_KINDS, value);
}

export function isAgentArtifactKind(value: unknown): value is AgentArtifactKind {
  return includesReadonly(AGENT_ARTIFACT_KINDS, value);
}

export function isBlackboardFactConfidence(value: unknown): value is BlackboardFactConfidence {
  return includesReadonly(BLACKBOARD_FACT_CONFIDENCES, value);
}

export function isBlackboardFactStatus(value: unknown): value is BlackboardFactStatus {
  return includesReadonly(BLACKBOARD_FACT_STATUSES, value);
}

function assertKnown<T extends readonly string[]>(values: T, value: unknown, label: string): asserts value is T[number] {
  if (!includesReadonly(values, value)) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function json(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function toRun(row: AgentRunRow): AgentRun {
  const route = parseJson<DiscordRouteState | undefined>(row.route_json, undefined);
  return {
    ...row,
    can_spawn: row.can_spawn === 1,
    can_write_workspace: row.can_write_workspace === 1,
    can_send_kinds: parseJson<string[]>(row.can_send_kinds_json, []),
    can_receive_kinds: parseJson<string[]>(row.can_receive_kinds_json, []),
    ...(route ? { route } : {}),
  };
}

function toMessage(row: AgentMessageRow): AgentMessage {
  return {
    ...row,
    payload_json: parseJson<unknown>(row.payload_json, undefined),
    artifact_ids: parseJson<string[]>(row.artifact_ids_json, []),
  };
}

function artifactExtension(kind: AgentArtifactKind): string {
  switch (kind) {
    case "markdown":
      return "md";
    case "json":
      return "json";
    case "diff":
      return "diff";
    case "log":
      return "log";
    case "file_ref":
      return "txt";
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function resolveArtifactPath(cwd: string, path: string): string {
  return path.startsWith("/") ? path : resolve(cwd, path);
}

export interface CreateRunInput {
  id?: string;
  taskId: string;
  parentRunId?: string;
  controllerRunId?: string;
  requesterRunId?: string;
  role: string;
  runtime: AgentRuntimeId;
  providerSessionId?: string;
  status?: AgentRunStatus;
  spawnDepth?: number;
  controlScope: AgentControlScope;
  contextMode?: AgentContextMode;
  cwd: string;
  toolPolicyId: string;
  canSpawn?: boolean;
  canWriteWorkspace?: boolean;
  canSendKinds?: string[];
  canReceiveKinds?: string[];
  route?: DiscordRouteState;
  promptContextHash?: string;
}

export function createRun(input: CreateRunInput): AgentRun {
  const id = input.id ?? randomUUID();
  const status = input.status ?? "running";
  const contextMode = input.contextMode ?? "isolated";
  assertKnown(AGENT_RUNTIME_IDS, input.runtime, "agent runtime");
  assertKnown(AGENT_RUN_STATUSES, status, "agent run status");
  assertKnown(AGENT_CONTROL_SCOPES, input.controlScope, "agent control scope");
  assertKnown(AGENT_CONTEXT_MODES, contextMode, "agent context mode");
  getDb().prepare(
    `INSERT INTO agent_runs (
       id, task_id, parent_run_id, controller_run_id, requester_run_id, role, runtime,
       provider_session_id, status, spawn_depth, control_scope, context_mode, cwd,
       tool_policy_id, can_spawn, can_write_workspace, can_send_kinds_json,
       can_receive_kinds_json, route_json, prompt_context_hash
     ) VALUES (
       @id, @task_id, @parent_run_id, @controller_run_id, @requester_run_id, @role, @runtime,
       @provider_session_id, @status, @spawn_depth, @control_scope, @context_mode, @cwd,
       @tool_policy_id, @can_spawn, @can_write_workspace, @can_send_kinds_json,
       @can_receive_kinds_json, @route_json, @prompt_context_hash
     )`
  ).run({
    id,
    task_id: input.taskId,
    parent_run_id: input.parentRunId ?? null,
    controller_run_id: input.controllerRunId ?? null,
    requester_run_id: input.requesterRunId ?? null,
    role: input.role,
    runtime: input.runtime,
    provider_session_id: input.providerSessionId ?? null,
    status,
    spawn_depth: input.spawnDepth ?? 0,
    control_scope: input.controlScope,
    context_mode: contextMode,
    cwd: input.cwd,
    tool_policy_id: input.toolPolicyId,
    can_spawn: input.canSpawn ? 1 : 0,
    can_write_workspace: input.canWriteWorkspace ? 1 : 0,
    can_send_kinds_json: JSON.stringify(input.canSendKinds ?? []),
    can_receive_kinds_json: JSON.stringify(input.canReceiveKinds ?? []),
    route_json: json(input.route),
    prompt_context_hash: input.promptContextHash ?? null,
  });
  return getRun(id) as AgentRun;
}

export function getRun(id: string): AgentRun | undefined {
  const row = getDb().prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as AgentRunRow | undefined;
  return row ? toRun(row) : undefined;
}

export function updateRunStatus(
  id: string,
  status: AgentRunStatus,
  options: { providerSessionId?: string; errorMessage?: string; completedAt?: string | null } = {},
): void {
  assertKnown(AGENT_RUN_STATUSES, status, "agent run status");
  const terminal = status === "completed" || status === "failed" || status === "cancelled";
  getDb().prepare(
    `UPDATE agent_runs
     SET status = @status,
         provider_session_id = COALESCE(@provider_session_id, provider_session_id),
         error_message = @error_message,
         completed_at = @completed_at
     WHERE id = @id`
  ).run({
    id,
    status,
    provider_session_id: options.providerSessionId ?? null,
    error_message: options.errorMessage ?? null,
    completed_at: options.completedAt === undefined
      ? (terminal ? new Date().toISOString() : null)
      : options.completedAt,
  });
}

export function listRunsForTask(taskId: string): AgentRun[] {
  return (getDb()
    .prepare("SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at ASC, rowid ASC")
    .all(taskId) as AgentRunRow[]).map(toRun);
}

export function listActiveChildren(parentRunId: string): AgentRun[] {
  return (getDb()
    .prepare(
      `SELECT * FROM agent_runs
       WHERE parent_run_id = ?
         AND status IN ('queued', 'running', 'waiting')
       ORDER BY started_at ASC, rowid ASC`
    )
    .all(parentRunId) as AgentRunRow[]).map(toRun);
}

export interface AppendMessageInput {
  id?: string;
  taskId: string;
  fromRunId: string;
  toRunId?: string;
  kind: AgentMessageKind;
  contentText?: string;
  payload?: unknown;
  artifactIds?: string[];
  causalMessageId?: string;
}

export function appendMessage(input: AppendMessageInput): AgentMessage {
  const id = input.id ?? randomUUID();
  assertKnown(AGENT_MESSAGE_KINDS, input.kind, "agent message kind");
  const fromRun = getRun(input.fromRunId);
  if (!fromRun) throw new Error(`Unknown sender agent run: ${input.fromRunId}`);
  if (fromRun.task_id !== input.taskId) {
    throw new Error(`Sender run ${input.fromRunId} does not belong to task ${input.taskId}`);
  }
  if (input.toRunId) {
    const toRun = getRun(input.toRunId);
    if (!toRun) throw new Error(`Unknown target agent run: ${input.toRunId}`);
    if (toRun.task_id !== input.taskId) {
      throw new Error(`Target run ${input.toRunId} does not belong to task ${input.taskId}`);
    }
  }
  getDb().prepare(
    `INSERT INTO agent_messages (
       id, task_id, from_run_id, to_run_id, kind, content_text, payload_json,
       artifact_ids_json, causal_message_id
     ) VALUES (
       @id, @task_id, @from_run_id, @to_run_id, @kind, @content_text, @payload_json,
       @artifact_ids_json, @causal_message_id
     )`
  ).run({
    id,
    task_id: input.taskId,
    from_run_id: input.fromRunId,
    to_run_id: input.toRunId ?? null,
    kind: input.kind,
    content_text: input.contentText ?? null,
    payload_json: json(input.payload),
    artifact_ids_json: JSON.stringify(input.artifactIds ?? []),
    causal_message_id: input.causalMessageId ?? null,
  });
  return getMessage(id) as AgentMessage;
}

export function getMessage(id: string): AgentMessage | undefined {
  const row = getDb().prepare("SELECT * FROM agent_messages WHERE id = ?").get(id) as AgentMessageRow | undefined;
  return row ? toMessage(row) : undefined;
}

export function readMailbox(input: { runId: string; afterCursor?: string; includeDelivered?: boolean }): AgentMessage[] {
  const params: Record<string, unknown> = { run_id: input.runId };
  let afterClause = "";
  if (input.afterCursor) {
    const cursor = getMessage(input.afterCursor);
    if (cursor) {
      params.after_created_at = cursor.created_at;
      params.after_id = cursor.id;
      afterClause = "AND (created_at > @after_created_at OR (created_at = @after_created_at AND id > @after_id))";
    }
  }
  const deliveredClause = input.includeDelivered === false ? "AND delivered_at IS NULL" : "";
  return (getDb()
    .prepare(
      `SELECT * FROM agent_messages
       WHERE (to_run_id = @run_id OR to_run_id IS NULL)
       ${afterClause}
       ${deliveredClause}
       ORDER BY created_at ASC, id ASC`
    )
    .all(params) as AgentMessageRow[]).map(toMessage);
}

export function markMessageDelivered(id: string, deliveredAt = new Date().toISOString()): void {
  getDb().prepare("UPDATE agent_messages SET delivered_at = @delivered_at WHERE id = @id").run({
    id,
    delivered_at: deliveredAt,
  });
}

export function upsertBlackboardFact(input: {
  id?: string;
  taskId: string;
  key: string;
  content: string;
  sourceMessageId: string;
  confidence: BlackboardFactConfidence;
  status?: BlackboardFactStatus;
}): BlackboardFact {
  const id = input.id ?? randomUUID();
  assertKnown(BLACKBOARD_FACT_CONFIDENCES, input.confidence, "blackboard fact confidence");
  const status = input.status ?? "active";
  assertKnown(BLACKBOARD_FACT_STATUSES, status, "blackboard fact status");
  if (!getMessage(input.sourceMessageId)) {
    throw new Error(`Unknown source agent message: ${input.sourceMessageId}`);
  }
  getDb().prepare(
    `INSERT INTO blackboard_facts (
       id, task_id, key, content, source_message_id, confidence, status, updated_at
     ) VALUES (
       @id, @task_id, @key, @content, @source_message_id, @confidence, @status, datetime('now')
     )
     ON CONFLICT(task_id, key) DO UPDATE SET
       content = excluded.content,
       source_message_id = excluded.source_message_id,
       confidence = excluded.confidence,
       status = excluded.status,
       updated_at = datetime('now')`
  ).run({
    id,
    task_id: input.taskId,
    key: input.key,
    content: input.content,
    source_message_id: input.sourceMessageId,
    confidence: input.confidence,
    status,
  });
  return getDb()
    .prepare("SELECT * FROM blackboard_facts WHERE task_id = ? AND key = ?")
    .get(input.taskId, input.key) as BlackboardFact;
}

export function listActiveFacts(taskId: string): BlackboardFact[] {
  return getDb()
    .prepare("SELECT * FROM blackboard_facts WHERE task_id = ? AND status = 'active' ORDER BY updated_at ASC, key ASC")
    .all(taskId) as BlackboardFact[];
}

export function writeArtifact(input: {
  id?: string;
  taskId: string;
  runId: string;
  kind: AgentArtifactKind;
  cwd: string;
  title?: string;
  summary?: string;
  content?: string;
  path?: string;
}): AgentArtifact {
  const id = input.id ?? randomUUID();
  assertKnown(AGENT_ARTIFACT_KINDS, input.kind, "agent artifact kind");
  const run = getRun(input.runId);
  if (!run) throw new Error(`Unknown artifact owner agent run: ${input.runId}`);
  if (run.task_id !== input.taskId) {
    throw new Error(`Artifact owner ${input.runId} does not belong to task ${input.taskId}`);
  }
  const relativePath = input.path ?? join(".miniclaw-task", input.taskId, "artifacts", input.runId, `${id}.${artifactExtension(input.kind)}`);
  const absolutePath = resolveArtifactPath(input.cwd, relativePath);
  const content = input.content ?? (existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "");
  if (input.content !== undefined) {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, input.content, "utf8");
  }
  const contentHash = hashContent(input.kind === "file_ref" ? relativePath : content);
  getDb().prepare(
    `INSERT INTO agent_artifacts (
       id, task_id, run_id, kind, path, title, summary, content_hash
     ) VALUES (
       @id, @task_id, @run_id, @kind, @path, @title, @summary, @content_hash
     )`
  ).run({
    id,
    task_id: input.taskId,
    run_id: input.runId,
    kind: input.kind,
    path: relativePath,
    title: input.title ?? null,
    summary: input.summary ?? null,
    content_hash: contentHash,
  });
  return getArtifact(id) as AgentArtifact;
}

export function getArtifact(id: string): AgentArtifact | undefined {
  return getDb().prepare("SELECT * FROM agent_artifacts WHERE id = ?").get(id) as AgentArtifact | undefined;
}

export function readArtifact(id: string, cwd: string): { artifact: AgentArtifact; content: string | null } | undefined {
  const artifact = getArtifact(id);
  if (!artifact) return undefined;
  const path = resolveArtifactPath(cwd, artifact.path);
  const content = existsSync(path) ? readFileSync(path, "utf8") : null;
  return { artifact, content };
}

export function listArtifactsForRun(runId: string): AgentArtifact[] {
  return getDb()
    .prepare("SELECT * FROM agent_artifacts WHERE run_id = ? ORDER BY created_at ASC, id ASC")
    .all(runId) as AgentArtifact[];
}
