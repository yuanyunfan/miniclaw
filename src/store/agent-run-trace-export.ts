import {
  getAgentSchedulerState,
  listActiveFacts,
  listArtifactsForTask,
  listMessagesForTask,
  listRunsForTask,
  type AgentArtifact,
  type AgentMessage,
  type AgentRun,
  type AgentSchedulerState,
  type BlackboardFact,
} from "./agent-run-manager.js";
import {
  DEFAULT_DIAGNOSTIC_TEXT_CHARS,
  redactDiagnosticText,
  redactDiagnosticValue,
} from "../privacy/diagnostic-redaction.js";

export interface AgentRunTraceModel {
  taskId: string;
  runs: AgentRunTraceRun[];
  messages: AgentRunTraceMessage[];
  artifacts: AgentRunTraceArtifact[];
  blackboardFacts: AgentRunTraceFact[];
  scheduler?: AgentRunTraceScheduler;
  generatedAt: string;
}

export interface AgentRunTraceRun {
  id: string;
  parentRunId: string | null;
  role: string;
  runtime: string;
  status: string;
  spawnDepth: number;
  controlScope: string;
  contextMode: string;
  toolPolicyId: string;
  canSpawn: boolean;
  canWriteWorkspace: boolean;
  providerSessionId: string | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface AgentRunTraceMessage {
  id: string;
  fromRunId: string;
  fromRole: string;
  toRunId: string | null;
  toRole: string;
  kind: string;
  contentText: string | null;
  payloadKeys: string[];
  artifactIds: string[];
  causalMessageId: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface AgentRunTraceArtifact {
  id: string;
  runId: string;
  role: string;
  kind: string;
  path: string;
  title: string | null;
  summary: string | null;
  contentHash: string;
  createdAt: string;
}

export interface AgentRunTraceFact {
  id: string;
  key: string;
  content: string;
  sourceMessageId: string;
  confidence: string;
  status: string;
  updatedAt: string;
}

export interface AgentRunTraceScheduler {
  rootRunId: string;
  schedulerVersion: string;
  status: string;
  currentStep: string;
  waitRunId: string | null;
  waitKinds: string[];
  lastMessageId: string | null;
  planVersion: string | null;
  planNodeCount: number | null;
  planMaxParallel: number | null;
  updatedAt: string;
}

export interface AgentRunTraceModelOptions {
  maxRuns?: number;
  maxMessages?: number;
  maxArtifacts?: number;
  maxFacts?: number;
  maxFieldChars?: number;
}

export interface AgentRunTraceRenderOptions {
  headingLevel?: number;
}

const DEFAULT_MAX_RUNS = 120;
const DEFAULT_MAX_MESSAGES = 120;
const DEFAULT_MAX_ARTIFACTS = 80;
const DEFAULT_MAX_FACTS = 80;

function positiveIntOption(value: number | undefined, fallback: number, min = 1): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : "-";
}

function sanitizeText(value: string | null | undefined, maxChars: number): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? redactDiagnosticText(trimmed, { maxChars }) : null;
}

function sanitizeSession(value: string | null, maxChars: number): string | null {
  if (!value) return null;
  return String(redactDiagnosticValue("session_id", value, { maxChars }));
}

function roleMap(runs: AgentRun[]): Map<string, string> {
  return new Map(runs.map((run) => [run.id, run.role]));
}

function payloadKeys(message: AgentMessage): string[] {
  if (!message.payload_json || typeof message.payload_json !== "object" || Array.isArray(message.payload_json)) return [];
  return Object.keys(message.payload_json as Record<string, unknown>).sort();
}

function planField(plan: unknown, key: string): unknown {
  return plan && typeof plan === "object" && !Array.isArray(plan)
    ? (plan as Record<string, unknown>)[key]
    : undefined;
}

function schedulerTrace(state: AgentSchedulerState | undefined): AgentRunTraceScheduler | undefined {
  if (!state) return undefined;
  const version = planField(state.plan_json, "version");
  const nodes = planField(state.plan_json, "nodes");
  const maxParallel = planField(state.plan_json, "max_parallel");
  return {
    rootRunId: state.root_run_id,
    schedulerVersion: state.scheduler_version,
    status: state.status,
    currentStep: state.current_step,
    waitRunId: state.wait_run_id,
    waitKinds: state.wait_kinds,
    lastMessageId: state.last_message_id,
    planVersion: typeof version === "string" ? version : null,
    planNodeCount: Array.isArray(nodes) ? nodes.length : null,
    planMaxParallel: typeof maxParallel === "number" ? maxParallel : null,
    updatedAt: state.updated_at,
  };
}

