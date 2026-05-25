import type { AnyThreadChannel, Attachment, Message } from "discord.js";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import type { AgentRuntimeId } from "../agent/runtimes/registry.js";
import { executeTask, getActiveTaskCount, type TaskResult } from "../agent/task.js";
import { TaskReporter } from "../agent/task-reporter.js";
import { createTask } from "../store/db.js";
import { processAttachments } from "./attachments.js";
import { taskStartEmbed } from "./formatter.js";
import { createLogger } from "../lib/log.js";
import { DRAINING_MESSAGE, isDraining } from "../runtime/shutdown.js";
import { buildTaskPromptWithContext, type TaskContextEnvelope } from "../routing/task-context.js";
import { withTaskThreadMetadata } from "./task-context.js";

const log = createLogger("task-intake");

type CreatedThread = AnyThreadChannel;

export interface DiscordTaskIntakeResult {
  taskId: string;
  threadId: string;
  thread: CreatedThread;
  statusMessage?: Message;
}

export interface DiscordTaskIntakeParams {
  prompt: string;
  displayPrompt?: string;
  cwd: string;
  userId: string;
  attachments?: Attachment[];
  taskContext?: TaskContextEnvelope;
  runtimeId?: AgentRuntimeId;
  resumeSessionId?: string;
  createThread: (name: string) => Promise<CreatedThread>;
  onCreated?: (result: DiscordTaskIntakeResult) => Promise<void>;
  onCompleted?: (result: DiscordTaskIntakeResult, taskResult: TaskResult) => Promise<void>;
}

export function taskCapacityError(): string | undefined {
  if (isDraining()) return DRAINING_MESSAGE;
  if (getActiveTaskCount() < config.maxConcurrentTasks) return undefined;
  return `⚠️ 已达并发上限 (${config.maxConcurrentTasks})，请等待现有任务完成`;
}

export function taskThreadName(prompt: string, prefix = "🤖"): string {
  const clean = prompt.replace(/\s+/g, " ").trim() || "MiniClaw task";
  return `${prefix} ${clean.slice(0, 90)}`;
}

export function formatTaskCompletionNotice(
  result: Pick<DiscordTaskIntakeResult, "taskId" | "threadId">,
  taskResult: Pick<TaskResult, "success" | "durationMs">
): string {
  const status = taskResult.success ? "✅ 任务已完成" : "❌ 任务未成功完成";
  const elapsed = Number.isFinite(taskResult.durationMs)
    ? `，耗时 ${(taskResult.durationMs / 1000).toFixed(1)}s`
    : "";
  return `${status}: \`${result.taskId.slice(0, 8)}\`${elapsed}，结果见线程 <#${result.threadId}>`;
}

export async function createAndRunDiscordTask(params: DiscordTaskIntakeParams): Promise<DiscordTaskIntakeResult> {
  const capacity = taskCapacityError();
  if (capacity) throw new Error(capacity);

  const taskId = uuid();
  const displayPrompt = params.displayPrompt ?? params.prompt;
  const attachments = params.attachments ?? [];
  let attachmentBlocks: Awaited<ReturnType<typeof processAttachments>>["blocks"] = [];
  let attachmentCodexInputs: Awaited<ReturnType<typeof processAttachments>>["codexInputs"] = [];
  let attachmentNotices: string[] = [];

  if (attachments.length) {
    const processed = await processAttachments(attachments, { cwd: params.cwd, scope: taskId });
    attachmentBlocks = processed.blocks;
    attachmentCodexInputs = processed.codexInputs;
    attachmentNotices = processed.notices;
  }

  const lateCapacity = taskCapacityError();
  if (lateCapacity) throw new Error(lateCapacity);

  const thread = await params.createThread(taskThreadName(displayPrompt));
  const sourceMetadata = withTaskThreadMetadata(params.taskContext?.source, thread);
  const taskContext = {
    ...(sourceMetadata ? { source: sourceMetadata } : {}),
    ...(params.taskContext?.parent ? { parent: params.taskContext.parent } : {}),
  };
  const executionPrompt = buildTaskPromptWithContext(params.prompt, taskContext);

  createTask({
    id: taskId,
    discord_thread_id: thread.id,
    discord_user_id: params.userId,
    prompt: displayPrompt,
    cwd: params.cwd,
    ...(sourceMetadata?.route_type ? { source_route_type: sourceMetadata.route_type } : {}),
    ...(sourceMetadata?.source_channel_id ? { source_channel_id: sourceMetadata.source_channel_id } : {}),
    ...(sourceMetadata?.source_message_id ? { source_message_id: sourceMetadata.source_message_id } : {}),
    ...(sourceMetadata?.source_message_url ? { source_message_url: sourceMetadata.source_message_url } : {}),
    ...(sourceMetadata ? { source_metadata_json: JSON.stringify(sourceMetadata) } : {}),
    ...(params.taskContext?.parent ? { parent_context_json: JSON.stringify(params.taskContext.parent) } : {}),
  });
  const reporter = new TaskReporter(taskId);
  reporter.accepted({
    route: sourceMetadata?.route_type ?? "discord_task",
    cwd: params.cwd,
    user_id: params.userId,
    thread_id: thread.id,
    source_channel_id: sourceMetadata?.source_channel_id,
    source_message_id: sourceMetadata?.source_message_id,
    resume_session_id: params.resumeSessionId,
    attachments: attachments.length,
  });
  reporter.contextCaptured({
    has_source_metadata: Boolean(sourceMetadata),
    has_parent_context: Boolean(params.taskContext?.parent),
    source_route_type: sourceMetadata?.route_type,
    source_channel_id: sourceMetadata?.source_channel_id,
    source_message_url: sourceMetadata?.source_message_url,
  });

  let statusMessage: Message;
  try {
    statusMessage = await thread.send({
      embeds: [taskStartEmbed(taskId, displayPrompt, params.cwd, {
        provider: params.runtimeId ?? config.runtime.defaultAgent,
        model: config.model,
      })],
    });
  } catch (err) {
    reporter.discordDeliveryFailed("intake_status_send", err);
    throw err;
  }
  for (const notice of attachmentNotices) {
    await thread.send(notice).catch((err) => reporter.discordDeliveryFailed("attachment_notice_send", err));
  }

  const result: DiscordTaskIntakeResult = { taskId, threadId: thread.id, thread, statusMessage };
  await params.onCreated?.(result);

  executeTask({
    taskId,
    prompt: executionPrompt,
    cwd: params.cwd,
    channel: thread,
    attachmentBlocks,
    attachmentCodexInputs,
    statusMessage,
    ...(params.runtimeId ? { runtimeId: params.runtimeId } : {}),
    ...(params.resumeSessionId ? { resumeSessionId: params.resumeSessionId } : {}),
  }).then(async (taskResult) => {
    try {
      await params.onCompleted?.(result, taskResult);
    } catch (err) {
      log.error(`Task ${taskId} completion notification failed:`, err);
    }
  }).catch((err) => {
    log.error(`Task ${taskId} error:`, err);
    void thread.send(`❌ task error: ${err?.message ?? err}`).catch(() => {});
  });

  return result;
}
