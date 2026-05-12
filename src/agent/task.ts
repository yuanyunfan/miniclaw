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
import { buildMemoryPrompt } from "../memory/inject.js";
import { loadSubagents, listSubagentNames } from "./subagents.js";
import { loadMcpServers } from "./mcp.js";
import { EASTMONEY_JYWG_TOOL_NAMES } from "../mcp/eastmoney-jywg/safety.js";
import { FUTU_STOCK_TOOL_NAMES } from "../mcp/futu-stock/safety.js";
import { IDENTITY_LINE_TASK } from "./identity.js";
import { loadPrompt } from "./prompts.js";
import { createLogger } from "../lib/log.js";
import type { CodexInputEntry } from "./codex.js";
import {
  codexInput,
  codexThreadOptions,
  formatCodexItemLine,
  getCodexClient,
  withCodexTimeout,
} from "./codex.js";
import { assertProviderSession, formatSessionId } from "./session.js";
import { fmtTokens, formatAnthropicUsage, formatCodexUsage } from "./usage.js";
import { buildFakeTaskResult } from "../e2e/fake-agent.js";
import { formatTaskPromptForSystem } from "../routing/task-context.js";
import { appendTaskEvent, type TaskEventSeverity } from "../store/task-events.js";
import { TaskReporter } from "./task-reporter.js";
import type { TaskRunnerProvider } from "./runners/types.js";

const log = createLogger("task");

const PROGRESS_TAIL_LINES = 25;

function toolIcon(name: string): string {
  if (name === "Skill") return "📚";
  if (name === "Bash") return "💻";
  if (name === "Read") return "📖";
  if (name === "Write" || name === "Edit") return "📝";
  if (name === "Glob" || name === "Grep") return "🔎";
  if (name === "WebFetch") return "🌐";
  if (name === "WebSearch") return "🔍";
  if (name === "Agent" || name === "Task") return "🤖";
  if (name.startsWith("mcp__")) return "🔌";
  return "🔧";
}

function toolShortName(name: string): string {
  if (name === "Bash") return "terminal";
  if (name === "Skill") return "skill_view";
  if (name === "Agent" || name === "Task") return "agent";
  if (name.startsWith("mcp__")) return name.slice(5).replace(/__/g, ":");
  return name.toLowerCase();
}

function allowedFutuStockMcpTools(mcpServers: Record<string, unknown>): string[] {
  return mcpServers["futu-stock"]
    ? FUTU_STOCK_TOOL_NAMES.map((name) => `mcp__futu-stock__${name}`)
    : [];
}

function allowedEastmoneyJywgMcpTools(mcpServers: Record<string, unknown>): string[] {
  return mcpServers["eastmoney-jywg"]
    ? EASTMONEY_JYWG_TOOL_NAMES.map((name) => `mcp__eastmoney-jywg__${name}`)
    : [];
}

function formatToolDetail(name: string, input: Record<string, unknown>): string {
  let raw = "";
  if (name === "Bash") raw = String(input.command ?? "");
  else if (name === "Read" || name === "Edit" || name === "Write") raw = String(input.file_path ?? "");
  else if (name === "Glob" || name === "Grep") raw = String(input.pattern ?? "");
  else if (name === "Skill") raw = String(input.skill ?? "");
  else if (name === "WebFetch") raw = String(input.url ?? "");
  else if (name === "WebSearch") raw = String(input.query ?? "");
  else if (name === "Agent" || name === "Task") {
    const role = (input.subagent_type as string) ?? "general-purpose";
    const promptStr = String(input.prompt ?? "").slice(0, 60);
    raw = `[${role}] ${promptStr}`;
  } else if (name.startsWith("mcp__")) {
    raw = JSON.stringify(input).slice(0, 80);
  }
  return raw.replace(/\s+/g, " ").trim();
}

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

export function buildSupervisorBlock(subagentNames: string[]): string {
  if (!subagentNames.length) return "";
  return loadPrompt("supervisor", { subagent_names: subagentNames.join(" / ") });
}

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