function runTrace(run: AgentRun, maxChars: number): AgentRunTraceRun {
  return {
    id: run.id,
    parentRunId: run.parent_run_id,
    role: run.role,
    runtime: run.runtime,
    status: run.status,
    spawnDepth: run.spawn_depth,
    controlScope: run.control_scope,
    contextMode: run.context_mode,
    toolPolicyId: run.tool_policy_id,
    canSpawn: run.can_spawn,
    canWriteWorkspace: run.can_write_workspace,
    providerSessionId: sanitizeSession(run.provider_session_id, maxChars),
    startedAt: run.started_at,
    completedAt: run.completed_at,
    errorMessage: sanitizeText(run.error_message, maxChars),
  };
}

function messageTrace(message: AgentMessage, roles: Map<string, string>, maxChars: number): AgentRunTraceMessage {
  return {
    id: message.id,
    fromRunId: message.from_run_id,
    fromRole: roles.get(message.from_run_id) ?? shortId(message.from_run_id),
    toRunId: message.to_run_id,
    toRole: message.to_run_id ? (roles.get(message.to_run_id) ?? shortId(message.to_run_id)) : "broadcast",
    kind: message.kind,
    contentText: sanitizeText(message.content_text, maxChars),
    payloadKeys: payloadKeys(message),
    artifactIds: message.artifact_ids,
    causalMessageId: message.causal_message_id,
    deliveredAt: message.delivered_at,
    createdAt: message.created_at,
  };
}

function artifactTrace(artifact: AgentArtifact, roles: Map<string, string>, maxChars: number): AgentRunTraceArtifact {
  return {
    id: artifact.id,
    runId: artifact.run_id,
    role: roles.get(artifact.run_id) ?? shortId(artifact.run_id),
    kind: artifact.kind,
    path: sanitizeText(artifact.path, maxChars) ?? "-",
    title: sanitizeText(artifact.title, maxChars),
    summary: sanitizeText(artifact.summary, maxChars),
    contentHash: artifact.content_hash,
    createdAt: artifact.created_at,
  };
}

function factTrace(fact: BlackboardFact, maxChars: number): AgentRunTraceFact {
  return {
    id: fact.id,
    key: sanitizeText(fact.key, maxChars) ?? "-",
    content: sanitizeText(fact.content, maxChars) ?? "-",
    sourceMessageId: fact.source_message_id,
    confidence: fact.confidence,
    status: fact.status,
    updatedAt: fact.updated_at,
  };
}

export function buildAgentRunTraceModel(
  taskId: string,
  options: AgentRunTraceModelOptions = {},
): AgentRunTraceModel | undefined {
  const runs = listRunsForTask(taskId);
  if (!runs.length) return undefined;
  const maxFieldChars = positiveIntOption(options.maxFieldChars, DEFAULT_DIAGNOSTIC_TEXT_CHARS, 20);
  const roles = roleMap(runs);
  const maxRuns = positiveIntOption(options.maxRuns, DEFAULT_MAX_RUNS);
  const maxMessages = positiveIntOption(options.maxMessages, DEFAULT_MAX_MESSAGES);
  const maxArtifacts = positiveIntOption(options.maxArtifacts, DEFAULT_MAX_ARTIFACTS);
  const maxFacts = positiveIntOption(options.maxFacts, DEFAULT_MAX_FACTS);

  return {
    taskId,
    runs: runs.slice(0, maxRuns).map((run) => runTrace(run, maxFieldChars)),
    messages: listMessagesForTask(taskId).slice(-maxMessages).map((message) => messageTrace(message, roles, maxFieldChars)),
    artifacts: listArtifactsForTask(taskId).slice(-maxArtifacts).map((artifact) => artifactTrace(artifact, roles, maxFieldChars)),
    blackboardFacts: listActiveFacts(taskId).slice(-maxFacts).map((fact) => factTrace(fact, maxFieldChars)),
    scheduler: schedulerTrace(getAgentSchedulerState(taskId)),
    generatedAt: new Date().toISOString(),
  };
}

function heading(level: number, text: string): string {
  return `${"#".repeat(Math.min(6, Math.max(1, level)))} ${text}`;
}

function runLine(run: AgentRunTraceRun): string {
  const indent = "  ".repeat(Math.max(0, run.spawnDepth));
  const parent = run.parentRunId ? ` parent=${shortId(run.parentRunId)}` : "";
  const write = run.canWriteWorkspace ? " write=true" : "";
  const session = run.providerSessionId ? ` session=${run.providerSessionId}` : "";
  const error = run.errorMessage ? ` error=${run.errorMessage}` : "";
  return `${indent}- ${run.role}(${shortId(run.id)}) status=${run.status} runtime=${run.runtime} policy=${run.toolPolicyId}${write}${parent}${session}${error}`;
}

