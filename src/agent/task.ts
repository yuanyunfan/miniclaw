import type { Message, SendableChannels } from "discord.js";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { updateTask } from "../store/db.js";
import { DiscordTaskViewReporter } from "../discord/task-view-reporter.js";
import { IDENTITY_LINE_TASK } from "./identity.js";
import { createLogger } from "../lib/log.js";
import type { CodexInputEntry } from "./codex.js";
import { fmtTokens, formatAnthropicUsage } from "./usage.js";
import { appendTaskEvent, type TaskEventSeverity } from "../store/task-events.js";
import { TaskReporter } from "./task-reporter.js";
import { buildSupervisorBlock } from "./supervisor.js";
import { createFakeTaskRunner } from "./runners/fake-task-runner.js";
import type { AgentRuntime, AgentRuntimeTraceOptions, AgentTaskResult } from "../runtime/agent-runtime.js";
import { createTaskRunnerRuntime } from "./runtimes/task-runner-runtime.js";
import { getDefaultAgentRuntime, isAgentRuntimeId, type DefaultAgentRuntimeConfig } from "./runtimes/registry.js";
import type { TaskViewEvent } from "./task-view-events.js";

const log = createLogger("task");

export interface TaskResult {
  success: boolean;
  sessionId: string;
  costUsd: number;
  durationMs: number;
  turns: number;
  result: string;
  tokensSummary?: string;
}

const formatUsage = formatAnthropicUsage;

export const __testables = {
  fmtTokens,
  formatUsage,
  buildSupervisorBlock,
  IDENTITY_LINE_TASK,
  finalTaskStatus,
  selectTaskRuntime,
  addActiveTaskForTest,
  deleteActiveTaskForTest,
  resetTaskRuntimeForTest,
};

const activeTasks = new Map<string, AbortController>();
const cancelledTasks = new Set<string>();
const interruptedTasks = new Map<string, string>();
const drainWaiters = new Set<() => void>();

function notifyActiveTaskChange(): void {
  if (activeTasks.size !== 0) return;
  for (const waiter of drainWaiters) waiter();
}

export function getActiveTaskCount(): number {
  return activeTasks.size;
}

export function listActiveTaskIds(): string[] {
  return Array.from(activeTasks.keys());
}

export async function waitForActiveTasksToDrain(timeoutMs: number): Promise<boolean> {
  if (activeTasks.size === 0) return true;
  if (timeoutMs <= 0) return false;

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (drained: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      drainWaiters.delete(onDrain);
      resolve(drained);
    };
    const onDrain = () => {
      if (activeTasks.size === 0) finish(true);
    };
    const timer = setTimeout(() => finish(activeTasks.size === 0), timeoutMs);
    timer.unref?.();
    drainWaiters.add(onDrain);
  });
}

export function interruptActiveTasks(reason: string): string[] {
  const ids = listActiveTaskIds();
  for (const taskId of ids) {
    const ctrl = activeTasks.get(taskId);
    if (!ctrl) continue;
    interruptedTasks.set(taskId, reason);
    recordTaskEvent(taskId, "task_interrupted", "warning", reason);
    ctrl.abort(new Error(reason));
    updateTask(taskId, {
      status: "interrupted",
      result_summary: reason,
      completed_at: new Date().toISOString(),
    });
    activeTasks.delete(taskId);
  }
  notifyActiveTaskChange();
  return ids;
}

export function cancelTask(taskId: string): boolean {
  const ctrl = activeTasks.get(taskId);
  if (!ctrl) return false;
  cancelledTasks.add(taskId);
  recordTaskEvent(taskId, "task_cancel_requested", "warning", "cancel requested by operator");
  ctrl.abort();
  activeTasks.delete(taskId);
  notifyActiveTaskChange();
  return true;
}

function wasCancelled(taskId: string, abortController: AbortController): boolean {
  return cancelledTasks.has(taskId) || (abortController.signal.aborted && !interruptedTasks.has(taskId));
}

function wasInterrupted(taskId: string): boolean {
  return interruptedTasks.has(taskId);
}

function interruptedReason(taskId: string): string {
  return interruptedTasks.get(taskId) ?? "任务因 MiniClaw 重启/关闭被中断";
}

function cancelledReason(abortController: AbortController): string {
  const reason = abortController.signal.reason;
  if (reason instanceof Error && reason.message && reason.name !== "AbortError") return reason.message;
  if (typeof reason === "string" && reason) return reason;
  return "任务已被用户取消";
}

function finalTaskStatus(
  taskId: string,
  abortController: AbortController,
  success: boolean
): "completed" | "failed" | "cancelled" | "interrupted" {
  if (wasInterrupted(taskId)) return "interrupted";
  if (wasCancelled(taskId, abortController)) return "cancelled";
  return success ? "completed" : "failed";
}