function selectTaskRunner(agentProvider: AgentProvider, fakeAgent: boolean): TaskRunnerProvider {
  return fakeAgent ? "fake" : agentProvider;
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

async function executeFakeTask(
  params: ExecuteTaskParams,
  progress: ProgressReporter,
  abortController: AbortController,
  startedAt: number,
  shortId: string,
  reporter: TaskReporter,
): Promise<TaskResult> {
  const fake = buildFakeTaskResult(params.prompt, config.agentProvider);
  const result: TaskResult = {
    success: true,
    sessionId: fake.sessionId,
    costUsd: 0,
    durationMs: Date.now() - startedAt + fake.durationMs,
    turns: 1,
    result: fake.reply,
    tokensSummary: fake.tokensSummary,
  };
  const status = finalTaskStatus(params.taskId, abortController, result.success);
  updateTask(params.taskId, {
    session_id: result.sessionId,
    status,
    result_summary: result.result,
    cost_usd: result.costUsd,
    duration_ms: result.durationMs,
    completed_at: new Date().toISOString(),
  });
  reporter.sessionStarted(result.sessionId, config.agentProvider);
  reporter.finished(status, {
    provider: config.agentProvider,
    duration_ms: result.durationMs,
    turns: result.turns,
    cost_usd: result.costUsd,
    session_id: result.sessionId,
  });
  log.info(`✓ ${shortId} e2e-fake done turns=1 wall=${result.durationMs}ms ${result.tokensSummary}`);

  if ((params.outputMode ?? "embed") === "raw") {
    await progress.complete(params.channel);
    await sendRawTaskResult(params.channel, params.taskId, rawDisplayTaskResult(params, result));
    return result;
  }

  await sendEmbedTaskResult(params, progress, abortController, result, ["🧪 e2e fake agent"], 0, params.statusMessage, reporter);
  return result;
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

function pushCompactedLine(lines: string[], line: string): boolean {
  const lastIdx = lines.length - 1;
  if (lastIdx >= 0) {
    const last = lines[lastIdx];
    const baseLast = last.replace(/\s+\(×\d+\)$/, "");
    if (baseLast === line) {
      const m = last.match(/\(×(\d+)\)$/);
      const next = m ? parseInt(m[1], 10) + 1 : 2;
      lines[lastIdx] = `${line} (×${next})`;
      return false;
    }
  }
  lines.push(line);
  return true;
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

async function executeCodexTask(
  params: ExecuteTaskParams,
  progress: ProgressReporter,
  abortController: AbortController,
  startedAt: number,
  shortId: string,
  reporter: TaskReporter,
): Promise<TaskResult> {
  const memoryBlock = buildMemoryPrompt();
  const identityLine = IDENTITY_LINE_TASK;
  const subagentNames = listSubagentNames();
  const supervisorBlock = buildSupervisorBlock(subagentNames);
  const resumeRawId = params.resumeSessionId ? assertProviderSession(params.resumeSessionId, "codex") : undefined;

  const prompt = [
    identityLine,
    supervisorBlock,
    memoryBlock,
    "你正在通过 Codex SDK 执行 MiniClaw 的 coding-agent 任务。请直接完成用户请求；需要修改文件时使用工作区内的工具，最后用中文给出结果和验证证据。",
    formatTaskPromptForSystem(params.prompt),
  ].filter(Boolean).join("\n\n");

  const codex = getCodexClient();
  const threadOptions = codexThreadOptions("task", params.cwd);
  const thread = resumeRawId
    ? codex.resumeThread(resumeRawId, threadOptions)
    : codex.startThread(threadOptions);

  let sessionId = resumeRawId ? formatSessionId("codex", resumeRawId) : "";
  let finalResponse = "";
  let failedMessage = "";
  let tokensSummary: string | undefined;
  const toolCallLog: string[] = [];
  let toolStep = 0;
  let turns = 0;

  const timeoutCtrl = withCodexTimeout(abortController.signal, config.codex.timeoutMs);
  const { events } = await thread.runStreamed(
    codexInput(prompt, params.attachmentCodexInputs),
    { signal: timeoutCtrl.signal },
  );

  for await (const event of events) {
    if (abortController.signal.aborted || timeoutCtrl.signal.aborted) {
      failedMessage = wasInterrupted(params.taskId)
        ? interruptedReason(params.taskId)
        : abortController.signal.aborted ? "任务已被用户取消" : "Codex 执行超时";
      break;
    }

    switch (event.type) {
      case "thread.started": {
        sessionId = formatSessionId("codex", event.thread_id);
        updateTask(params.taskId, { session_id: sessionId });
        reporter.sessionStarted(sessionId, "codex");
        break;
      }
      case "turn.started": {
        turns++;
        reporter.turnStarted(turns, "codex");
        break;
      }
      case "turn.completed": {
        tokensSummary = formatCodexUsage(event.usage);
        reporter.turnCompleted(turns, "codex", event.usage);
        break;
      }
      case "turn.failed": {
        failedMessage = event.error.message;
        reporter.providerError("codex", failedMessage, { event_type: event.type });
        break;
      }
      case "error": {
        failedMessage = event.message;
        reporter.providerError("codex", failedMessage, { event_type: event.type });
        break;
      }
      case "item.started":
      case "item.updated":
      case "item.completed": {
        if (event.item.type === "agent_message") {
          finalResponse = event.item.text;
          break;
        }
        const line = formatCodexItemLine(event.item);
        if (line && pushCompactedLine(toolCallLog, line)) {
          toolStep++;
          reporter.toolEvent("codex", line, { item_type: event.item.type, stream_event: event.type });
          await updateProgressTail(progress, params.channel, toolCallLog, turns, toolStep);
        }
        break;
      }
    }
  }

  if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort();

  if (!sessionId && thread.id) {
    sessionId = formatSessionId("codex", thread.id);
    updateTask(params.taskId, { session_id: sessionId });
  }

  const lastResult: TaskResult = {
    success: !failedMessage && !wasCancelled(params.taskId, abortController) && !wasInterrupted(params.taskId),
    sessionId,
    costUsd: 0,
    durationMs: Date.now() - startedAt,
    turns: turns || 1,
    result: wasInterrupted(params.taskId)
      ? interruptedReason(params.taskId)
      : wasCancelled(params.taskId, abortController)
      ? "任务已被用户取消"
      : failedMessage || finalResponse.trim() || "[无文字回复]",
    ...(tokensSummary ? { tokensSummary } : {}),
  };

  const status = finalTaskStatus(params.taskId, abortController, lastResult.success);
  updateTask(params.taskId, {
    session_id: lastResult.sessionId,
    status,
    result_summary: lastResult.result.slice(0, 10000),
    cost_usd: lastResult.costUsd,
    duration_ms: lastResult.durationMs,
    completed_at: new Date().toISOString(),
  });
  reporter.finished(status, {
    provider: "codex",
    duration_ms: lastResult.durationMs,
    turns: lastResult.turns,
    cost_usd: lastResult.costUsd,
    session_id: lastResult.sessionId,
    tool_count: toolStep,
  });

  log.info(
    `${lastResult.success ? "✓" : "✗"} ${shortId} codex ${lastResult.success ? "done" : "failed"} ` +
    `turns=${lastResult.turns} wall=${lastResult.durationMs}ms tools=${toolStep}` +
    (lastResult.tokensSummary ? ` ${lastResult.tokensSummary}` : "")
  );

  const outputMode = params.outputMode ?? "embed";
  if (outputMode === "raw") {
    await progress.complete(params.channel, lastResult.success ? undefined : { keepAsError: true });
    await sendRawTaskResult(params.channel, params.taskId, rawDisplayTaskResult(params, lastResult));
    return lastResult;
  }

  await sendEmbedTaskResult(params, progress, abortController, lastResult, toolCallLog, toolStep, params.statusMessage, reporter);

  return lastResult;
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
  const runnerProvider = selectTaskRunner(config.agentProvider, config.e2e.fakeAgent);
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

    if (runnerProvider === "fake") {
      return await executeFakeTask(params, progress, abortController, startedAt, shortId, reporter);
    }

    if (runnerProvider === "codex") {
      return await executeCodexTask(params, progress, abortController, startedAt, shortId, reporter);
    }

    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const resumeRawId = resumeId ? assertProviderSession(resumeId, "claude") : undefined;
    const memoryBlock = buildMemoryPrompt();
    const identityLine = IDENTITY_LINE_TASK;

    const subagentCalls: string[] = [];
    const SUBAGENT_PER_ROLE_CAP = parseInt(process.env.MINICLAW_SUBAGENT_ROLE_CAP ?? "4", 10);

    const subagents = loadSubagents();
    const subagentNames = listSubagentNames();
    const mcpServers = loadMcpServers();
    const supervisorBlock = buildSupervisorBlock(subagentNames);
    const claudeFlagSettings = config.claude.disableHooks
      ? { disableAllHooks: true as const }
      : undefined;

    const appendParts = [identityLine, supervisorBlock, memoryBlock].filter(Boolean);

    const hasAttachments = !!(params.attachmentBlocks && params.attachmentBlocks.length);
    const promptParam = hasAttachments
      ? (async function* () {
          yield {
            type: "user" as const,
            parent_tool_use_id: null,
            message: {
              role: "user" as const,
              content: [
                ...params.attachmentBlocks!,
                { type: "text" as const, text: params.prompt },
              ],
            },
          };
        })()
      : params.prompt;

    const q = query({
      prompt: promptParam,
      options: {
        model: config.claudeModel,
        cwd: params.cwd,
        permissionMode: "acceptEdits",
        settingSources: config.claude.settingSources,
        ...(claudeFlagSettings ? { settings: claudeFlagSettings } : {}),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: appendParts.join("\n\n"),
        },
        allowedTools: [
          "Read", "Write", "Edit", "Bash", "Glob",
          "WebSearch", "WebFetch", "Agent",
          "mcp__exa__web_search_exa",
          "mcp__exa__get_code_context_exa",
          "mcp__context7__resolve-library-id",
          "mcp__context7__query-docs",
          ...allowedEastmoneyJywgMcpTools(mcpServers),
          ...allowedFutuStockMcpTools(mcpServers),
        ],
        agents: subagents,
        ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
        canUseTool: async (toolName, input) => {
          const skillName = (input as { skill?: string }).skill;
          const BLOCKED_SKILLS = new Set(["triad", "triad-resume"]);
          if (toolName === "Skill" && skillName && BLOCKED_SKILLS.has(skillName)) {
            return {
              behavior: "deny" as const,
              message: `${skillName} 在 miniclaw 中被禁用（它是面向 CLI 交互的 slash command，与 SDK Discord bot 流程不匹配）。请改用项目角色化 subagent 完成多阶段任务。`,
            };
          }
          if (toolName === "Agent" || toolName === "Task") {
            const role = String((input as { subagent_type?: string }).subagent_type ?? "general");
            const used = subagentCalls.filter((r) => r === role).length;
            if (used >= SUBAGENT_PER_ROLE_CAP) {
              return {
                behavior: "deny" as const,
                message: `subagent ${role} 已被调用 ${used} 次（cap=${SUBAGENT_PER_ROLE_CAP}）。继续重复调用很可能是失控循环——请整合现有输出回复用户，或换不同角色，必要时升级用户。`,
              };
            }
            subagentCalls.push(role);
          }
          if (toolName === "Bash") {
            const cmd = String((input as { command?: string }).command ?? "");
            const DESTRUCTIVE = /\b(rm\s+-rf?\s+\/(?!tmp\/|var\/folders\/)|sudo\b|npm\s+publish|pnpm\s+publish|git\s+push\s+--force(?!-with-lease))\b/;
            if (DESTRUCTIVE.test(cmd)) {
              return {
                behavior: "deny" as const,
                message: `Bash 命令被拒绝：检测到高风险破坏性操作 (${cmd.slice(0, 80)})。如确需执行，请由用户手动操作。`,
              };
            }
          }
          return { behavior: "allow" as const, updatedInput: input };
        },
        ...(config.defaultMaxTurns !== undefined ? { maxTurns: config.defaultMaxTurns } : {}),
        ...(config.defaultBudgetUsd !== undefined ? { maxBudgetUsd: config.defaultBudgetUsd } : {}),
        abortController,
        ...(resumeRawId ? { resume: resumeRawId } : {}),
      },
    });

    let sessionId = "";
    let lastResult: TaskResult | null = null;
    const toolCallLog: string[] = [];
    let toolStep = 0;

    for await (const msg of q) {
      if (abortController.signal.aborted) {
        lastResult = {
          success: false,
          sessionId,
          costUsd: 0,
          durationMs: 0,
          turns: 0,
          result: wasInterrupted(params.taskId) ? interruptedReason(params.taskId) : "任务已被用户取消",
        };
        break;
      }

      switch (msg.type) {
        case "system": {
          if ("session_id" in msg && msg.session_id) {
            sessionId = formatSessionId("claude", msg.session_id);
            updateTask(params.taskId, { session_id: sessionId });
            reporter.sessionStarted(sessionId, "claude");
          }
          break;
        }

        case "assistant": {
          const blocks = msg.message.content;
          const parentId = (msg as { parent_tool_use_id?: string }).parent_tool_use_id;
          const indent = parentId ? "  ↳ " : "";

          for (const block of blocks) {
            if (block.type !== "tool_use") continue;
            toolStep++;
            const input = (block.input ?? {}) as Record<string, unknown>;
            const icon = toolIcon(block.name);
            const short = toolShortName(block.name);
            const detail = formatToolDetail(block.name, input);
            const display = detail.length > 60 ? detail.slice(0, 60) + "..." : detail;
            const line = `${indent}${icon} ${short}${display ? `: "${display}"` : ""}`;

            const lastIdx = toolCallLog.length - 1;
            if (lastIdx >= 0) {
              const last = toolCallLog[lastIdx];
              const baseLast = last.replace(/\s+\(×\d+\)$/, "");
              if (baseLast === line) {
                const m = last.match(/\(×(\d+)\)$/);
                const next = m ? parseInt(m[1], 10) + 1 : 2;
                toolCallLog[lastIdx] = `${line} (×${next})`;
                continue;
              }
            }
            toolCallLog.push(line);
            reporter.toolEvent("claude", line, {
              tool_name: block.name,
              parent_tool_use_id: parentId,
            });
          }

          if (toolCallLog.length) {
            await progress.update(buildRealtimeProgress(toolCallLog, lastResult?.turns ?? 0, toolStep), params.channel);
          }
          break;
        }

        case "result": {
          const costUsd = msg.subtype === "success" ? msg.total_cost_usd : 0;
          const durationMs = msg.duration_ms;
          const turns = msg.num_turns;
          const result = msg.subtype === "success"
            ? msg.result
            : ("errors" in msg ? msg.errors.join("\n") : "Unknown error");
          sessionId = msg.session_id ? formatSessionId("claude", msg.session_id) : sessionId;
          const tokensSummary = formatUsage((msg as { usage?: unknown }).usage);

          lastResult = {
            success: msg.subtype === "success",
            sessionId,
            costUsd,
            durationMs,
            turns,
            result,
            ...(tokensSummary ? { tokensSummary } : {}),
          };
          if (!lastResult.success) {
            reporter.providerError("claude", result, { subtype: msg.subtype });
          }
          break;
        }
      }
    }

    if (!lastResult) {
      lastResult = {
        success: false,
        sessionId,
        costUsd: 0,
        durationMs: 0,
        turns: 0,
        result: wasInterrupted(params.taskId)
          ? interruptedReason(params.taskId)
          : wasCancelled(params.taskId, abortController) ? "任务已被用户取消" : "任务被中断或无结果",
      };
    }

    const status = finalTaskStatus(params.taskId, abortController, lastResult.success);
    updateTask(params.taskId, {
      session_id: lastResult.sessionId,
      status,
      result_summary: lastResult.result.slice(0, 10000),
      cost_usd: lastResult.costUsd,
      duration_ms: lastResult.durationMs,
      completed_at: new Date().toISOString(),
    });
    reporter.finished(status, {
      provider: "claude",
      duration_ms: lastResult.durationMs,
      turns: lastResult.turns,
      cost_usd: lastResult.costUsd,
      session_id: lastResult.sessionId,
      tool_count: toolStep,
    });

    const wallMs = Date.now() - startedAt;
    const subagentTrace = subagentCalls.length
      ? ` subagents=[${subagentCalls.join("→")}]`
      : "";
    log.info(
      `${lastResult.success ? "✓" : "✗"} ${shortId} ${lastResult.success ? "done" : "failed"} ` +
      `turns=${lastResult.turns} cost=$${lastResult.costUsd.toFixed(4)} ` +
      `sdk=${lastResult.durationMs}ms wall=${wallMs}ms tools=${toolStep}` +
      subagentTrace +
      (lastResult.tokensSummary ? ` ${lastResult.tokensSummary}` : "")
    );

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
