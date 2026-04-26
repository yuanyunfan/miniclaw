import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import { config } from "./config.js";
import { chat, type ChatCallbacks } from "./agent/chat.js";
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

  const processed = new Map<string, number>();

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (message.author.id !== config.allowedUserId) return;

    const isAutoChannel = config.autoReplyChannelIds.includes(message.channel.id);
    const isMentioned = message.mentions.has(client.user!);
    if (!isAutoChannel && !isMentioned) return;

    const now = Date.now();
    if (processed.has(message.id)) return;
    processed.set(message.id, now);
    if (processed.size > 500) {
      for (const [k, ts] of processed) {
        if (now - ts > 300_000) processed.delete(k);
      }
    }

    const content = message.content
      .replace(new RegExp(`<@!?${client.user!.id}>`, "g"), "")
      .trim();

    if (!content) {
      await message.reply("你好！有什么需要帮忙的？");
      return;
    }

    await message.react("👀").catch(() => {});

    const typingInterval = message.channel.isSendable()
      ? setInterval(() => { message.channel.isSendable() && message.channel.sendTyping().catch(() => {}); }, 8000)
      : null;
    if (message.channel.isSendable()) {
      await message.channel.sendTyping();
    }

    try {
      let stepMsg: Message | null = null;
      let steps: string[] = [];
      let lastStepUpdate = 0;
      let lastLine = "";

      const flushSteps = async () => {
        if (!steps.length) return;
        const text = steps.join("\n").slice(-1800);
        try {
          if (stepMsg) {
            await stepMsg.edit(text);
          } else {
            stepMsg = message.channel.isSendable() ? await message.channel.send(text) : null;
          }
        } catch { stepMsg = null; }
        lastStepUpdate = Date.now();
      };

      const callbacks: ChatCallbacks = {
        onToolUse: (display) => {
          if (display === lastLine) return;
          lastLine = display;
          steps.push(display);
          if (Date.now() - lastStepUpdate > 600) {
            flushSteps();
          }
        },
        onText: (_text) => {},
      };

      const reply = await chat(message.channel.id, message.author.id, content, callbacks);
      if (typingInterval) clearInterval(typingInterval);
      await flushSteps();

      const chunks = chunkMessage(reply);
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
      await message.reactions.cache.get("👀")?.users.remove(client.user!.id).catch(() => {});
      await message.react("✅").catch(() => {});
    } catch (err) {
      if (typingInterval) clearInterval(typingInterval);
      console.error("[MiniClaw] Chat error:", err);
      await message.reactions.cache.get("👀")?.users.remove(client.user!.id).catch(() => {});
      await message.react("❌").catch(() => {});
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
