import type Database from "better-sqlite3";
import { existsSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { createLogger } from "../../lib/log.js";
import { getDb } from "../../store/connection.js";
import {
  getRun,
  listActiveAgentRuns,
  listAgentSchedulerStates,
  readMailbox,
  updateRunStatus,
  upsertAgentSchedulerState,
  type AgentRun,
  type AgentRunStatus,
  type AgentSchedulerState,
  type AgentSchedulerStatus,
} from "../../store/agent-run-manager.js";
import { getTask, type TaskRow } from "../../store/repositories/tasks.js";
import { appendTaskEvent } from "../../store/task-events.js";
import {
  resolveAgentRunManagerPolicy,
  type AgentRunManagerPolicy,
  type AgentRunManagerPolicyInput,
} from "./policy.js";

const log = createLogger("agent-run-manager-sweeper");

const ACTIVE_RUN_STATUSES = new Set<AgentRunStatus>(["queued", "running", "waiting"]);
const ACTIVE_SCHEDULER_STATUSES = ["initialized", "running", "waiting"] satisfies AgentSchedulerStatus[];
const TERMINAL_TASK_STATUSES = new Set(["interrupted", "completed", "failed", "cancelled"]);
const MANAGER_ARTIFACT_ROOT = ".miniclaw-task";
const DEFAULT_MIN_INTERVAL_MS = 60_000;
const DEFAULT_MAX_INTERVAL_MS = 300_000;

export type AgentRunManagerSweepActionType =
  | "scheduler_recovered_from_message"
  | "scheduler_closed_for_terminal_task"
  | "scheduler_timed_out"
  | "active_run_closed_for_terminal_task"
  | "active_run_timed_out"
  | "orphan_child_failed"
  | "cancelled_parent_child_cancelled"
  | "terminal_parent_child_failed";

export interface AgentRunManagerSweepAction {
  type: AgentRunManagerSweepActionType;
  taskId: string;
  runId?: string;
  parentRunId?: string;
  schedulerStatus?: AgentSchedulerStatus;
  fromStatus?: AgentRunStatus | AgentSchedulerStatus;
  toStatus?: AgentRunStatus | AgentSchedulerStatus;
  messageId?: string;
  reason: string;
}

export interface AgentRunManagerSweepCleanupReport {
  cutoffIso: string;
  candidateTaskIds: string[];
  candidateArtifactCount: number;
  managerOwnedArtifactCount: number;
  externalArtifactRefCount: number;
  deletedArtifactFileCount: number;
  deletedRows: {
    blackboardFacts: number;
    artifacts: number;
    messages: number;
    schedulerStates: number;
    runs: number;
  };
}

export interface AgentRunManagerSweepReport {
  dryRun: boolean;
  nowIso: string;
  timeoutCutoffIso: string;
  actions: AgentRunManagerSweepAction[];
  cleanup: AgentRunManagerSweepCleanupReport;
}

export interface AgentRunManagerSweepOptions {
  db?: Database.Database;
  policy?: AgentRunManagerPolicyInput;
  now?: Date;
  dryRun?: boolean;
}

export interface AgentRunManagerSweeperOptions {
  enabled: boolean;
  policy: AgentRunManagerPolicyInput;
  intervalMs?: number;
  runOnStart?: boolean;
}

export interface AgentRunManagerSweeperHandle {
  runNow: () => AgentRunManagerSweepReport;
  stop: () => void;
}

interface ArtifactCleanupRow {
  id: string;
  task_id: string;
  run_id: string;
  path: string;
  cwd: string;
}

interface DeleteRowsReport {
  blackboardFacts: number;
  artifacts: number;
  messages: number;
  schedulerStates: number;
  runs: number;
}

function cutoff(now: Date, ageMs: number): Date {
  return new Date(now.getTime() - ageMs);
}

function parseDbTimeMs(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}

function isOlderThan(value: string | null | undefined, cutoffDate: Date): boolean {
  const ms = parseDbTimeMs(value);
  return Number.isFinite(ms) && ms < cutoffDate.getTime();
}

function isActiveRunStatus(status: AgentRunStatus): boolean {
  return ACTIVE_RUN_STATUSES.has(status);
}

function isTerminalTask(task: TaskRow | undefined): task is TaskRow {
  return Boolean(task && TERMINAL_TASK_STATUSES.has(task.status));
}

function runStatusForTerminalTask(task: TaskRow): AgentRunStatus {
  if (task.status === "completed") return "completed";
  if (task.status === "failed") return "failed";
  return "cancelled";
}

function schedulerStatusForTerminalTask(task: TaskRow): AgentSchedulerStatus {
  if (task.status === "completed") return "completed";
  if (task.status === "failed") return "failed";
  return "cancelled";
}

function safeTaskEvent(taskId: string, action: AgentRunManagerSweepAction): void {
  try {
    appendTaskEvent({
      taskId,
      eventType: "agent_run_manager_sweeper",
      severity: action.toStatus === "failed" ? "error" : "warning",
      message: action.reason,
      payload: action,
    });
  } catch {
    // Sweeper observability must never make recovery fail.
  }
}

function recordAction(
  report: Pick<AgentRunManagerSweepReport, "dryRun" | "actions">,
  action: AgentRunManagerSweepAction,
): void {
  report.actions.push(action);
  if (!report.dryRun) safeTaskEvent(action.taskId, action);
}

function setRunStatus(
  report: Pick<AgentRunManagerSweepReport, "dryRun" | "actions">,
  run: AgentRun,
  toStatus: AgentRunStatus,
  reason: string,
  type: AgentRunManagerSweepActionType,
  parentRunId?: string,
): void {
  const action: AgentRunManagerSweepAction = {
    type,
    taskId: run.task_id,
    runId: run.id,
    ...(parentRunId ? { parentRunId } : {}),
    fromStatus: run.status,
    toStatus,
    reason,
  };
  recordAction(report, action);
  if (!report.dryRun) {
    updateRunStatus(run.id, toStatus, {
      errorMessage: toStatus === "completed" ? undefined : reason,
    });
  }
}

function closeScheduler(
  report: Pick<AgentRunManagerSweepReport, "dryRun" | "actions">,
  state: AgentSchedulerState,
  toStatus: AgentSchedulerStatus,
  reason: string,
  type: AgentRunManagerSweepActionType,
): void {
  const action: AgentRunManagerSweepAction = {
    type,
    taskId: state.task_id,
    schedulerStatus: state.status,
    fromStatus: state.status,
    toStatus,
    reason,
  };
  recordAction(report, action);
  if (!report.dryRun) {
    upsertAgentSchedulerState({
      taskId: state.task_id,
      rootRunId: state.root_run_id,
      schedulerVersion: state.scheduler_version,
      status: toStatus,
      currentStep: state.current_step,
      plan: state.plan_json,
    });
  }
}

function closeActiveRunsForTask(
  report: Pick<AgentRunManagerSweepReport, "dryRun" | "actions">,
  taskId: string,
  toStatus: AgentRunStatus,
  reason: string,
  type: AgentRunManagerSweepActionType,
): void {
  for (const run of listActiveAgentRuns().filter((candidate) => candidate.task_id === taskId)) {
    const latest = getRun(run.id);
    if (!latest || !isActiveRunStatus(latest.status)) continue;
    setRunStatus(report, latest, toStatus, reason, type, latest.parent_run_id ?? undefined);
  }
}

function recoverWaitingScheduler(
  report: Pick<AgentRunManagerSweepReport, "dryRun" | "actions">,
  state: AgentSchedulerState,
): boolean {
  if (state.status !== "waiting" || !state.wait_run_id || !state.wait_kinds.length) return false;
  const wakeMessage = readMailbox({
    runId: state.wait_run_id,
    ...(state.last_message_id ? { afterCursor: state.last_message_id } : {}),
  }).find((message) => state.wait_kinds.includes(message.kind));
  if (!wakeMessage) return false;

  const reason = `Recovered waiting scheduler from durable Agent Bus message ${wakeMessage.id}`;
  recordAction(report, {
    type: "scheduler_recovered_from_message",
    taskId: state.task_id,
    runId: state.root_run_id,
    fromStatus: state.status,
    toStatus: "running",
    messageId: wakeMessage.id,
    reason,
  });
  if (!report.dryRun) {
    updateRunStatus(state.root_run_id, "running", { completedAt: null });
    upsertAgentSchedulerState({
      taskId: state.task_id,
      rootRunId: state.root_run_id,
      schedulerVersion: state.scheduler_version,
      status: "running",
      currentStep: state.current_step,
      lastMessageId: wakeMessage.id,
      plan: state.plan_json,
    });
  }
  return true;
}

function sweepSchedulers(
  report: Pick<AgentRunManagerSweepReport, "dryRun" | "actions">,
  timeoutCutoff: Date,
): void {
  for (const state of listAgentSchedulerStates([...ACTIVE_SCHEDULER_STATUSES])) {
    const task = getTask(state.task_id);
    if (isTerminalTask(task)) {
      const reason = `Task ${task.id} is terminal (${task.status}); closing scheduler state`;
      const schedulerStatus = schedulerStatusForTerminalTask(task);
      closeScheduler(report, state, schedulerStatus, reason, "scheduler_closed_for_terminal_task");
      closeActiveRunsForTask(report, state.task_id, runStatusForTerminalTask(task), reason, "active_run_closed_for_terminal_task");
      continue;
    }

    if (recoverWaitingScheduler(report, state)) continue;

    if (isOlderThan(state.updated_at, timeoutCutoff)) {
      const reason = `Scheduler ${state.current_step} timed out after the configured Agent Run Manager timeout`;
      closeScheduler(report, state, "failed", reason, "scheduler_timed_out");
      closeActiveRunsForTask(report, state.task_id, "failed", reason, "active_run_timed_out");
    }
  }
}

function sweepActiveRuns(
  report: Pick<AgentRunManagerSweepReport, "dryRun" | "actions">,
  timeoutCutoff: Date,
): void {
  for (const run of listActiveAgentRuns()) {
    const latest = getRun(run.id);
    if (!latest || !isActiveRunStatus(latest.status)) continue;

    const task = getTask(latest.task_id);
    if (isTerminalTask(task)) {
      const reason = `Task ${task.id} is terminal (${task.status}); closing active agent run`;
      setRunStatus(report, latest, runStatusForTerminalTask(task), reason, "active_run_closed_for_terminal_task", latest.parent_run_id ?? undefined);
      continue;
    }

    if (latest.parent_run_id) {
      const parent = getRun(latest.parent_run_id);
      if (!parent) {
        setRunStatus(
          report,
          latest,
          "failed",
          `Child run ${latest.id} has no durable parent run ${latest.parent_run_id}`,
          "orphan_child_failed",
          latest.parent_run_id,
        );
        continue;
      }
      if (parent.task_id !== latest.task_id) {
        setRunStatus(
          report,
          latest,
          "failed",
          `Child run ${latest.id} belongs to task ${latest.task_id} but parent run ${parent.id} belongs to task ${parent.task_id}`,
          "orphan_child_failed",
          parent.id,
        );
        continue;
      }
      if (!isActiveRunStatus(parent.status)) {
        if (parent.status === "cancelled") {
          setRunStatus(
            report,
            latest,
            "cancelled",
            `Parent run ${parent.id} is cancelled; cancelling child run`,
            "cancelled_parent_child_cancelled",
            parent.id,
          );
        } else {
          setRunStatus(
            report,
            latest,
            "failed",
            `Parent run ${parent.id} is terminal (${parent.status}); failing orphaned child run`,
            "terminal_parent_child_failed",
            parent.id,
          );
        }
        continue;
      }
    }

    if (isOlderThan(latest.started_at, timeoutCutoff)) {
      const reason = `Agent run ${latest.id} timed out after the configured Agent Run Manager timeout`;
      setRunStatus(report, latest, "failed", reason, "active_run_timed_out", latest.parent_run_id ?? undefined);
      if (latest.parent_run_id) {
        const parent = getRun(latest.parent_run_id);
        if (parent && isActiveRunStatus(parent.status)) {
          setRunStatus(
            report,
            parent,
            "failed",
            `Child run ${latest.id} timed out; failing parent orchestration run`,
            "active_run_timed_out",
          );
        }
      }
    }
  }
}

function cleanupTaskIds(db: Database.Database, cleanupCutoffIso: string): string[] {
  const rows = db.prepare(
    `SELECT task_id
     FROM agent_runs
     GROUP BY task_id
     HAVING SUM(CASE WHEN status IN ('queued', 'running', 'waiting') THEN 1 ELSE 0 END) = 0
        AND MAX(datetime(COALESCE(completed_at, started_at))) < datetime(@cutoff)
     ORDER BY task_id ASC`
  ).all({ cutoff: cleanupCutoffIso }) as { task_id: string }[];
  return rows.map((row) => row.task_id);
}

function artifactRowsForTasks(db: Database.Database, taskIds: string[]): ArtifactCleanupRow[] {
  if (!taskIds.length) return [];
  const placeholders = taskIds.map((_, index) => `@task${index}`).join(", ");
  const params = Object.fromEntries(taskIds.map((taskId, index) => [`task${index}`, taskId]));
  return db.prepare(
    `SELECT a.id, a.task_id, a.run_id, a.path, r.cwd
     FROM agent_artifacts a
     JOIN agent_runs r ON r.id = a.run_id
     WHERE a.task_id IN (${placeholders})
     ORDER BY a.created_at ASC, a.id ASC`
  ).all(params) as ArtifactCleanupRow[];
}

function isManagerOwnedArtifact(row: ArtifactCleanupRow): boolean {
  const expectedRoot = resolve(row.cwd, MANAGER_ARTIFACT_ROOT, row.task_id, "artifacts");
  const absolutePath = resolve(row.cwd, row.path);
  const withinRoot = relative(expectedRoot, absolutePath);
  if (withinRoot.startsWith("..") || isAbsolute(withinRoot)) return false;
  const normalized = row.path.replace(/\\/g, "/");
  return normalized.startsWith(`${MANAGER_ARTIFACT_ROOT}/${row.task_id}/artifacts/`);
}

function deleteRowsForTasks(db: Database.Database, taskIds: string[]): DeleteRowsReport {
  if (!taskIds.length) {
    return { blackboardFacts: 0, artifacts: 0, messages: 0, schedulerStates: 0, runs: 0 };
  }
  const placeholders = taskIds.map((_, index) => `@task${index}`).join(", ");
  const params = Object.fromEntries(taskIds.map((taskId, index) => [`task${index}`, taskId]));
  const deleteFrom = (table: string): number =>
    Number(db.prepare(`DELETE FROM ${table} WHERE task_id IN (${placeholders})`).run(params).changes ?? 0);
  const blackboardFacts = deleteFrom("blackboard_facts");
  const schedulerStates = deleteFrom("agent_scheduler_state");
  const artifacts = deleteFrom("agent_artifacts");
  const messages = deleteFrom("agent_messages");
  const runs = deleteFrom("agent_runs");
  return {
    blackboardFacts,
    artifacts,
    messages,
    schedulerStates,
    runs,
  };
}

function cleanupDurableState(
  db: Database.Database,
  dryRun: boolean,
  cleanupCutoffIso: string,
): AgentRunManagerSweepCleanupReport {
  const candidateTaskIds = cleanupTaskIds(db, cleanupCutoffIso);
  const artifactRows = artifactRowsForTasks(db, candidateTaskIds);
  const managerOwnedArtifacts = artifactRows.filter(isManagerOwnedArtifact);
  let deletedArtifactFileCount = 0;

  if (!dryRun) {
    for (const artifact of managerOwnedArtifacts) {
      const absolutePath = resolve(artifact.cwd, artifact.path);
      if (!existsSync(absolutePath)) continue;
      rmSync(absolutePath, { force: true });
      deletedArtifactFileCount++;
    }
  }

  const deletedRows = dryRun
    ? { blackboardFacts: 0, artifacts: 0, messages: 0, schedulerStates: 0, runs: 0 }
    : db.transaction(() => deleteRowsForTasks(db, candidateTaskIds))();

  return {
    cutoffIso: cleanupCutoffIso,
    candidateTaskIds,
    candidateArtifactCount: artifactRows.length,
    managerOwnedArtifactCount: managerOwnedArtifacts.length,
    externalArtifactRefCount: artifactRows.length - managerOwnedArtifacts.length,
    deletedArtifactFileCount,
    deletedRows,
  };
}

export function runAgentRunManagerSweep(options: AgentRunManagerSweepOptions = {}): AgentRunManagerSweepReport {
  const db = options.db ?? getDb();
  const policy: AgentRunManagerPolicy = resolveAgentRunManagerPolicy(options.policy);
  const now = options.now ?? new Date();
  const timeoutCutoff = cutoff(now, policy.timeoutMs);
  const cleanupCutoffIso = cutoff(now, policy.cleanupTtlMs).toISOString();
  const report: AgentRunManagerSweepReport = {
    dryRun: options.dryRun ?? false,
    nowIso: now.toISOString(),
    timeoutCutoffIso: timeoutCutoff.toISOString(),
    actions: [],
    cleanup: {
      cutoffIso: cleanupCutoffIso,
      candidateTaskIds: [],
      candidateArtifactCount: 0,
      managerOwnedArtifactCount: 0,
      externalArtifactRefCount: 0,
      deletedArtifactFileCount: 0,
      deletedRows: { blackboardFacts: 0, artifacts: 0, messages: 0, schedulerStates: 0, runs: 0 },
    },
  };

  sweepSchedulers(report, timeoutCutoff);
  sweepActiveRuns(report, timeoutCutoff);
  report.cleanup = cleanupDurableState(db, report.dryRun, cleanupCutoffIso);
  return report;
}

export function defaultAgentRunManagerSweepIntervalMs(policyInput: AgentRunManagerPolicyInput): number {
  const policy = resolveAgentRunManagerPolicy(policyInput);
  return Math.min(DEFAULT_MAX_INTERVAL_MS, Math.max(DEFAULT_MIN_INTERVAL_MS, Math.floor(policy.timeoutMs / 6)));
}

export function startAgentRunManagerSweeper(options: AgentRunManagerSweeperOptions): AgentRunManagerSweeperHandle | null {
  if (!options.enabled) {
    log.info("Agent Run Manager sweeper disabled");
    return null;
  }
  const intervalMs = options.intervalMs ?? defaultAgentRunManagerSweepIntervalMs(options.policy);
  const run = () => {
    const report = runAgentRunManagerSweep({ policy: options.policy });
    if (report.actions.length || report.cleanup.candidateTaskIds.length) {
      log.warn(
        `Agent Run Manager sweep applied: actions=${report.actions.length} ` +
        `cleanup_tasks=${report.cleanup.candidateTaskIds.length} ` +
        `artifact_files=${report.cleanup.deletedArtifactFileCount}`
      );
    } else {
      log.info("Agent Run Manager sweep completed: no stale state");
    }
    return report;
  };

  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  if (options.runOnStart ?? true) {
    setImmediate(run).unref?.();
  }
  log.info(`Agent Run Manager sweeper started: interval=${intervalMs}ms`);

  return {
    runNow: run,
    stop: () => {
      clearInterval(timer);
      log.info("Agent Run Manager sweeper stopped");
    },
  };
}
