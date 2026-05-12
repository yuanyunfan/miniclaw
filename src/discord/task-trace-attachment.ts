import { AttachmentBuilder, type MessageCreateOptions, type SendableChannels } from "discord.js";
import {
  buildTaskTraceModel,
  formatTaskTraceSummary,
  renderTaskTraceMarkdown,
  taskTraceFileName,
} from "../store/task-trace-export.js";

export type TaskTraceTerminalStatus = "completed" | "failed" | "cancelled" | "interrupted";

export interface TaskTraceAutoAttachConfig {
  enabled: boolean;
  onFailure: boolean;
  minDurationMs: number;
  minEventCount: number;
  maxBytes: number;
}

export interface TaskTraceAutoAttachContext {
  taskId: string;
  status: TaskTraceTerminalStatus;
  durationMs: number;
}

export function taskTraceAutoAttachReason(
  config: TaskTraceAutoAttachConfig | undefined,
  context: TaskTraceAutoAttachContext,
  totalEventCount: number
): string | undefined {
  if (!config?.enabled) return undefined;
  if (config.onFailure && context.status !== "completed") return "terminal status is not completed";
  if (config.minDurationMs > 0 && context.durationMs >= config.minDurationMs) {
    return `duration_ms ${context.durationMs} >= ${config.minDurationMs}`;
  }
  if (config.minEventCount > 0 && totalEventCount >= config.minEventCount) {
    return `event_count ${totalEventCount} >= ${config.minEventCount}`;
  }
  return undefined;
}

export function shouldAutoAttachTaskTrace(
  config: TaskTraceAutoAttachConfig | undefined,
  context: TaskTraceAutoAttachContext,
  totalEventCount: number
): boolean {
  return taskTraceAutoAttachReason(config, context, totalEventCount) !== undefined;
}

export async function sendTaskTraceAutoAttachment(
  channel: SendableChannels,
  config: TaskTraceAutoAttachConfig | undefined,
  context: TaskTraceAutoAttachContext
): Promise<boolean> {
  if (!config?.enabled) return false;

  const model = buildTaskTraceModel(context.taskId, { maxEvents: 300 });
  if (!model.ok) return false;

  const reason = taskTraceAutoAttachReason(config, context, model.value.totalEventCount);
  if (!reason) return false;

  const markdown = renderTaskTraceMarkdown(model.value, { maxBytes: config.maxBytes });
  const payload: MessageCreateOptions = {
    content: [
      `${formatTaskTraceSummary(model.value)} | auto-attach: ${reason}`,
      "Markdown trace 已自动附加。默认 trace 不包含 prompt/raw provider payload/cookie/token/email body。",
    ].join("\n").slice(0, 1900),
    files: [
      new AttachmentBuilder(Buffer.from(markdown, "utf8"), {
        name: taskTraceFileName(context.taskId),
      }),
    ],
  };
  await channel.send(payload);
  return true;
}
