import type { Message, SendableChannels } from "discord.js";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { config, type AgentProvider } from "../config.js";
import { updateTask } from "../store/db.js";
import { ProgressReporter } from "../discord/progress.js";
import { taskCompleteEmbed, taskErrorEmbed, taskStartEmbed } from "../discord/formatter.js";
import { chunkMessage } from "../discord/chunks.js";
import { sendChunkedTextWithDeferredLinkPreviews } from "../discord/text.js";
import { IDENTITY_LINE_TASK } from "./identity.js";
import { createLogger } from "../lib/log.js";
import type { CodexInputEntry } from "./codex.js";
import { fmtTokens, formatAnthropicUsage } from "./usage.js";
import { appendTaskEvent, type TaskEventSeverity } from "../store/task-events.js";
import { TaskReporter } from "./task-reporter.js";
import { buildSupervisorBlock } from "./supervisor.js";
import { claudeTaskRunner } from "./runners/claude-task-runner.js";
import { codexTaskRunner } from "./runners/codex-task-runner.js";
import { createFakeTaskRunner } from "./runners/fake-task-runner.js";
import { pushCompactedLine } from "./runners/progress-lines.js";
import type { TaskRunner, TaskRunnerResult, TaskRunnerTraceOptions } from "./runners/types.js";
import type { TaskViewEvent } from "./task-view-events.js";

const log = createLogger("task");

const PROGRESS_TAIL_LINES = 25;

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
  rawTaskMessages,
  buildExecutionSummary,
  buildRealtimeProgress,
  selectTaskRunner,
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

function selectTaskRunner(agentProvider: AgentProvider, fakeAgent: boolean): TaskRunner {
  if (fakeAgent) return createFakeTaskRunner(agentProvider);
  return agentProvider === "codex" ? codexTaskRunner : claudeTaskRunner;
}

function rawTaskMessages(taskId: string, result: TaskResult): string[] {
  const fallback = result.success ? "[无文字回复]" : "任务失败且无错误详情";
  const text = result.result.trim() ? result.result : fallback;
  if (result.success) return chunkMessage(text);
  return [`❌ \`${taskId.slice(0, 8)}\` 失败: ${text.slice(0, 1900)}`];
}

function rawDisplayTaskResult(params: ExecuteTaskParams, result: TaskResult): TaskResult {
  if (!result.success || !params.rawOutputTextTransform) return result;
  return { ...result, result: params.rawOutputTextTransform(result.result) };
}

async function sendRawTaskResult(channel: SendableChannels, taskId: string, result: TaskResult): Promise<void> {
  if (result.success) {
    const text = result.result.trim() ? result.result : "[无文字回复]";
    await sendChunkedTextWithDeferredLinkPreviews(channel, text);
    return;
  }
  await sendChunkedTextWithDeferredLinkPreviews(channel, rawTaskMessages(taskId, result)[0] ?? `❌ \`${taskId.slice(0, 8)}\` 失败`);
}

