import { MessageFlags, type Client, type MessageCreateOptions, type SendableChannels } from "discord.js";
import type { IMTransport, SentMessage } from "../../contracts.js";

export function createDiscordTransport(client: Client): IMTransport {
  async function fetchSendable(target: string): Promise<SendableChannels> {
    const channel = await client.channels.fetch(target);
    if (!channel || !("isSendable" in channel) || !channel.isSendable()) {
      throw new Error(`Discord channel ${target} not sendable or not found`);
    }
    return channel as SendableChannels;
  }

  return {
    id: "discord",
    kind: "im_transport",
    capabilities: {
      richEmbeds: true,
      markdown: "discord",
      editMessage: true,
      threads: true,
      files: true,
      buttons: true,
      slashCommands: true,
      mentions: true,
    },
    async send(input): Promise<SentMessage> {
      const channel = await fetchSendable(input.target.target);
      const content = input.content.slice(0, 2000);
      const payload: MessageCreateOptions = {
        content,
        allowedMentions: { parse: [] },
        ...(input.components?.length ? { components: input.components as MessageCreateOptions["components"] } : {}),
        ...(input.suppressEmbeds ? { flags: MessageFlags.SuppressEmbeds } : {}),
      };
      const message = await channel.send(payload);
      return {
        transport: "discord",
        target: input.target.target,
        threadId: input.target.threadId,
        messageId: "id" in message ? String(message.id) : "",
        url: "url" in message ? String(message.url) : undefined,
      };
    },
    async edit(input): Promise<void> {
      const channel = await fetchSendable(input.message.target);
      if (!("messages" in channel)) {
        throw new Error(`Discord channel ${input.message.target} does not expose message manager`);
      }
      const message = await channel.messages.fetch(input.message.messageId);
      await message.edit(input.content.slice(0, 2000));
    },
    async sendFile(input): Promise<void> {
      const channel = await fetchSendable(input.target.target);
      await channel.send({
        content: input.description,
        files: [{
          attachment: input.path,
          name: input.name,
          description: input.description,
        }],
      });
    },
  };
}
