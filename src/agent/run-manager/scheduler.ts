import {
  isAgentMessageKind,
  updateRunStatus,
  upsertAgentSchedulerState,
  type AgentMessage,
  type AgentMessageKind,
  type AgentRun,
  type AgentSchedulerState,
  type AgentSchedulerStatus,
} from "../../store/agent-run-manager.js";
import type { TaskReporter } from "../task-reporter.js";
import type { AgentBus } from "./bus.js";

export const MANAGED_RUNTIME_SCHEDULER_VERSION = "managed-runtime-v1";
export const MANAGED_DAG_SCHEDULER_VERSION = "managed-runtime-dag-v1";

export interface ManagedSchedulerPlanNode {
  id: string;
  role: string;
  waits_for: AgentMessageKind[];
  after?: string[];
  repeatable?: boolean;
}

export const MANAGED_RUNTIME_SCHEDULER_PLAN: ManagedSchedulerPlanNode[] = [
  { id: "planner", role: "planner", waits_for: ["handoff"] },
  { id: "generator", role: "generator", waits_for: ["artifact", "finding"], after: ["planner"], repeatable: true },
  { id: "evaluator", role: "evaluator", waits_for: ["verdict"], after: ["generator"], repeatable: true },
];

export function createManagedSchedulerPlan(maxFixIterations: number): Record<string, unknown> {
  return {
    version: MANAGED_RUNTIME_SCHEDULER_VERSION,
    max_fix_iterations: maxFixIterations,
    nodes: MANAGED_RUNTIME_SCHEDULER_PLAN,
  };
}

export type ManagedDagFailPolicy = "fail_fast" | "continue";

export interface ManagedDagPlanNodeInput {
  id: string;
  role: string;
  instruction?: string;
  waits_for?: AgentMessageKind[];
  wait_kinds?: AgentMessageKind[];
  after?: string[];
  context_from?: string[];
  repeat_policy?: Record<string, unknown>;
}

export interface ManagedDagPlanInput {
  version?: string;
  nodes: ManagedDagPlanNodeInput[];
  max_nodes?: number;
  max_depth?: number;
  max_parallel?: number;
  fail_policy?: ManagedDagFailPolicy;
}

export interface ManagedDagPlanNode {
  id: string;
  role: string;
  instruction: string;
  waits_for: AgentMessageKind[];
  after: string[];
  context_from: string[];
  repeat_policy?: Record<string, unknown>;
}

export interface ManagedDagPlan {
  version: typeof MANAGED_DAG_SCHEDULER_VERSION;
  nodes: ManagedDagPlanNode[];
  max_nodes: number;
  max_depth: number;
  max_parallel: number;
  fail_policy: ManagedDagFailPolicy;
}

export interface ManagedDagPlanGuardrails {
  knownRoles?: readonly string[];
  maxNodes?: number;
  maxDepth?: number;
  maxParallel?: number;
}

const DEFAULT_DAG_MAX_NODES = 12;
const DEFAULT_DAG_MAX_DEPTH = 8;
const DEFAULT_DAG_MAX_PARALLEL = 3;
const NODE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error(`Invalid DAG scheduler ${label}: ${String(value)}`);
  }
  return Math.floor(value);
}

