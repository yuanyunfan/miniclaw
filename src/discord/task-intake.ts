import type { AnyThreadChannel, Attachment, Message } from "discord.js";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { executeTask, getActiveTaskCount } from "../agent/task.js";
import { createTask } from "../store/db.js";
import { processAttachments } from "./attachments.js";
import { taskStartEmbed } from "./formatter.js";
import { createLogger } from "../lib/log.js";

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
  createThread: (name: string) => Promise<CreatedThread>;
  onCreated?: (result: DiscordTaskIntakeResult) => Promise<void>;
}

export function taskCapacityError(): string | undefined {
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

  const thread = await params.createThread(taskThreadName(displayPrompt));

  createTask({
    id: taskId,
    discord_thread_id: thread.id,
    discord_user_id: params.userId,
    prompt: params.prompt,
    cwd: params.cwd,
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
    prompt: params.prompt,
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
