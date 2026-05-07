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
import { handleTask, handleStatus, handleHealth, handleAgentConfig, handleCancel, handleResume, handleRemember, handleForget, handleMemories } from "./commands/handlers.js";
import { executeTask, getActiveTaskCount } from "./agent/task.js";
import { recoverInterruptedTasks } from "./agent/recovery.js";
import { createTask, getTaskByThreadId } from "./store/db.js";
import { v4 as uuid } from "uuid";
import { parseExplicitMemory } from "./memory/parse.js";
import { addMemory } from "./store/memory.js";
import { cleanupAttachmentScope, processAttachments } from "./discord/attachments.js";
import { createLogger } from "./lib/log.js";
import { assertProviderSession } from "./agent/session.js";
import { taskStartEmbed } from "./discord/formatter.js";

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

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (message.author.id !== config.allowedUserId) return;

    // Thread continuation: 仅当消息发在 /task 创建过的真正 Discord thread 里才自动 resume
    // （防 cron 在普通 channel 跑过留下 discord_thread_id 记录被误命中）
    const isInThread = "isThread" in message.channel && message.channel.isThread();
    const continuableTask = isInThread ? getTaskByThreadId(message.channel.id) : undefined;
    if (continuableTask && continuableTask.session_id && continuableTask.discord_user_id !== "cron") {
      try {
        assertProviderSession(continuableTask.session_id, config.agentProvider);
      } catch (err) {
        await message.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (processed.has(message.id)) return;
      processed.set(message.id, Date.now());
      const followupContent = message.content.trim();
      const followupAtts = Array.from(message.attachments.values());
      if (!followupContent && !followupAtts.length) return;

      if (getActiveTaskCount() >= config.maxConcurrentTasks) {
        await message.reply(`⚠️ 已达并发上限 (${config.maxConcurrentTasks})，请等待现有任务完成`);
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

      await message.react("🔄").catch(() => {});
      if (message.channel.isSendable()) {
        createTask({
          id: newTaskId,
          discord_thread_id: message.channel.id,
          discord_user_id: message.author.id,
          prompt: effectivePrompt,
          cwd: continuableTask.cwd ?? config.defaultCwd,
        });
        executeTask({
          taskId: newTaskId,
          prompt: effectivePrompt,
          cwd: continuableTask.cwd ?? config.defaultCwd,
          channel: message.channel,
          resumeSessionId: continuableTask.session_id,
          attachmentBlocks: followupBlocks,
          attachmentCodexInputs: followupCodexInputs,
        }).catch((e) => {
          if (message.channel.isSendable()) {
            void message.channel.send(`❌ resume error: ${e?.message ?? e}`);
          }
        });
      }
      return;
    }

    const isTaskChannel = config.taskChannelIds.includes(message.channel.id);
    if (isTaskChannel) {
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
      const atts = Array.from(message.attachments.values());
      if (!content && !atts.length) {
        await message.reply("请直接发送任务描述，或附上文件后说明要 MiniClaw 做什么。");
        return;
      }

      if (getActiveTaskCount() >= config.maxConcurrentTasks) {
        await message.reply(`⚠️ 已达并发上限 (${config.maxConcurrentTasks})，请等待现有任务完成`);
        return;
      }

      if (!("threads" in message.channel)) {
        await message.reply("❌ 当前频道不支持创建任务线程");
        return;
      }

      const taskId = uuid();
      const cwd = config.defaultCwd;
      const effectivePrompt = content || "请处理这些附件";
      const threadName = `🤖 ${effectivePrompt.replace(/\s+/g, " ").slice(0, 90)}`;

      let attachmentBlocks: Awaited<ReturnType<typeof processAttachments>>["blocks"] = [];
      let attachmentCodexInputs: Awaited<ReturnType<typeof processAttachments>>["codexInputs"] = [];
      let attachmentNotices: string[] = [];

      await message.react("👀").catch(() => {});
      try {
        if (atts.length) {
          const r = await processAttachments(atts, { cwd, scope: taskId });
          attachmentBlocks = r.blocks;
          attachmentCodexInputs = r.codexInputs;
          attachmentNotices = r.notices;
        }

        const thread = await message.startThread({
          name: threadName,
          autoArchiveDuration: 1440,
        });

        createTask({
          id: taskId,
          discord_thread_id: thread.id,
          discord_user_id: message.author.id,
          prompt: effectivePrompt,
          cwd,
        });

        await message.reply(`✅ 任务已创建，请查看线程 <#${thread.id}>`);
        const statusMessage = await thread.send({
          embeds: [taskStartEmbed(taskId, effectivePrompt, cwd, {
            provider: config.agentProvider,
            model: config.model,
          })],
        });
        for (const n of attachmentNotices) {
          await thread.send(n).catch(() => {});
        }

        executeTask({
          taskId,
          prompt: effectivePrompt,
          cwd,
          channel: thread,
          attachmentBlocks,
          attachmentCodexInputs,
          statusMessage,
        }).catch((err) => {
          log.error(`Task ${taskId} error:`, err);
          void thread.send(`❌ task error: ${err?.message ?? err}`).catch(() => {});
        });
      } catch (err) {
        log.error("Task channel message failed:", err);
        await message.reactions.cache.get("👀")?.users.remove(client.user!.id).catch(() => {});
        await message.react("❌").catch(() => {});
        await message.reply(`❌ 创建任务失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

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

    const atts = Array.from(message.attachments.values());
    let attachmentBlocks: Awaited<ReturnType<typeof processAttachments>>["blocks"] = [];
    let attachmentCodexInputs: Awaited<ReturnType<typeof processAttachments>>["codexInputs"] = [];
    const attachmentScope = atts.length ? { scope: message.id } : null;

    try {
      if (atts.length && attachmentScope) {
        const r = await processAttachments(atts, attachmentScope);
        attachmentBlocks = r.blocks;
        attachmentCodexInputs = r.codexInputs;
        for (const n of r.notices) {
          if (message.channel.isSendable()) await message.channel.send(n).catch(() => {});
        }
      }

      if (!content && !attachmentBlocks.length) {
        await message.reply("你好！有什么需要帮忙的？");
        return;
      }
      const effectivePrompt = content || "请分析这些附件";

      const explicitMemory = parseExplicitMemory(content);
      if (explicitMemory) {
        const row = addMemory(explicitMemory.type, explicitMemory.name, explicitMemory.content);
        await message.reply(`✅ 已记住: **${row.name}** (ID: ${row.id})`);
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

        const reply = await chat(message.channel.id, message.author.id, effectivePrompt, attachmentBlocks, callbacks, attachmentCodexInputs);
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
        log.error("Chat error:", err);
        await message.reactions.cache.get("👀")?.users.remove(client.user!.id).catch(() => {});
        await message.react("❌").catch(() => {});
        await message.reply("❌ 回复出错，请稍后再试");
      }
    } finally {
      if (attachmentScope) {
        cleanupAttachmentScope(attachmentScope);
      }
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
        case "health":
          await handleHealth(cmd);
          break;
        case "agent-config":
          await handleAgentConfig(cmd);
          break;
        case "cancel":
          await handleCancel(cmd);
          break;
        case "resume":
          await handleResume(cmd);
          break;
        case "remember":
          await handleRemember(cmd);
          break;
        case "forget":
          await handleForget(cmd);
          break;
        case "memories":
          await handleMemories(cmd);
          break;
        default:
          await cmd.reply({ content: "未知命令", ephemeral: true });
      }
    } catch (err) {
      log.error("Command error:", err);
      const reply = { content: "❌ 命令执行出错", ephemeral: true };
      try {
        if (cmd.deferred || cmd.replied) {
          await cmd.editReply(reply.content);
        } else {
          await cmd.reply(reply);
        }
      } catch (replyErr) {
        log.error("Failed to send error reply:", replyErr);
      }
    }
  });

  client.once(Events.ClientReady, (c) => {
    log.info(`Logged in as ${c.user.tag}`);
    void recoverInterruptedTasks(c);
  });

  return client;
}
