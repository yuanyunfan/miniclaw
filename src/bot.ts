import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import { config } from "./config.js";
import { chat } from "./agent/chat.js";
import { chunkMessage } from "./discord/chunks.js";
import { handleTask, handleStatus, handleCancel, handleResume } from "./commands/handlers.js";

export function createBot(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message],
  });

  const processed = new Set<string>();

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (message.author.id !== config.allowedUserId) return;
    if (!message.mentions.has(client.user!)) return;
    if (processed.has(message.id)) return;
    processed.add(message.id);
    if (processed.size > 1000) {
      const first = processed.values().next().value!;
      processed.delete(first);
    }

    const content = message.content
      .replace(new RegExp(`<@!?${client.user!.id}>`, "g"), "")
      .trim();

    if (!content) {
      await message.reply("你好！有什么需要帮忙的？");
      return;
    }

    if ("sendTyping" in message.channel) {
      await message.channel.sendTyping();
    }

    try {
      const reply = await chat(message.channel.id, message.author.id, content);
      const chunks = chunkMessage(reply);
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } catch (err) {
      console.error("[MiniClaw] Chat error:", err);
      await message.reply("❌ 回复出错，请稍后再试");
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction as ChatInputCommandInteraction;

    try {
      switch (cmd.commandName) {
        case "task":
          await handleTask(cmd);
          break;
        case "status":
          await handleStatus(cmd);
          break;
        case "cancel":
          await handleCancel(cmd);
          break;
        case "resume":
          await handleResume(cmd);
          break;
        default:
          await cmd.reply({ content: "未知命令", ephemeral: true });
      }
    } catch (err) {
      console.error("[MiniClaw] Command error:", err);
      const reply = { content: "❌ 命令执行出错", ephemeral: true };
      if (cmd.deferred || cmd.replied) {
        await cmd.editReply(reply.content);
      } else {
        await cmd.reply(reply);
      }
    }
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[MiniClaw] Logged in as ${c.user.tag}`);
  });

  return client;
}
