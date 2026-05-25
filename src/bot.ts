import "./proxy.js";
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import { config } from "./config.js";
import { recoverInterruptedTasks } from "./agent/recovery.js";
import { getTaskByThreadId } from "./store/db.js";
import { createLogger } from "./lib/log.js";
import { resolveDiscordMessageRoute } from "./routing/message-route.js";
import { isAllowedDiscordMessageAuthor } from "./e2e/safety.js";
import { dispatchButtonInteraction } from "./bot/button-dispatch.js";
import { dispatchSlashCommand } from "./bot/slash-dispatch.js";
import { handleCliSessionModal } from "./bot/cli-session-modals.js";
import { handleChatMessage } from "./bot/message-chat.js";
import { handleTaskChannelMessage } from "./bot/message-task-channel.js";
import { handleThreadContinuationMessage } from "./bot/message-thread-continuation.js";
import { DRAINING_MESSAGE, isDraining } from "./runtime/shutdown.js";

const log = createLogger("bot");

export function createBot(): Client {
  const client = new Client({
    allowedMentions: {
      parse: [],
      repliedUser: false,
    },
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message],
  });

  const processed = new Map<string, number>();

  const markProcessed = (messageId: string): boolean => {
    const now = Date.now();
    if (processed.has(messageId)) return false;
    processed.set(messageId, now);
    if (processed.size > 500) {
      for (const [k, ts] of processed) {
        if (now - ts > 300_000) processed.delete(k);
      }
    }
    return true;
  };

  client.on(Events.MessageCreate, async (message: Message) => {
    // Thread continuation: 仅当消息发在 /task 创建过的真正 Discord thread 里才自动 resume
    // （防 cron 在普通 channel 跑过留下 discord_thread_id 记录被误命中）
    const isInThread = "isThread" in message.channel && message.channel.isThread();
    const continuableTask = isInThread ? getTaskByThreadId(message.channel.id) : undefined;
    const hasContinuableTask = Boolean(continuableTask?.session_id && continuableTask.discord_user_id !== "cron");
    const route = resolveDiscordMessageRoute({
      authorAllowed: isAllowedDiscordMessageAuthor(message.author.id, message.author.bot),
      isThread: isInThread,
      hasContinuableTask,
      channelId: message.channel.id,
      taskChannelIds: config.taskChannelIds,
      autoReplyChannelIds: config.autoReplyChannelIds,
      isMentioned: message.mentions.has(client.user!),
    });

    if (route === "ignore") return;

    if (isDraining()) {
      if (!markProcessed(message.id)) return;
      await message.reply(DRAINING_MESSAGE).catch((err) => {
        log.error("Failed to send draining reply:", err);
      });
      return;
    }

    if (route === "thread_continuation" && continuableTask?.session_id) {
      await handleThreadContinuationMessage(message, continuableTask, {
        botUserId: client.user!.id,
        markProcessed,
      });
      return;
    }

    if (route === "task_channel") {
      await handleTaskChannelMessage(message, {
        botUserId: client.user!.id,
        markProcessed,
      });
      return;
    }

    await handleChatMessage(message, {
      botUserId: client.user!.id,
      markProcessed,
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      const handled = await dispatchButtonInteraction(interaction);
      if (handled) return;
    }

    if (interaction.isModalSubmit()) {
      const handled = await handleCliSessionModal(interaction);
      if (handled) return;
    }
    if (!interaction.isChatInputCommand()) return;
    await dispatchSlashCommand(interaction);
  });

  client.once(Events.ClientReady, (c) => {
    log.info(`Logged in as ${c.user.tag}`);
    void recoverInterruptedTasks(c);
  });

  return client;
}
