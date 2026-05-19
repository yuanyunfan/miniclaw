import type { Message, SendableChannels } from "discord.js";
import type { TaskResult } from "../agent/task.js";
import type { TaskTerminalStatus, TaskViewProgressSnapshot, TaskViewReporter } from "../agent/task-view.js";
import type { TaskViewEvent } from "../agent/task-view-events.js";
import { chunkMessage } from "./chunks.js";
import { taskCompleteEmbed, taskErrorEmbed, taskStartEmbed } from "./formatter.js";
import { ProgressReporter } from "./progress.js";
import { sendChunkedTextWithDeferredLinkPreviews } from "./text.js";
import { enqueueTaskResultDelivery } from "../monitoring/recovery-outbox.js";
import {
  sendTaskTraceAutoAttachment,
  type TaskTraceAutoAttachConfig,
} from "./task-trace-attachment.js";

const PROGRESS_TAIL_LINES = 25;

export interface DiscordTaskViewReporterOptions {
  taskId: string;
  prompt: string;
  cwd: string;
  channel: SendableChannels;
  provider: string;
  model?: string;
  outputMode?: "embed" | "raw";
  statusMessage?: Message;
  rawOutputTextTransform?: (text: string) => string;
  traceAutoAttach?: TaskTraceAutoAttachConfig;
  deliveryChannelId?: string;
  deliveryContext?: {
    route?: string;
    jobName?: string;
  };
  onDeliveryError?: (operation: string, err: unknown) => void;
}

interface ViewProgressState {
  lines: string[];
  turns: number;
  toolCount: number;
}

export function rawTaskMessages(taskId: string, result: TaskResult): string[] {
  const fallback = result.success ? "[无文字回复]" : "任务失败且无错误详情";
  const text = result.result.trim() ? result.result : fallback;
  if (result.success) return chunkMessage(text);
  return [`❌ \`${taskId.slice(0, 8)}\` 失败: ${text.slice(0, 1900)}`];
}

