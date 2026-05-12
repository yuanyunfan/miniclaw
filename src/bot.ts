import "./proxy.js";
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import { config } from "./config.js";
import { chat, type ChatCallbacks } from "./agent/chat.js";
import { TaskReporter } from "./agent/task-reporter.js";
import {
  replyChunkedTextWithDeferredLinkPreviews,
} from "./discord/text.js";
import { executeTask } from "./agent/task.js";
import { recoverInterruptedTasks } from "./agent/recovery.js";
import {
  createTask,
  getTaskByThreadId,
  updateSmartRouterDecision,
} from "./store/db.js";
import { v4 as uuid } from "uuid";
import { parseExplicitMemory } from "./memory/parse.js";
import { addMemory } from "./store/memory.js";
import { cleanupAttachmentScope, processAttachments } from "./discord/attachments.js";
import { createLogger } from "./lib/log.js";
import { assertProviderSession } from "./agent/session.js";
import { createAndRunDiscordTask, formatTaskCompletionNotice, taskCapacityError } from "./discord/task-intake.js";
import {
  buildTaskSourceFromMessage,
  resolveReplyParentContext,
  withTaskThreadMetadata,
} from "./discord/task-context.js";
import { resolveTaskCwd } from "./routing/cwd.js";
import { resolveDiscordMessageRoute } from "./routing/message-route.js";
import { buildChatRuntimeContext } from "./routing/chat-context.js";
import { buildTaskPromptWithContext } from "./routing/task-context.js";
import { classifySmartRoute, resolveSmartRouterAction } from "./routing/intent.js";
import { classifyRouteWithLlm } from "./routing/llm.js";
import { isAllowedDiscordMessageAuthor } from "./e2e/safety.js";
import {
  askForTaskUpgrade,
  buildSmartTaskPromptForChannel,
  recordRouteDecisionForMessage,
} from "./bot/message-smart-router.js";
import { dispatchButtonInteraction } from "./bot/button-dispatch.js";
import { dispatchSlashCommand } from "./bot/slash-dispatch.js";
import { DRAINING_MESSAGE, isDraining } from "./runtime/shutdown.js";

const log = createLogger("bot");

