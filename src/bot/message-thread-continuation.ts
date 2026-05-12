import type { Message } from "discord.js";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { executeTask } from "../agent/task.js";
import { TaskReporter } from "../agent/task-reporter.js";
import { assertProviderSession } from "../agent/session.js";
import { processAttachments } from "../discord/attachments.js";
import {
  buildTaskSourceFromMessage,
  resolveReplyParentContext,
  withTaskThreadMetadata,
} from "../discord/task-context.js";
import { taskCapacityError } from "../discord/task-intake.js";
import { buildTaskPromptWithContext } from "../routing/task-context.js";
import { createTask, type TaskRow } from "../store/db.js";

export interface ThreadContinuationMessageOptions {
  botUserId: string;
  markProcessed: (messageId: string) => boolean;
}

function threadName(message: Message): string {
  return "name" in message.channel && typeof message.channel.name === "string"
    ? message.channel.name
    : "";
}

export async function handleThreadContinuationMessage(
  message: Message,
  continuableTask: TaskRow,
  options: ThreadContinuationMessageOptions
): Promise<void> {
  const resumeSessionId = continuableTask.session_id;
  if (!resumeSessionId) return;

  try {
    assertProviderSession(resumeSessionId, config.runtime.defaultAgent);
  } catch (err) {
    await message.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (!options.markProcessed(message.id)) return;

  const followupContent = message.content.trim();
  const followupAtts = Array.from(message.attachments.values());
  if (!followupContent && !followupAtts.length) return;

  const capacity = taskCapacityError();
  if (capacity) {
    await message.reply(capacity);
    return;
  }

  const newTaskId = uuid();
  let followupBlocks: Awaited<ReturnType<typeof processAttachments>>["blocks"] = [];
  let followupCodexInputs: Awaited<ReturnType<typeof processAttachments>>["codexInputs"] = [];
  if (followupAtts.length) {
    const r = await processAttachments(followupAtts, {
      cwd: continuableTask.cwd ?? config.defaultCwd,
      scope: newTaskId,
    });
    followupBlocks = r.blocks;
    followupCodexInputs = r.codexInputs;
    for (const n of r.notices) {
      if (message.channel.isSendable()) await message.channel.send(n).catch(() => {});
    }
  }
  const effectivePrompt = followupContent || "请处理这些附件";
  const parentContext = await resolveReplyParentContext(message);
  const sourceMetadata = withTaskThreadMetadata(
    buildTaskSourceFromMessage(message, "thread_continuation", {
      cwd: continuableTask.cwd ?? config.defaultCwd,
      wasMentioned: message.mentions.has(options.botUserId),
    }),
    {
      id: message.channel.id,
      name: threadName(message),
    }
  );
  const executionPrompt = buildTaskPromptWithContext(effectivePrompt, {
    ...(sourceMetadata ? { source: sourceMetadata } : {}),
    ...(parentContext ? { parent: parentContext } : {}),
  });

  await message.react("🔄").catch(() => {});
  if (message.channel.isSendable()) {
    const lateCapacity = taskCapacityError();
    if (lateCapacity) {
      await message.reply(lateCapacity);
      return;
    }
    createTask({
      id: newTaskId,
      discord_thread_id: message.channel.id,
      discord_user_id: message.author.id,
      prompt: effectivePrompt,
      cwd: continuableTask.cwd ?? config.defaultCwd,
      ...(sourceMetadata?.route_type ? { source_route_type: sourceMetadata.route_type } : {}),
      ...(sourceMetadata?.source_channel_id ? { source_channel_id: sourceMetadata.source_channel_id } : {}),
      ...(sourceMetadata?.source_message_id ? { source_message_id: sourceMetadata.source_message_id } : {}),
      ...(sourceMetadata?.source_message_url ? { source_message_url: sourceMetadata.source_message_url } : {}),
      ...(sourceMetadata ? { source_metadata_json: JSON.stringify(sourceMetadata) } : {}),
      ...(parentContext ? { parent_context_json: JSON.stringify(parentContext) } : {}),
    });
    const reporter = new TaskReporter(newTaskId);
    reporter.accepted({
      route: sourceMetadata?.route_type ?? "thread_continuation",
      cwd: continuableTask.cwd ?? config.defaultCwd,
      user_id: message.author.id,
      thread_id: message.channel.id,
      resume_session_id: resumeSessionId,
      attachments: followupAtts.length,
    });
    reporter.contextCaptured({
      has_source_metadata: Boolean(sourceMetadata),
      has_parent_context: Boolean(parentContext),
      source_route_type: sourceMetadata?.route_type,
      source_channel_id: sourceMetadata?.source_channel_id,
      source_message_url: sourceMetadata?.source_message_url,
    });
    executeTask({
      taskId: newTaskId,
      prompt: executionPrompt,
      cwd: continuableTask.cwd ?? config.defaultCwd,
      channel: message.channel,
      resumeSessionId,
      attachmentBlocks: followupBlocks,
      attachmentCodexInputs: followupCodexInputs,
    }).catch((e) => {
      if (message.channel.isSendable()) {
        void message.channel.send(`❌ resume error: ${e?.message ?? e}`);
      }
    });
  }
}
