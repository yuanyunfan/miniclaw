import {
  MessageFlags,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
  type SendableChannels,
} from "discord.js";
import { chunkMessageWithDeferredLinkPreviews, type ChunkedDiscordText } from "../discord/chunks.js";
import {
  getCronDeliveryMessageGroup,
  upsertCronDeliveryMessageGroup,
} from "../store/cron-delivery-messages.js";

const DELIVERY_MODE = "daily_message_group";

export interface DailyMessageGroupDeliveryInput {
  channel: SendableChannels;
  jobName: string;
  channelId: string;
  taskId: string;
  text: string;
  runAt: Date;
  timezone: string;
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year");
  const month = byType.get("month");
  const day = byType.get("day");
  if (!year || !month || !day) throw new Error(`failed to format local date for timezone ${timezone}`);
  return `${year}-${month}-${day}`;
}

function messagePayload(chunk: ChunkedDiscordText): MessageCreateOptions {
  return {
    content: chunk.content.slice(0, 2000),
    allowedMentions: { parse: [] },
    ...(chunk.suppressEmbeds ? { flags: MessageFlags.SuppressEmbeds } : {}),
  };
}

function editPayload(chunk: ChunkedDiscordText): MessageEditOptions {
  return {
    content: chunk.content.slice(0, 2000),
    allowedMentions: { parse: [] },
    ...(chunk.suppressEmbeds ? { flags: MessageFlags.SuppressEmbeds } : {}),
  };
}

function messageManager(channel: SendableChannels): { fetch(id: string): Promise<Message> } {
  if (!("messages" in channel)) {
    throw new Error("daily message group delivery requires a Discord channel with message history access");
  }
  return channel.messages as { fetch(id: string): Promise<Message> };
}

async function editOrSendChunk(
  channel: SendableChannels,
  existingId: string | undefined,
  chunk: ChunkedDiscordText,
): Promise<string> {
  const payload = messagePayload(chunk);
  if (existingId) {
    try {
      const existing = await messageManager(channel).fetch(existingId);
      await existing.edit(editPayload(chunk));
      return existingId;
    } catch {
      // Missing/deleted messages are replaced below; delivery should not fail
      // just because an operator cleaned up part of yesterday's group.
    }
  }
  const sent = await channel.send(payload);
  return "id" in sent ? String(sent.id) : "";
}

async function deleteExtraChunk(channel: SendableChannels, messageId: string): Promise<void> {
  try {
    const existing = await messageManager(channel).fetch(messageId);
    await existing.delete();
  } catch {
    // Best-effort cleanup. A missing extra message already has the desired
    // observable state.
  }
}

export async function deliverDailyMessageGroup(input: DailyMessageGroupDeliveryInput): Promise<void> {
  const deliveryKey = localDateKey(input.runAt, input.timezone);
  const existing = getCronDeliveryMessageGroup({
    jobName: input.jobName,
    channelId: input.channelId,
    deliveryKey,
    deliveryMode: DELIVERY_MODE,
  });
  const chunks = chunkMessageWithDeferredLinkPreviews(input.text, "[无文字回复]");
  const nextMessageIds: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const id = await editOrSendChunk(input.channel, existing?.messageIds[i], chunks[i]!);
    if (id) nextMessageIds.push(id);
  }

  for (const extraId of existing?.messageIds.slice(chunks.length) ?? []) {
    await deleteExtraChunk(input.channel, extraId);
  }

  upsertCronDeliveryMessageGroup({
    jobName: input.jobName,
    channelId: input.channelId,
    deliveryKey,
    deliveryMode: DELIVERY_MODE,
    taskId: input.taskId,
    messageIds: nextMessageIds,
  });
}

export const __testables = {
  localDateKey,
};