function formatChatErrorReply(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/timeout|aborted/i.test(message)) {
    return `❌ chat 回复超时（${Math.round(config.chatTimeoutMs / 1000)}s）。这类日志/DB 排查或修复更适合用 task 模式。`;
  }
  const clean = message.replace(/\s+/g, " ").trim();
  return clean
    ? `❌ 回复出错: ${clean.slice(0, 300)}`
    : "❌ 回复出错，请稍后再试";
}

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
          wasMentioned: message.mentions.has(client.user!),
        }),
        {
          id: message.channel.id,
          name: "name" in message.channel && typeof message.channel.name === "string" ? message.channel.name : "",
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
          resume_session_id: continuableTask.session_id,
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

    if (route === "task_channel") {
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

      const capacity = taskCapacityError();
      if (capacity) {
        await message.reply(capacity);
        return;
      }

      const cwd = resolveTaskCwd(message.channel.id);
      const effectivePrompt = content || "请处理这些附件";
      const parentContext = await resolveReplyParentContext(message);

      await message.react("👀").catch(() => {});
      try {
        await createAndRunDiscordTask({
          prompt: effectivePrompt,
          cwd,
          userId: message.author.id,
          attachments: atts,
          taskContext: {
            source: buildTaskSourceFromMessage(message, "task_channel", {
              cwd,
              wasMentioned: message.mentions.has(client.user!),
            }),
            ...(parentContext ? { parent: parentContext } : {}),
          },
          createThread: (name) => message.startThread({
            name,
            autoArchiveDuration: 1440,
          }),
          onCreated: async (result) => {
            await message.reply(`✅ 任务已创建，请查看线程 <#${result.threadId}>`);
          },
          onCompleted: async (result, taskResult) => {
            await message.reply(formatTaskCompletionNotice(result, taskResult));
          },
        });
      } catch (err) {
        log.error("Task channel message failed:", err);
        await message.reactions.cache.get("👀")?.users.remove(client.user!.id).catch(() => {});
        await message.react("❌").catch(() => {});
        await message.reply(`❌ 创建任务失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

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
      if (!content && !atts.length) {
        await message.reply("你好！有什么需要帮忙的？");
        return;
      }
      const effectivePrompt = content || "请分析这些附件";
      const taskPrompt = content || "请处理这些附件";

      const explicitMemory = parseExplicitMemory(content);
      if (explicitMemory) {
        const row = addMemory(explicitMemory.type, explicitMemory.name, explicitMemory.content);
        await message.reply(`✅ 已记住: **${row.name}** (ID: ${row.id})`);
        return;
      }

      if (config.smartRouter.enabled) {
        try {
          const routed = await classifySmartRoute(
            {
              content: taskPrompt,
              channelId: message.channel.id,
              hasAttachments: atts.length > 0,
            },
            config.smartRouter,
            classifyRouteWithLlm
          );
          const decision = resolveSmartRouterAction(routed, config.smartRouter, message.channel.id, {
            wasMentioned: message.mentions.has(client.user!),
          });
          log.info(
            `route decision ch=${message.channel.id.slice(-6)} intent=${decision.intent} ` +
            `confidence=${decision.confidence} evidence=${decision.matchedSignals.join(",") || "none"}`
          );

          if (decision.intent === "task_auto") {
            const cwd = resolveTaskCwd(message.channel.id);
            const decisionLogId = recordRouteDecisionForMessage(message, taskPrompt, decision, "auto_task_start");
            await message.reply("已识别为 task，正在创建任务线程...");
            await message.react("👀").catch(() => {});
            try {
              const executionPrompt = buildSmartTaskPromptForChannel(message.channel.id, taskPrompt);
              const parentContext = await resolveReplyParentContext(message);
              const result = await createAndRunDiscordTask({
                prompt: executionPrompt,
                displayPrompt: taskPrompt,
                cwd,
                userId: message.author.id,
                attachments: atts,
                taskContext: {
                  source: buildTaskSourceFromMessage(message, "smart_router_auto", {
                    cwd,
                    wasMentioned: message.mentions.has(client.user!),
                  }),
                  ...(parentContext ? { parent: parentContext } : {}),
                },
                createThread: (name) => message.startThread({
                  name,
                  autoArchiveDuration: 1440,
                }),
                onCreated: async (created) => {
                  await message.reply(`✅ 任务已创建，请查看线程 <#${created.threadId}>`);
                },
                onCompleted: async (created, taskResult) => {
                  await message.reply(formatTaskCompletionNotice(created, taskResult));
                },
              });
              if (decisionLogId !== undefined) {
                updateSmartRouterDecision(decisionLogId, {
                  action_result: "auto_task_created",
                  created_task_id: result.taskId,
                });
              }
            } catch (err) {
              if (decisionLogId !== undefined) {
                updateSmartRouterDecision(decisionLogId, {
                  action_result: "auto_task_failed",
                  final_route: "none",
                  task_final_status: "not_created",
                  correction_type: "none",
                  correction_note: "auto task creation failed before execution",
                  resolved_at: new Date().toISOString(),
                });
              }
              log.error("Auto task creation failed:", err);
              await message.reactions.cache.get("👀")?.users.remove(client.user!.id).catch(() => {});
              await message.react("❌").catch(() => {});
              await message.reply(`❌ 创建任务失败: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
          }

          if (decision.intent === "task_suggest" || decision.intent === "task_confirm") {
            const cwd = resolveTaskCwd(message.channel.id);
            await askForTaskUpgrade(message, decision, taskPrompt, cwd, atts);
            return;
          }

          recordRouteDecisionForMessage(message, effectivePrompt, decision, "chat");
        } catch (err) {
          log.error("Smart router failed; falling back to chat:", err);
        }
      }

      if (atts.length && attachmentScope) {
        const r = await processAttachments(atts, attachmentScope);
        attachmentBlocks = r.blocks;
        attachmentCodexInputs = r.codexInputs;
        for (const n of r.notices) {
          if (message.channel.isSendable()) await message.channel.send(n).catch(() => {});
        }
      }

      await message.react("👀").catch(() => {});
      const chatCwd = resolveTaskCwd(message.channel.id);
      const chatParentContext = await resolveReplyParentContext(message);
      const chatRuntimeContext = buildChatRuntimeContext({
        source: buildTaskSourceFromMessage(message, "chat_message", {
          cwd: chatCwd,
          wasMentioned: message.mentions.has(client.user!),
        }),
        ...(chatParentContext ? { parent: chatParentContext } : {}),
      });

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
              void flushSteps();
            }
          },
          onText: (_text) => {},
        };

        const reply = await chat(
          message.channel.id,
          message.author.id,
          effectivePrompt,
          attachmentBlocks,
          callbacks,
          attachmentCodexInputs,
          chatRuntimeContext
        );
        if (typingInterval) clearInterval(typingInterval);
        await flushSteps();

        await replyChunkedTextWithDeferredLinkPreviews(message, reply);
        await message.reactions.cache.get("👀")?.users.remove(client.user!.id).catch(() => {});
        await message.react("✅").catch(() => {});
      } catch (err) {
        if (typingInterval) clearInterval(typingInterval);
        log.error("Chat error:", err);
        await message.reactions.cache.get("👀")?.users.remove(client.user!.id).catch(() => {});
        await message.react("❌").catch(() => {});
        await message.reply(formatChatErrorReply(err));
      }
    } finally {
      if (attachmentScope) {
        cleanupAttachmentScope(attachmentScope);
      }
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      const handled = await dispatchButtonInteraction(interaction);
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
