import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Attachment,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import { config } from "./config.js";
import { chat, type ChatCallbacks } from "./agent/chat.js";
import { chunkMessage } from "./discord/chunks.js";
import { handleTask, handleStatus, handleHealth, handleAgentConfig, handleCancel, handleResume, handleRemember, handleForget, handleMemories } from "./commands/handlers.js";
import { executeTask, getActiveTaskCount } from "./agent/task.js";
import { recoverInterruptedTasks } from "./agent/recovery.js";
import { createTask, getChatHistory, getTaskByThreadId, recordSmartRouterDecision, updateSmartRouterDecision } from "./store/db.js";
import { v4 as uuid } from "uuid";
import { parseExplicitMemory } from "./memory/parse.js";
import { addMemory } from "./store/memory.js";
import { cleanupAttachmentScope, processAttachments } from "./discord/attachments.js";
import { createLogger } from "./lib/log.js";
import { assertProviderSession } from "./agent/session.js";
import { createAndRunDiscordTask, taskCapacityError } from "./discord/task-intake.js";
import { buildSmartTaskPrompt } from "./routing/context.js";
import { resolveTaskCwd } from "./routing/cwd.js";
import { resolveDiscordMessageRoute } from "./routing/message-route.js";
import { hashPrompt, promptPreview } from "./routing/decision-log.js";
import { classifySmartRoute, resolveSmartRouterAction, type RouteDecision } from "./routing/intent.js";
import { classifyRouteWithLlm } from "./routing/llm.js";
import { isAllowedDiscordMessageAuthor } from "./e2e/safety.js";
import { handleCronRetryButton } from "./cron/retry-interactions.js";
import {
  buildSmartRouterCustomId,
  consumePendingConfirmation,
  createPendingConfirmation,
  parseSmartRouterCustomId,
  type ConfirmationAction,
  type PendingTaskConfirmation,
} from "./routing/confirmations.js";

const log = createLogger("bot");

function recordRouteDecisionForMessage(
  message: Message,
  prompt: string,
  decision: RouteDecision,
  actionResult: string,
  createdTaskId?: string
): number | undefined {
  if (!config.smartRouter.decisionLog.enabled) return undefined;
  try {
    return recordSmartRouterDecision({
      message_id: message.id,
      channel_id: message.channel.id,
      user_id: message.author.id,
      prompt_hash: hashPrompt(prompt),
      prompt_preview: promptPreview(prompt, config.smartRouter.decisionLog.promptPreviewChars),
      ...(config.smartRouter.decisionLog.storeFullPrompt ? { full_prompt: prompt } : {}),
      intent: decision.intent,
      confidence: decision.confidence,
      reason: decision.reason,
      matched_signals: decision.matchedSignals,
      risk_flags: decision.riskFlags,
      action_result: actionResult,
      ...(createdTaskId ? { created_task_id: createdTaskId } : {}),
    });
  } catch (err) {
    log.error("Failed to record smart-router decision:", err);
    return undefined;
  }
}

function buildSmartTaskPromptForChannel(channelId: string, prompt: string): string {
  const rows = getChatHistory(channelId, config.smartRouter.context.recentTurns * 2).reverse();
  return buildSmartTaskPrompt(prompt, rows, config.smartRouter.context);
}

function buttonLabel(action: ConfirmationAction): string {
  if (action === "task") return "转为 task";
  if (action === "chat") return "继续 chat";
  return "取消";
}

function confirmationComponents(id: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildSmartRouterCustomId("task", id))
        .setLabel(buttonLabel("task"))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(buildSmartRouterCustomId("chat", id))
        .setLabel(buttonLabel("chat"))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buildSmartRouterCustomId("cancel", id))
        .setLabel(buttonLabel("cancel"))
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function routerPromptText(decision: RouteDecision, prompt: string): string {
  const preview = promptPreview(prompt, 500) || "(仅附件)";
  const headline = decision.intent === "task_suggest"
    ? "这个请求可能更适合 task 模式。"
    : "这个请求需要 task 模式执行，因为它可能修改文件或运行命令。";
  return [
    headline,
    "",
    `原因：${decision.reason}`,
    "",
    "Task preview:",
    "```text",
    preview,
    "```",
  ].join("\n");
}

async function askForTaskUpgrade(
  message: Message,
  decision: RouteDecision,
  prompt: string,
  cwd: string,
  attachments: Attachment[]
): Promise<void> {
  const logId = recordRouteDecisionForMessage(message, prompt, decision, "confirmation_pending");
  const pending = createPendingConfirmation({
    userId: message.author.id,
    channelId: message.channel.id,
    messageId: message.id,
    prompt,
    cwd,
    attachments,
    decision,
    ...(logId !== undefined ? { decisionLogId: logId } : {}),
    ttlMs: config.smartRouter.confirmation.timeoutSeconds * 1000,
  });
  await message.reply({
    content: routerPromptText(decision, prompt),
    components: confirmationComponents(pending.id),
  });
}

async function continueChatFromConfirmation(
  interaction: ButtonInteraction,
  confirmation: PendingTaskConfirmation
): Promise<void> {
  const channel = interaction.channel;
  if (!channel?.isSendable()) {
    await interaction.followUp({ content: "❌ 当前频道不支持发送 chat 回复", ephemeral: true });
    return;
  }

  let attachmentBlocks: Awaited<ReturnType<typeof processAttachments>>["blocks"] = [];
  let attachmentCodexInputs: Awaited<ReturnType<typeof processAttachments>>["codexInputs"] = [];
  const attachmentScope = confirmation.attachments.length ? { scope: `smart-chat-${confirmation.id}` } : null;

  try {
    if (attachmentScope) {
      const processed = await processAttachments(confirmation.attachments, attachmentScope);
      attachmentBlocks = processed.blocks;
      attachmentCodexInputs = processed.codexInputs;
      for (const notice of processed.notices) {
        await channel.send(notice).catch(() => {});
      }
    }
    await channel.sendTyping().catch(() => {});
    const reply = await chat(
      confirmation.channelId,
      confirmation.userId,
      confirmation.prompt,
      attachmentBlocks,
      undefined,
      attachmentCodexInputs
    );
    for (const chunk of chunkMessage(reply)) {
      await channel.send(chunk);
    }
  } finally {
    if (attachmentScope) cleanupAttachmentScope(attachmentScope);
  }
}