function uniqueStrings(values: unknown, label: string): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error(`Invalid DAG scheduler ${label}: expected array`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Invalid DAG scheduler ${label}: expected non-empty string`);
    }
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function messageKinds(values: unknown, label: string): AgentMessageKind[] {
  const raw = values === undefined ? ["finding"] : values;
  if (!Array.isArray(raw)) throw new Error(`Invalid DAG scheduler ${label}: expected array`);
  const out: AgentMessageKind[] = [];
  const seen = new Set<AgentMessageKind>();
  for (const value of raw) {
    if (!isAgentMessageKind(value)) {
      throw new Error(`Invalid DAG scheduler message kind: ${String(value)}`);
    }
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  if (!out.length) throw new Error(`Invalid DAG scheduler ${label}: at least one message kind is required`);
  return out;
}

function normalizeNode(node: ManagedDagPlanNodeInput, index: number): ManagedDagPlanNode {
  if (!isPlainObject(node)) throw new Error(`Invalid DAG scheduler node at index ${index}`);
  if (typeof node.id !== "string" || !NODE_ID_PATTERN.test(node.id)) {
    throw new Error(`Invalid DAG scheduler node id at index ${index}: ${String(node.id)}`);
  }
  if (typeof node.role !== "string" || !node.role.trim()) {
    throw new Error(`Invalid DAG scheduler role for node ${node.id}`);
  }
  const instruction = typeof node.instruction === "string" && node.instruction.trim()
    ? node.instruction.trim()
    : `Run DAG node ${node.id} as role ${node.role}.`;
  const repeatPolicy = isPlainObject(node.repeat_policy) ? node.repeat_policy : undefined;
  const contextFrom = uniqueStrings(node.context_from, `context_from for node ${node.id}`);
  return {
    id: node.id,
    role: node.role.trim(),
    instruction,
    waits_for: messageKinds(node.waits_for ?? node.wait_kinds, `waits_for for node ${node.id}`),
    after: [...new Set([...uniqueStrings(node.after, `after for node ${node.id}`), ...contextFrom])],
    context_from: contextFrom,
    ...(repeatPolicy ? { repeat_policy: repeatPolicy } : {}),
  };
}

function dependencyMap(nodes: ManagedDagPlanNode[]): Map<string, Set<string>> {
  return new Map(nodes.map((node) => [node.id, new Set(node.after)]));
}

function assertNoMissingDependencies(nodes: ManagedDagPlanNode[]): void {
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    for (const dep of [...node.after, ...node.context_from]) {
      if (!ids.has(dep)) {
        throw new Error(`Invalid DAG scheduler plan: node ${node.id} references unknown dependency ${dep}`);
      }
    }
    if (node.after.includes(node.id)) {
      throw new Error(`Invalid DAG scheduler plan: node ${node.id} cannot depend on itself`);
    }
  }
}

function dagDepth(nodes: ManagedDagPlanNode[]): number {
  const deps = dependencyMap(nodes);
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) {
      throw new Error(`Invalid DAG scheduler plan: cycle detected at node ${id}`);
    }
    visiting.add(id);
    const depth = 1 + Math.max(0, ...[...(deps.get(id) ?? new Set<string>())].map(visit));
    visiting.delete(id);
    memo.set(id, depth);
    return depth;
  };
  return Math.max(0, ...nodes.map((node) => visit(node.id)));
}

function assertKnownRoles(nodes: ManagedDagPlanNode[], knownRoles: readonly string[] | undefined): void {
  if (!knownRoles?.length) return;
  const allowed = new Set(knownRoles);
  for (const node of nodes) {
    if (!allowed.has(node.role)) {
      throw new Error(`Invalid DAG scheduler plan: node ${node.id} uses unknown role ${node.role}`);
    }
  }
}

export function validateManagedDagPlan(input: ManagedDagPlanInput, guardrails: ManagedDagPlanGuardrails = {}): ManagedDagPlan {
  if (!isPlainObject(input)) throw new Error("Invalid DAG scheduler plan: expected object");
  if (input.version !== undefined && input.version !== MANAGED_DAG_SCHEDULER_VERSION) {
    throw new Error(`Invalid DAG scheduler version: ${String(input.version)}`);
  }
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
    throw new Error("Invalid DAG scheduler plan: nodes must be a non-empty array");
  }

  const maxNodes = Math.min(
    positiveInt(input.max_nodes, guardrails.maxNodes ?? DEFAULT_DAG_MAX_NODES, "max_nodes"),
    guardrails.maxNodes ?? Number.POSITIVE_INFINITY,
  );
  const maxDepth = Math.min(
    positiveInt(input.max_depth, guardrails.maxDepth ?? DEFAULT_DAG_MAX_DEPTH, "max_depth"),
    guardrails.maxDepth ?? Number.POSITIVE_INFINITY,
  );
  const maxParallel = Math.min(
    positiveInt(input.max_parallel, guardrails.maxParallel ?? DEFAULT_DAG_MAX_PARALLEL, "max_parallel"),
    guardrails.maxParallel ?? Number.POSITIVE_INFINITY,
  );
  const failPolicy = input.fail_policy ?? "fail_fast";
  if (failPolicy !== "fail_fast" && failPolicy !== "continue") {
    throw new Error(`Invalid DAG scheduler fail_policy: ${String(input.fail_policy)}`);
  }

  if (input.nodes.length > maxNodes) {
    throw new Error(`DAG scheduler node limit exceeded: nodes=${input.nodes.length} max_nodes=${maxNodes}`);
  }
  const nodes = input.nodes.map(normalizeNode);
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error(`Invalid DAG scheduler plan: duplicate node id ${node.id}`);
    ids.add(node.id);
  }
  assertKnownRoles(nodes, guardrails.knownRoles);
  assertNoMissingDependencies(nodes);
  const depth = dagDepth(nodes);
  if (depth > maxDepth) {
    throw new Error(`DAG scheduler depth limit exceeded: depth=${depth} max_depth=${maxDepth}`);
  }

  const normalized: ManagedDagPlan = {
    version: MANAGED_DAG_SCHEDULER_VERSION,
    nodes,
    max_nodes: maxNodes,
    max_depth: maxDepth,
    max_parallel: maxParallel,
    fail_policy: failPolicy,
  };
  const widestBatch = Math.max(
    0,
    ...createDagExecutionBatches({ nodes: normalized.nodes, max_parallel: Number.MAX_SAFE_INTEGER })
      .map((batch) => batch.length),
  );
  if (widestBatch > maxParallel) {
    throw new Error(`DAG scheduler parallel limit exceeded: width=${widestBatch} max_parallel=${maxParallel}`);
  }
  return normalized;
}

export function createDagExecutionBatches(plan: Pick<ManagedDagPlan, "nodes" | "max_parallel">): ManagedDagPlanNode[][] {
  const nodesById = new Map(plan.nodes.map((node) => [node.id, node]));
  const indegree = new Map(plan.nodes.map((node) => [node.id, node.after.length]));
  const dependents = new Map<string, string[]>();
  const indexById = new Map(plan.nodes.map((node, index) => [node.id, index]));
  for (const node of plan.nodes) {
    for (const dep of node.after) {
      const list = dependents.get(dep) ?? [];
      list.push(node.id);
      dependents.set(dep, list);
    }
  }

  const ready = plan.nodes.filter((node) => node.after.length === 0).map((node) => node.id);
  const batches: ManagedDagPlanNode[][] = [];
  let processed = 0;
  while (ready.length) {
    ready.sort((a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0));
    const batchIds = ready.splice(0, Math.max(1, plan.max_parallel));
    batches.push(batchIds.map((id) => nodesById.get(id)).filter((node): node is ManagedDagPlanNode => Boolean(node)));
    processed += batchIds.length;
    for (const id of batchIds) {
      for (const dependent of dependents.get(id) ?? []) {
        const next = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, next);
        if (next === 0) ready.push(dependent);
      }
    }
  }
  if (processed !== plan.nodes.length) {
    throw new Error("Invalid DAG scheduler plan: cycle detected");
  }
  return batches;
}

export interface AgentRunSchedulerParams {
  taskId: string;
  rootRun: AgentRun;
  bus: AgentBus;
  reporter: TaskReporter;
  waitTimeoutMs: number;
  plan?: unknown;
}

export class AgentRunScheduler {
  private readonly plan: unknown;

  constructor(private readonly params: AgentRunSchedulerParams) {
    this.plan = params.plan ?? createManagedSchedulerPlan(0);
  }

  start(currentStep = "start"): AgentSchedulerState {
    return this.persist("running", currentStep);
  }

  running(currentStep: string, options: { lastMessageId?: string } = {}): AgentSchedulerState {
    updateRunStatus(this.params.rootRun.id, "running", { completedAt: null });
    return this.persist("running", currentStep, options);
  }

  complete(currentStep = "completed"): AgentSchedulerState {
    return this.persist("completed", currentStep);
  }

  fail(currentStep: string, message: string): AgentSchedulerState {
    return this.persist("failed", currentStep, { errorMessage: message });
  }

  cancel(reason: string): AgentSchedulerState {
    return this.persist("cancelled", "cancelled", { errorMessage: reason });
  }

  async yieldUntilChildEvent<T>(input: {
    currentStep: string;
    childRunId: string;
    waitKinds: AgentMessageKind[];
    signal: AbortSignal;
    runChild: () => Promise<T>;
    shouldWaitForResult?: (result: T) => boolean;
    ensureCompletionMessage?: (result: T) => void;
    timeoutMs?: number;
  }): Promise<{ result: T; wakeMessage?: AgentMessage }> {
    const waitController = new AbortController();
    const forwardAbort = () => waitController.abort(input.signal.reason);
    if (input.signal.aborted) forwardAbort();
    else input.signal.addEventListener("abort", forwardAbort, { once: true });

    updateRunStatus(this.params.rootRun.id, "waiting", { completedAt: null });
    this.persist("waiting", input.currentStep, {
      waitRunId: this.params.rootRun.id,
      waitKinds: input.waitKinds,
    });
    this.params.reporter.event("agent_scheduler_waiting", {
      payload: {
        root_run_id: this.params.rootRun.id,
        child_run_id: input.childRunId,
        current_step: input.currentStep,
        wait_kinds: input.waitKinds,
      },
    });

    const waitPromise = this.params.bus.waitForMessage({
      runId: this.params.rootRun.id,
      kinds: input.waitKinds,
      timeoutMs: input.timeoutMs ?? this.params.waitTimeoutMs,
      signal: waitController.signal,
    });
    waitPromise.catch(() => undefined);

    try {
      const result = await input.runChild();
      if (input.shouldWaitForResult && !input.shouldWaitForResult(result)) {
        waitController.abort(new Error("child result does not require scheduler wait"));
        waitPromise.catch(() => undefined);
        if (input.signal.aborted) this.cancel("scheduler wait aborted by root signal");
        else this.running(input.currentStep);
        return { result };
      }

      input.ensureCompletionMessage?.(result);
      const wakeMessage = await waitPromise;
      this.running(input.currentStep, { lastMessageId: wakeMessage.id });
      this.params.reporter.event("agent_scheduler_resumed", {
        payload: {
          root_run_id: this.params.rootRun.id,
          child_run_id: input.childRunId,
          current_step: input.currentStep,
          message_id: wakeMessage.id,
          kind: wakeMessage.kind,
        },
      });
      return { result, wakeMessage };
    } catch (err) {
      waitController.abort(err);
      waitPromise.catch(() => undefined);
      if (input.signal.aborted) this.cancel("scheduler wait aborted by root signal");
      else this.running(input.currentStep);
      throw err;
    } finally {
      input.signal.removeEventListener("abort", forwardAbort);
    }
  }

  private persist(
    status: AgentSchedulerStatus,
    currentStep: string,
    options: {
      waitRunId?: string;
      waitKinds?: AgentMessageKind[];
      lastMessageId?: string;
      errorMessage?: string;
    } = {},
  ): AgentSchedulerState {
    const state = upsertAgentSchedulerState({
      taskId: this.params.taskId,
      rootRunId: this.params.rootRun.id,
      schedulerVersion: this.schedulerVersion(),
      status,
      currentStep,
      ...(options.waitRunId ? { waitRunId: options.waitRunId } : {}),
      ...(options.waitKinds ? { waitKinds: options.waitKinds } : {}),
      ...(options.lastMessageId ? { lastMessageId: options.lastMessageId } : {}),
      plan: this.plan,
    });
    this.params.reporter.event("agent_scheduler_state_changed", {
      ...(status === "failed" ? { severity: "error" } : {}),
      ...(status === "cancelled" ? { severity: "warning" } : {}),
      ...(options.errorMessage ? { message: options.errorMessage } : {}),
      payload: {
        root_run_id: this.params.rootRun.id,
        status,
        current_step: currentStep,
        ...(state.wait_run_id ? { wait_run_id: state.wait_run_id } : {}),
        ...(state.wait_kinds.length ? { wait_kinds: state.wait_kinds } : {}),
        ...(state.last_message_id ? { last_message_id: state.last_message_id } : {}),
      },
    });
    return state;
  }

  private schedulerVersion(): string {
    const version = isPlainObject(this.plan) ? this.plan.version : undefined;
    return typeof version === "string" ? version : MANAGED_RUNTIME_SCHEDULER_VERSION;
  }
}
