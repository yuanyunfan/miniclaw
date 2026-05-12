import { AttachmentBuilder, type InteractionEditReplyOptions } from "discord.js";
import {
  formatTaskTraceSummary,
  renderTaskTraceMarkdown,
  taskTraceFileName,
  type TaskTraceError,
  type TaskTraceModel,
} from "../store/task-trace-export.js";

export const TASK_TRACE_INLINE_LIMIT = 1_700;
export const TASK_TRACE_DISCORD_MAX_BYTES = 120_000;

export function formatTaskTraceError(error: TaskTraceError): string {
  if (error.code === "ambiguous_prefix") {
    const matches = error.matches?.map((id) => id.slice(0, 12)).join(", ") ?? "-";
    return `❌ ${error.message}: ${matches}`;
  }
  return `❌ ${error.message}`;
}

export function buildTaskLogReply(
  model: TaskTraceModel,
  markdown = renderTaskTraceMarkdown(model, { maxBytes: TASK_TRACE_DISCORD_MAX_BYTES })
): InteractionEditReplyOptions {
  if (markdown.length <= TASK_TRACE_INLINE_LIMIT) {
    return { content: markdown };
  }

  const summary = [
    formatTaskTraceSummary(model),
    "",
    "Trace 较长，已附加 Markdown 文件。默认 trace 不包含 prompt/raw provider payload/cookie/token/email body。",
  ].join("\n");

  return {
    content: summary.slice(0, TASK_TRACE_INLINE_LIMIT),
    files: [
      new AttachmentBuilder(Buffer.from(markdown, "utf8"), {
        name: taskTraceFileName(model.task.id),
      }),
    ],
  };
}