function addActiveTaskForTest(taskId: string, abortController = new AbortController()): AbortController {
  activeTasks.set(taskId, abortController);
  return abortController;
}

function deleteActiveTaskForTest(taskId: string): void {
  activeTasks.delete(taskId);
  notifyActiveTaskChange();
}

function resetTaskRuntimeForTest(): void {
  activeTasks.clear();
  cancelledTasks.clear();
  interruptedTasks.clear();
  for (const waiter of drainWaiters) waiter();
  drainWaiters.clear();
}

function recordTaskEvent(taskId: string, eventType: string, severity: TaskEventSeverity, message?: string, payload?: unknown): void {
  try {
    appendTaskEvent({ taskId, eventType, severity, message, payload });
  } catch {
    // Task events are observability-only; never break cancellation/drain paths.
  }
}

interface TaskRuntimeConfig extends DefaultAgentRuntimeConfig {
  e2e: {
    fakeAgent: boolean;
  };
}

interface SelectedTaskRuntime {
  runtime: AgentRuntime;
  provider: string;
  logProvider: string;
  includeToolCount: boolean;
}

function selectTaskRuntime(runtimeConfig: TaskRuntimeConfig): SelectedTaskRuntime {
  const runtime = getDefaultAgentRuntime(runtimeConfig);
  if (!runtimeConfig.e2e.fakeAgent) {
    return { runtime, provider: runtime.id, logProvider: runtime.id, includeToolCount: true };
  }

  if (!isAgentRuntimeId(runtime.id)) {
    throw new Error(`Cannot create fake task runtime for unknown default runtime: ${runtime.id}`);
  }

  return {
    runtime: createTaskRunnerRuntime({
      id: runtime.id,
      runner: createFakeTaskRunner(runtime.id),
    }),
    provider: runtime.id,
    logProvider: "e2e-fake",
    includeToolCount: false,
  };
}

interface ExecuteTaskParams {
  taskId: string;
  prompt: string;
  cwd: string;
  channel: SendableChannels;
  resumeSessionId?: string;
  attachmentBlocks?: ContentBlockParam[];
  attachmentCodexInputs?: CodexInputEntry[];
  /**
   * "embed"（默认）：发 ✅ 任务完成 embed + 执行轨迹（/task 用）
   * "raw"：直接发 LLM 输出文本，无任何元数据装饰（cron / 程序化触发用）
   */
  outputMode?: "embed" | "raw";
  rawOutputTextTransform?: (text: string) => string;
  statusMessage?: Message;
  signal?: AbortSignal;
}

function recordRuntimeTrace(reporter: TaskReporter, eventType: string, options: AgentRuntimeTraceOptions = {}): void {
  reporter.event(eventType, {
    severity: options.severity,
    message: options.message,
    payload: options.payload,
  });
}

function normalizeRuntimeResult(
  taskId: string,
  abortController: AbortController,
  result: AgentTaskResult,
): AgentTaskResult {
  if (wasInterrupted(taskId)) {
    return { ...result, success: false, result: interruptedReason(taskId) };
  }
  if (wasCancelled(taskId, abortController)) {
    return { ...result, success: false, result: cancelledReason(abortController) };
  }
  return result;
}

function completeTaskRow(
  params: ExecuteTaskParams,
  abortController: AbortController,
  result: AgentTaskResult,
  provider: string,
  reporter: TaskReporter,
  toolCount: number,
  includeToolCount: boolean,
): ReturnType<typeof finalTaskStatus> {
  const status = finalTaskStatus(params.taskId, abortController, result.success);
  updateTask(params.taskId, {
    session_id: result.sessionId,
    status,
    result_summary: result.result.slice(0, 10000),
    cost_usd: result.costUsd,
    duration_ms: result.durationMs,
    completed_at: new Date().toISOString(),
  });
  const payload: Record<string, unknown> = {
    provider,
    duration_ms: result.durationMs,
    turns: result.turns,
    cost_usd: result.costUsd,
    session_id: result.sessionId,
  };
  if (includeToolCount) payload.tool_count = toolCount;
  reporter.finished(status, {
    ...payload,
  });
  return status;
}

function logTaskCompletion(
  shortId: string,
  provider: string,
  result: AgentTaskResult,
  toolCount: number,
  startedAt: number,
): void {
  const wallMs = Date.now() - startedAt;
  log.info(
    `${result.success ? "✓" : "✗"} ${shortId} ${provider} ${result.success ? "done" : "failed"} ` +
    `turns=${result.turns} cost=$${result.costUsd.toFixed(4)} ` +
    `sdk=${result.durationMs}ms wall=${wallMs}ms tools=${toolCount}` +
    (result.tokensSummary ? ` ${result.tokensSummary}` : "")
  );
}

