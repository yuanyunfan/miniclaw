import type { AnyThreadChannel, Message, StartThreadOptions } from "discord.js";

export async function getOrCreateMessageThread(
  message: Message,
  options: StartThreadOptions,
): Promise<AnyThreadChannel> {
  if (message.hasThread) {
    if (message.thread) return message.thread;
    if ("threads" in message.channel) {
      const thread = await message.channel.threads.fetch(message.id).catch(() => null);
      if (thread) return thread;
    }
    throw new Error("message already has a thread, but the thread could not be loaded");
  }

  return await message.startThread(options);
}
