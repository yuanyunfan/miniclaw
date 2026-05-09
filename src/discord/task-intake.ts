import type { AnyThreadChannel, Attachment, Message } from "discord.js";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { executeTask, getActiveTaskCount } from "../agent/task.js";
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
  createThread: (name: string) => Promise<CreatedThread>;
  onCreated?: (result: DiscordTaskIntakeResult) => Promise<void>;
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

  const statusMessage = await thread.send({
    embeds: [taskStartEmbed(taskId, displayPrompt, params.cwd, {
      provider: config.agentProvider,
      model: config.model,
    })],
  });
  for (const notice of attachmentNotices) {
    await thread.send(notice).catch(() => {});
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
  }).catch((err) => {
    log.error(`Task ${taskId} error:`, err);
    void thread.send(`❌ task error: ${err?.message ?? err}`).catch(() => {});
  });

  return result;
}