function rawDisplayTaskResult(
  result: TaskResult,
  transform?: (text: string) => string,
): TaskResult {
  if (!result.success || !transform) return result;
  return { ...result, result: transform(result.result) };
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

export function buildExecutionSummary(
  status: TaskTerminalStatus,
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

export function buildRealtimeProgress(lines: string[], turns: number, toolCount: number): string {
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

function pushCompactedViewLine(lines: string[], line: string): boolean {
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

async function updateStatusMessage(
  channel: SendableChannels,
  message: Message | undefined,
  embed: ReturnType<typeof taskCompleteEmbed>,
): Promise<Message | undefined> {
  if (message) {
    try {
      await message.edit({ embeds: [embed] });
      return message;
    } catch {
      // Fall back to sending a new status card below.
    }
  }
  return await channel.send({ embeds: [embed] });
}

function taskViewProgressLine(event: Extract<TaskViewEvent, { type: "tool_progress" | "assistant_progress" }>): string {
  if (event.type === "assistant_progress") return event.text;
  return event.detail ? `${event.title}: "${event.detail}"` : event.title;
}

export class DiscordTaskViewReporter implements TaskViewReporter {
  private readonly progress: ProgressReporter;
  private readonly outputMode: "embed" | "raw";
  private readonly state: ViewProgressState = { lines: [], turns: 0, toolCount: 0 };
  private statusMessage?: Message;

  constructor(private readonly options: DiscordTaskViewReporterOptions) {
    this.outputMode = options.outputMode ?? "embed";
    this.statusMessage = options.statusMessage;
    this.progress = new ProgressReporter(options.taskId, {
      minUpdateIntervalMs: 2000,
      onDeliveryError: (operation, err) => options.onDeliveryError?.(`progress_${operation}`, err),
    });
  }

  async start(): Promise<void> {
    if (this.outputMode !== "embed") return;

    if (!this.statusMessage) {
      try {
        this.statusMessage = await this.options.channel.send({
          embeds: [taskStartEmbed(this.options.taskId, this.options.prompt, this.options.cwd, {
            provider: this.options.provider,
            model: this.options.model,
          })],
        });
      } catch (err) {
        this.options.onDeliveryError?.("start_status_send", err);
      }
    }

    await this.progress.update(buildRealtimeProgress([], 0, 0), this.options.channel);
  }

  async handle(event: TaskViewEvent): Promise<void> {
    switch (event.type) {
      case "turn_started": {
        this.state.turns = event.turn;
        break;
      }
      case "tool_progress":
      case "assistant_progress": {
        const line = taskViewProgressLine(event);
        const added = pushCompactedViewLine(this.state.lines, line);
        if (event.type === "tool_progress" && event.countAsTool !== false) this.state.toolCount++;
        const countedToolEvent = event.type === "tool_progress" && event.countAsTool !== false;
        if (this.outputMode === "embed" && (added || countedToolEvent)) {
          await this.progress.update(
            buildRealtimeProgress(this.state.lines, this.state.turns, this.state.toolCount),
            this.options.channel,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  snapshot(): TaskViewProgressSnapshot {
    return {
      lines: [...this.state.lines],
      turns: this.state.turns,
      toolCount: this.state.toolCount,
    };
  }

  async finish(
    result: TaskResult,
    status: TaskTerminalStatus,
    progressSnapshot: Partial<Pick<TaskViewProgressSnapshot, "lines" | "toolCount">> = {},
  ): Promise<void> {
    if (this.outputMode === "raw") {
      await this.progress.complete(this.options.channel, result.success ? undefined : { keepAsError: true });
      const displayResult = rawDisplayTaskResult(result, this.options.rawOutputTextTransform);
      try {
        await sendRawTaskResult(this.options.channel, this.options.taskId, displayResult);
      } catch (err) {
        this.options.onDeliveryError?.("final_raw_send", err);
        try {
          const channelId = this.options.deliveryChannelId ?? (this.options.channel as { id?: string }).id;
          enqueueTaskResultDelivery({
            channelId: channelId ?? "",
            taskId: this.options.taskId,
            messages: rawTaskMessages(this.options.taskId, displayResult),
            success: displayResult.success,
            durationMs: displayResult.durationMs,
            route: this.options.deliveryContext?.route,
            jobName: this.options.deliveryContext?.jobName,
            deliveryError: err instanceof Error ? err.message : String(err),
          });
        } catch (queueErr) {
          this.options.onDeliveryError?.("final_raw_delivery_enqueue", queueErr);
        }
        return;
      }
      return;
    }

    const toolCallLog = progressSnapshot.lines ?? this.state.lines;
    const toolCount = progressSnapshot.toolCount ?? this.state.toolCount;

    await this.progress.complete(this.options.channel, {
      finalText: buildExecutionSummary(status, result, toolCallLog, toolCount),
    });

    const embed = result.success
      ? taskCompleteEmbed({
          taskId: this.options.taskId,
          durationMs: result.durationMs,
          costUsd: result.costUsd,
          turns: result.turns,
          sessionId: result.sessionId,
          provider: this.options.provider,
          model: this.options.model,
          cwd: this.options.cwd,
          toolCount,
          ...(result.tokensSummary ? { tokensSummary: result.tokensSummary } : {}),
        })
      : taskErrorEmbed(this.options.taskId, result.result);

    try {
      this.statusMessage = await updateStatusMessage(this.options.channel, this.statusMessage, embed);
    } catch (err) {
      this.options.onDeliveryError?.("status_message_update", err);
    }
    try {
      await sendMarkdownTaskResult(this.options.channel, result);
    } catch (err) {
      this.options.onDeliveryError?.("final_markdown_send", err);
    }

    try {
      await sendTaskTraceAutoAttachment(this.options.channel, this.options.traceAutoAttach, {
        taskId: this.options.taskId,
        status,
        durationMs: result.durationMs,
      });
    } catch (err) {
      this.options.onDeliveryError?.("trace_auto_attach_send", err);
    }
  }

  async renderTaskError(message: string): Promise<void> {
    await this.progress.complete(this.options.channel, { keepAsError: true });
    try {
      await this.options.channel.send({ embeds: [taskErrorEmbed(this.options.taskId, message)] });
    } catch (err) {
      this.options.onDeliveryError?.("error_embed_send", err);
    }
  }
}

export const __testables = {
  rawTaskMessages,
  buildExecutionSummary,
  buildRealtimeProgress,
};