async function sendMarkdownTaskResult(channel: SendableChannels, result: TaskResult): Promise<void> {
  const fallback = result.success ? "[无文字回复]" : "任务失败且无错误详情";
  const prefix = result.success ? "" : "❌ **任务失败**\n\n";
  await sendChunkedTextWithDeferredLinkPreviews(channel, prefix + (result.result.trim() || fallback));
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildExecutionSummary(
  status: "completed" | "failed" | "cancelled" | "interrupted",
  result: TaskResult,
  toolCallLog: string[],
  toolCount: number,
): string {
  const recent = toolCallLog.slice(-8);
  const recentText = recent.length
    ? recent.map((line) => `- ${line}`).join("\n")
    : "- (no tool calls recorded)";
  return [
    "### Execution Summary",
    `status: ${status}`,
    `elapsed: ${formatSeconds(result.durationMs)}`,
    `turns: ${result.turns}`,
    `tools: ${toolCount}`,
    ...(result.tokensSummary ? [`tokens: ${result.tokensSummary}`] : []),
    "",
    "recent steps:",
    recentText,
  ].join("\n").slice(0, 2000);
}

function buildRealtimeProgress(lines: string[], turns: number, toolCount: number): string {
  const tail = lines.slice(-PROGRESS_TAIL_LINES);
  const omitted = lines.length - tail.length;
  const recent = tail.length
    ? tail.map((line) => `- ${line}`).join("\n")
    : "- waiting for SDK events";
  return [
    "### Realtime Progress",
    "status: running",
    `turns: ${turns || 0}`,
    `tools: ${toolCount}`,
    ...(omitted > 0 ? [`omitted: ${omitted} earlier steps`] : []),
    "",
    "recent steps:",
    recent,
  ].join("\n").slice(0, 2000);
}

async function updateStatusMessage(channel: SendableChannels, message: Message | undefined, embed: ReturnType<typeof taskCompleteEmbed>): Promise<void> {
  if (message) {
    try {
      await message.edit({ embeds: [embed] });
      return;
    } catch {
      // Fall back to sending a new status card below.
    }
  }
  await channel.send({ embeds: [embed] });
}

async function sendEmbedTaskResult(
  params: ExecuteTaskParams,
  progress: ProgressReporter,
  abortController: AbortController,
  result: TaskResult,
  toolCallLog: string[],
  toolCount: number,
  statusMessage?: Message,
  reporter?: TaskReporter,
): Promise<void> {
  const status = finalTaskStatus(params.taskId, abortController, result.success);
  await progress.complete(params.channel, {
    finalText: buildExecutionSummary(status, result, toolCallLog, toolCount),
  });

  const embed = result.success
    ? taskCompleteEmbed({
        taskId: params.taskId,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        turns: result.turns,
        sessionId: result.sessionId,
        provider: config.agentProvider,
        model: config.model,
        cwd: params.cwd,
        toolCount,
        ...(result.tokensSummary ? { tokensSummary: result.tokensSummary } : {}),
      })
    : taskErrorEmbed(params.taskId, result.result);

  try {
    await updateStatusMessage(params.channel, statusMessage, embed);
  } catch (err) {
    reporter?.discordDeliveryFailed("status_message_update", err);
  }
  try {
    await sendMarkdownTaskResult(params.channel, result);
  } catch (err) {
    reporter?.discordDeliveryFailed("final_markdown_send", err);
  }
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
}

interface ViewProgressState {
  lines: string[];
  turns: number;
  toolCount: number;
}

async function updateProgressTail(
  progress: ProgressReporter,
  channel: SendableChannels,
  lines: string[],
  turns: number,
  toolCount: number,
): Promise<void> {
  await progress.update(buildRealtimeProgress(lines, turns, toolCount), channel);
}

function taskViewProgressLine(event: Extract<TaskViewEvent, { type: "tool_progress" | "assistant_progress" }>): string {
  if (event.type === "assistant_progress") return event.text;
  return event.detail ? `${event.title}: "${event.detail}"` : event.title;
}

async function handleTaskViewEvent(
  event: TaskViewEvent,
  params: ExecuteTaskParams,
  progress: ProgressReporter,
  state: ViewProgressState,
  renderProgress: boolean,
): Promise<void> {
  switch (event.type) {
    case "session_started": {
      updateTask(params.taskId, { session_id: event.sessionId });
      break;
    }
    case "turn_started": {
      state.turns = event.turn;
      break;
    }
    case "tool_progress":
    case "assistant_progress": {
      const line = taskViewProgressLine(event);
      const added = pushCompactedLine(state.lines, line);
      if (event.type === "tool_progress" && event.countAsTool !== false) state.toolCount++;
      const countedToolEvent = event.type === "tool_progress" && event.countAsTool !== false;
      if (renderProgress && (added || countedToolEvent)) {
        await updateProgressTail(progress, params.channel, state.lines, state.turns, state.toolCount);
      }
      break;
    }
  }
}

function recordRunnerTrace(reporter: TaskReporter, eventType: string, options: TaskRunnerTraceOptions = {}): void {
  reporter.event(eventType, {
    severity: options.severity,
    message: options.message,
    payload: options.payload,
  });
}

function normalizeRunnerResult(
  taskId: string,
  abortController: AbortController,
  result: TaskRunnerResult,
): TaskRunnerResult {
  if (wasInterrupted(taskId)) {
    return { ...result, success: false, result: interruptedReason(taskId) };
  }
  if (wasCancelled(taskId, abortController)) {
    return { ...result, success: false, result: "任务已被用户取消" };
  }
  return result;
}

function completeTaskRow(
  params: ExecuteTaskParams,
  abortController: AbortController,
  result: TaskRunnerResult,
  runner: TaskRunner,
  reporter: TaskReporter,
  toolCount: number,
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
  const provider = runner.provider === "fake" ? config.agentProvider : runner.provider;
  const payload: Record<string, unknown> = {
    provider,
    duration_ms: result.durationMs,
    turns: result.turns,
    cost_usd: result.costUsd,
    session_id: result.sessionId,
  };
  if (runner.provider !== "fake") payload.tool_count = toolCount;
  reporter.finished(status, {
    ...payload,
  });
  return status;
}

function logTaskCompletion(
  shortId: string,
  runner: TaskRunner,
  result: TaskRunnerResult,
  toolCount: number,
  startedAt: number,
): void {
  const provider = runner.provider === "fake" ? "e2e-fake" : runner.provider;
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
  activeTasks.set(params.taskId, abortController);
  const outputMode = params.outputMode ?? "embed";
  const reporter = new TaskReporter(params.taskId);
  const progress = new ProgressReporter(params.taskId, {
    minUpdateIntervalMs: 2000,
    onDeliveryError: (operation, err) => reporter.discordDeliveryFailed(`progress_${operation}`, err),
  });
  const startedAt = Date.now();
  const shortId = params.taskId.slice(0, 8);
  const runner = selectTaskRunner(config.agentProvider, config.e2e.fakeAgent);
  reporter.started({
    provider: config.agentProvider,
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
    if (outputMode === "embed" && !params.statusMessage) {
      try {
        params.statusMessage = await params.channel.send({
          embeds: [taskStartEmbed(params.taskId, params.prompt, params.cwd, {
            provider: config.agentProvider,
            model: config.model,
          })],
        });
      } catch (err) {
        reporter.discordDeliveryFailed("start_status_send", err);
        // Status card is best-effort; task execution should continue.
      }
    }
    if (outputMode === "embed") {
      await progress.update(buildRealtimeProgress([], 0, 0), params.channel);
    }

    const progressState: ViewProgressState = { lines: [], turns: 0, toolCount: 0 };
    const runnerResult = await runner.run({
      taskId: params.taskId,
      prompt: params.prompt,
      cwd: params.cwd,
      ...(params.resumeSessionId ? { resumeSessionId: params.resumeSessionId } : {}),
      ...(params.attachmentBlocks ? { attachmentBlocks: params.attachmentBlocks } : {}),
      ...(params.attachmentCodexInputs ? { attachmentCodexInputs: params.attachmentCodexInputs } : {}),
      signal: abortController.signal,
      onViewEvent: (event) => handleTaskViewEvent(event, params, progress, progressState, outputMode === "embed"),
      onTraceEvent: (eventType, options) => recordRunnerTrace(reporter, eventType, options),
    });
    const lastResult = normalizeRunnerResult(params.taskId, abortController, runnerResult);
    const toolCallLog = lastResult.progressLines ?? progressState.lines;
    const toolStep = lastResult.toolCount ?? progressState.toolCount;

    completeTaskRow(params, abortController, lastResult, runner, reporter, toolStep);
    logTaskCompletion(shortId, runner, lastResult, toolStep, startedAt);

    if (outputMode === "raw") {
      // 程序化触发（cron 等）：直接发结果文本，不带任何元数据装饰
      await progress.complete(params.channel, lastResult.success ? undefined : { keepAsError: true });
      await sendRawTaskResult(params.channel, params.taskId, rawDisplayTaskResult(params, lastResult));
      return lastResult;
    }

    // outputMode === "embed"（/task 默认）
    await sendEmbedTaskResult(params, progress, abortController, lastResult, toolCallLog, toolStep, params.statusMessage, reporter);

    return lastResult;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errMsg = wasInterrupted(params.taskId)
      ? interruptedReason(params.taskId)
      : wasCancelled(params.taskId, abortController)
      ? "任务已被用户取消"
      : err instanceof Error ? err.message : String(err);
    log.error(`✗ ${shortId} threw after ${durationMs}ms: ${errMsg}`);
    reporter.providerError(config.agentProvider, errMsg, { duration_ms: durationMs });
    await progress.complete(params.channel, { keepAsError: true });

    const status = finalTaskStatus(params.taskId, abortController, false);
    updateTask(params.taskId, {
      status,
      result_summary: errMsg.slice(0, 10000),
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });
    reporter.finished(status, {
      provider: config.agentProvider,
      duration_ms: durationMs,
      turns: 0,
      cost_usd: 0,
    });

    try {
      await params.channel.send({ embeds: [taskErrorEmbed(params.taskId, errMsg)] });
    } catch (sendErr) {
      reporter.discordDeliveryFailed("error_embed_send", sendErr);
    }

    return {
      success: false,
      sessionId: "",
      costUsd: 0,
      durationMs,
      turns: 0,
      result: errMsg,
    };
  } finally {
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