async function handleSmartRouterButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseSmartRouterCustomId(interaction.customId);
  if (!parsed) return false;

  if (interaction.user.id !== config.allowedUserId) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return true;
  }

  const consumed = consumePendingConfirmation(parsed.id, parsed.action, interaction.user.id);
  if (!consumed.ok) {
    const msg = consumed.reason === "unauthorized"
      ? "⛔ 只有原始请求用户可以操作这个确认。"
      : consumed.reason === "expired" || consumed.reason === "missing"
        ? "确认已过期，请重新发送请求。"
        : "这个确认已经被处理。";
    await interaction.reply({ content: msg, ephemeral: true });
    return true;
  }

  const confirmation = consumed.confirmation;
  const updateDecision = (actionResult: string, taskId?: string) => {
    if (confirmation.decisionLogId === undefined) return;
    updateSmartRouterDecision(confirmation.decisionLogId, {
      action_result: actionResult,
      ...(taskId ? { created_task_id: taskId } : {}),
    });
  };

  if (parsed.action === "cancel") {
    updateDecision("cancelled");
    await interaction.update({ content: "已取消 task 升级。", components: [] });
    return true;
  }

  if (parsed.action === "chat") {
    updateDecision("continued_chat");
    await interaction.update({ content: "已选择继续 chat，正在回复...", components: [] });
    try {
      await continueChatFromConfirmation(interaction, confirmation);
    } catch (err) {
      log.error("Continue-chat confirmation failed:", err);
      await interaction.followUp({ content: `❌ chat 回复失败: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
    }
    return true;
  }

  await interaction.update({ content: "已确认，正在创建 task 线程...", components: [] });
  try {
    const taskPrompt = buildSmartTaskPromptForChannel(confirmation.channelId, confirmation.prompt);
    const result = await createAndRunDiscordTask({
      prompt: taskPrompt,
      displayPrompt: confirmation.displayPrompt,
      cwd: confirmation.cwd,
      userId: confirmation.userId,
      attachments: confirmation.attachments,
      createThread: (name) => interaction.message.startThread({
        name,
        autoArchiveDuration: 1440,
      }),
      onCreated: async (created) => {
        await interaction.followUp(`✅ 任务已创建，请查看线程 <#${created.threadId}>`);
      },
    });
    updateDecision("confirmed_task_created", result.taskId);
  } catch (err) {
    updateDecision("task_creation_failed");
    log.error("Confirmed task creation failed:", err);
    await interaction.followUp({ content: `❌ 创建任务失败: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
  }
  return true;
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

      await message.react("👀").catch(() => {});
      try {
        await createAndRunDiscordTask({
          prompt: effectivePrompt,
          cwd,
          userId: message.author.id,
          attachments: atts,
          createThread: (name) => message.startThread({
            name,
            autoArchiveDuration: 1440,
          }),
          onCreated: async (result) => {
            await message.reply(`✅ 任务已创建，请查看线程 <#${result.threadId}>`);
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
          const heuristicOrLlm = await classifySmartRoute(
            {
              content: taskPrompt,
              channelId: message.channel.id,
              hasAttachments: atts.length > 0,
            },
            config.smartRouter,
            classifyRouteWithLlm
          );
          const decision = resolveSmartRouterAction(heuristicOrLlm, config.smartRouter, message.channel.id);
          log.info(
            `route decision ch=${message.channel.id.slice(-6)} intent=${decision.intent} ` +
            `confidence=${decision.confidence} signals=${decision.matchedSignals.join(",") || "none"}`
          );

          if (decision.intent === "task_auto") {
            const cwd = resolveTaskCwd(message.channel.id);
            const decisionLogId = recordRouteDecisionForMessage(message, taskPrompt, decision, "auto_task_start");
            await message.reply("已识别为 task，正在创建任务线程...");
            await message.react("👀").catch(() => {});
            try {
              const executionPrompt = buildSmartTaskPromptForChannel(message.channel.id, taskPrompt);
              const result = await createAndRunDiscordTask({
                prompt: executionPrompt,
                displayPrompt: taskPrompt,
                cwd,
                userId: message.author.id,
                attachments: atts,
                createThread: (name) => message.startThread({
                  name,
                  autoArchiveDuration: 1440,
                }),
                onCreated: async (created) => {
                  await message.reply(`✅ 任务已创建，请查看线程 <#${created.threadId}>`);
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
                updateSmartRouterDecision(decisionLogId, { action_result: "auto_task_failed" });
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
    if (interaction.isButton()) {
      try {
        const cronRetryHandled = await handleCronRetryButton(interaction);
        if (cronRetryHandled) return;
        const handled = await handleSmartRouterButton(interaction);
        if (handled) return;
      } catch (err) {
        log.error("Button interaction error:", err);
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: "❌ 按钮处理出错", ephemeral: true });
          } else {
            await interaction.reply({ content: "❌ 按钮处理出错", ephemeral: true });
          }
        } catch (replyErr) {
          log.error("Failed to send button error reply:", replyErr);
        }
        return;
      }
    }

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
