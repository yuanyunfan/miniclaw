import { MessageFlags, type Message, type MessageCreateOptions, type SendableChannels } from "discord.js";
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
  options: { files?: MessageCreateOptions["files"] } = {},
): Promise<void> {
  const chunks = chunkMessageWithDeferredLinkPreviews(text, fallback);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const isLast = i === chunks.length - 1;
    await channel.send({
      ...messagePayload(chunk),
      ...(isLast && options.files?.length ? { files: options.files } : {}),
    });
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