function schedulerLines(scheduler: AgentRunTraceScheduler | undefined): string[] {
  if (!scheduler) return ["- (none)"];
  return [
    `- status/current_step: ${scheduler.status} / ${scheduler.currentStep}`,
    `- root_run: ${shortId(scheduler.rootRunId)} wait_run: ${shortId(scheduler.waitRunId)} wait_kinds: ${scheduler.waitKinds.join(",") || "-"}`,
    `- last_message: ${shortId(scheduler.lastMessageId)} scheduler_version: ${scheduler.schedulerVersion} plan_version: ${scheduler.planVersion ?? "-"}`,
    `- plan_nodes: ${scheduler.planNodeCount ?? "-"} max_parallel: ${scheduler.planMaxParallel ?? "-"} updated_at: ${scheduler.updatedAt}`,
  ];
}

function messageLine(message: AgentRunTraceMessage): string {
  const artifacts = message.artifactIds.length ? ` artifacts=${message.artifactIds.map(shortId).join(",")}` : "";
  const payload = message.payloadKeys.length ? ` payload_keys=${message.payloadKeys.join(",")}` : "";
  const causal = message.causalMessageId ? ` causal=${shortId(message.causalMessageId)}` : "";
  const text = message.contentText ? ` text=${message.contentText}` : "";
  return `- ${message.createdAt} ${message.kind} ${message.fromRole}(${shortId(message.fromRunId)})->${message.toRole}(${shortId(message.toRunId)})${artifacts}${payload}${causal}${text}`;
}

function artifactLine(artifact: AgentRunTraceArtifact): string {
  const title = artifact.title ? ` title=${artifact.title}` : "";
  const summary = artifact.summary ? ` summary=${artifact.summary}` : "";
  return `- ${shortId(artifact.id)} role=${artifact.role} kind=${artifact.kind}${title}${summary} path=${artifact.path} hash=${artifact.contentHash.slice(0, 12)}`;
}

function factLine(fact: AgentRunTraceFact): string {
  return `- ${fact.key}: ${fact.content} confidence=${fact.confidence} status=${fact.status} source=${shortId(fact.sourceMessageId)}`;
}

export function formatAgentRunTraceSummary(model: AgentRunTraceModel): string {
  const scheduler = model.scheduler ? ` scheduler=${model.scheduler.status}/${model.scheduler.currentStep}` : " scheduler=none";
  return `agent_runs=${model.runs.length} messages=${model.messages.length} artifacts=${model.artifacts.length} facts=${model.blackboardFacts.length}${scheduler}`;
}

export function formatAgentRunTraceCompactLines(model: AgentRunTraceModel, limit = 4): string[] {
  const max = positiveIntOption(limit, 4);
  const lines = [
    `- ${formatAgentRunTraceSummary(model)}`,
    ...model.runs.slice(-max).map((run) => `- run ${run.role}(${shortId(run.id)}) ${run.status}`),
    ...model.messages.slice(-max).map((message) => `- message ${message.kind} ${message.fromRole}->${message.toRole}${message.contentText ? ` ${message.contentText}` : ""}`),
  ];
  return lines.slice(0, 1 + max * 2);
}

export function renderAgentRunTraceMarkdown(
  model: AgentRunTraceModel,
  options: AgentRunTraceRenderOptions = {},
): string {
  const h = positiveIntOption(options.headingLevel, 2);
  const lines = [
    heading(h, "Agent Run Manager"),
    `- generated_at: ${model.generatedAt}`,
    `- task_id: ${model.taskId}`,
    `- summary: ${formatAgentRunTraceSummary(model)}`,
    "",
    heading(h + 1, "Scheduler"),
    ...schedulerLines(model.scheduler),
    "",
    heading(h + 1, "Run Tree"),
    ...(model.runs.length ? model.runs.map(runLine) : ["- (none)"]),
    "",
    heading(h + 1, "Messages"),
    ...(model.messages.length ? model.messages.map(messageLine) : ["- (none)"]),
    "",
    heading(h + 1, "Artifacts"),
    ...(model.artifacts.length ? model.artifacts.map(artifactLine) : ["- (none)"]),
    "",
    heading(h + 1, "Blackboard"),
    ...(model.blackboardFacts.length ? model.blackboardFacts.map(factLine) : ["- (none)"]),
  ];
  return lines.join("\n");
}