export async function executeTask(params: ExecuteTaskParams): Promise<TaskResult> {
  const abortController = new AbortController();
  const forwardAbort = () => abortController.abort(params.signal?.reason);
  if (params.signal?.aborted) forwardAbort();
  else params.signal?.addEventListener("abort", forwardAbort, { once: true });
  activeTasks.set(params.taskId, abortController);
  const outputMode = params.outputMode ?? "embed";
  const reporter = new TaskReporter(params.taskId);
  const selectedRuntime = selectTaskRuntime(config);
  const viewReporter = new DiscordTaskViewReporter({
    taskId: params.taskId,
    prompt: params.prompt,
    cwd: params.cwd,
    channel: params.channel,
    provider: selectedRuntime.provider,
    model: config.model,
    outputMode,
    traceAutoAttach: config.tasks.traceAutoAttach,
    ...(params.statusMessage ? { statusMessage: params.statusMessage } : {}),
    ...(params.rawOutputTextTransform ? { rawOutputTextTransform: params.rawOutputTextTransform } : {}),
    onDeliveryError: (operation, err) => reporter.discordDeliveryFailed(operation, err),
  });
  const startedAt = Date.now();
  const shortId = params.taskId.slice(0, 8);
  reporter.started({
    provider: selectedRuntime.provider,
    model: config.model,
    cwd: params.cwd,
    output_mode: outputMode,
    resume: Boolean(params.resumeSessionId),
  });
  log.info(`▶ ${shortId} start cwd=${params.cwd}${params.resumeSessionId ? ` resume=${params.resumeSessionId.slice(0, 8)}` : ""} prompt="${params.prompt.slice(0, 80).replace(/\s+/g, " ")}"`);

  const resumeId = params.resumeSessionId;
  if (resumeId !== undefined && (typeof resumeId !== "string" || !resumeId.trim())) {
    throw new Error(`Invalid resumeSessionId: ${resumeId}`);
  }

  try {
    await viewReporter.start();

    const runtimeResult = await selectedRuntime.runtime.startTask({
      taskId: params.taskId,
      prompt: params.prompt,
      cwd: params.cwd,
      ...(params.resumeSessionId ? { resumeSessionId: params.resumeSessionId } : {}),
      ...((params.attachmentBlocks || params.attachmentCodexInputs)
        ? {
            attachments: {
              ...(params.attachmentBlocks ? { contentBlocks: params.attachmentBlocks } : {}),
              ...(params.attachmentCodexInputs ? { inputEntries: params.attachmentCodexInputs } : {}),
            },
          }
        : {}),
      signal: abortController.signal,
      onViewEvent: async (event: TaskViewEvent) => {
        if (event.type === "session_started") updateTask(params.taskId, { session_id: event.sessionId });
        await viewReporter.handle(event);
      },
      onTraceEvent: (eventType, options) => recordRuntimeTrace(reporter, eventType, options),
    });
    const lastResult = normalizeRuntimeResult(params.taskId, abortController, runtimeResult);
    const progressSnapshot = viewReporter.snapshot();
    const toolCallLog = lastResult.progressLines ?? progressSnapshot.lines;
    const toolStep = lastResult.toolCount ?? progressSnapshot.toolCount;

    const status = completeTaskRow(
      params,
      abortController,
      lastResult,
      selectedRuntime.provider,
      reporter,
      toolStep,
      selectedRuntime.includeToolCount,
    );
    logTaskCompletion(shortId, selectedRuntime.logProvider, lastResult, toolStep, startedAt);

    await viewReporter.finish(lastResult, status, { lines: toolCallLog, toolCount: toolStep });

    return lastResult;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errMsg = wasInterrupted(params.taskId)
      ? interruptedReason(params.taskId)
      : wasCancelled(params.taskId, abortController)
      ? cancelledReason(abortController)
      : err instanceof Error ? err.message : String(err);
    log.error(`✗ ${shortId} threw after ${durationMs}ms: ${errMsg}`);
    reporter.providerError(selectedRuntime.provider, errMsg, { duration_ms: durationMs });

    const status = finalTaskStatus(params.taskId, abortController, false);
    updateTask(params.taskId, {
      status,
      result_summary: errMsg.slice(0, 10000),
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });
    reporter.finished(status, {
      provider: selectedRuntime.provider,
      duration_ms: durationMs,
      turns: 0,
      cost_usd: 0,
    });

    await viewReporter.renderTaskError(errMsg);

    return {
      success: false,
      sessionId: "",
      costUsd: 0,
      durationMs,
      turns: 0,
      result: errMsg,
    };
  } finally {
    params.signal?.removeEventListener("abort", forwardAbort);
    activeTasks.delete(params.taskId);
    notifyActiveTaskChange();
    cancelledTasks.delete(params.taskId);
    interruptedTasks.delete(params.taskId);
    // 清理 task 路径下落盘的附件
    try {
      rmSync(join(params.cwd, ".miniclaw-attachments", params.taskId), { recursive: true, force: true });
    } catch {
      // 目录可能从未创建（任务无附件），忽略
    }
  }
}
