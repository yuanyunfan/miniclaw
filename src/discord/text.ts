import { MessageFlags, type Message, type SendableChannels } from "discord.js";
import { chunkMessageWithDeferredLinkPreviews, type ChunkedDiscordText } from "./chunks.js";

function messagePayload(chunk: ChunkedDiscordText): {
  content: string;
  flags?: MessageFlags.SuppressEmbeds;
  allowedMentions: { parse: [] };
} {
  return {
    content: chunk.content,
    ...(chunk.suppressEmbeds ? { flags: MessageFlags.SuppressEmbeds } : {}),
    allowedMentions: { parse: [] },
  };
}

export async function sendChunkedTextWithDeferredLinkPreviews(
  channel: SendableChannels,
  text: string,
  fallback?: string,
): Promise<void> {
  for (const chunk of chunkMessageWithDeferredLinkPreviews(text, fallback)) {
    await channel.send(messagePayload(chunk));
  }
}

export async function replyChunkedTextWithDeferredLinkPreviews(
  message: Message,
  text: string,
  fallback?: string,
): Promise<void> {
  const chunks = chunkMessageWithDeferredLinkPreviews(text, fallback);
  const [first, ...rest] = chunks;
  if (!first) return;

  await message.reply({
    ...messagePayload(first),
    allowedMentions: { parse: [], repliedUser: false },
  });

  for (const chunk of rest) {
    const payload = messagePayload(chunk);
    if (message.channel.isSendable()) await message.channel.send(payload);
    else await message.reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } });
  }
}
