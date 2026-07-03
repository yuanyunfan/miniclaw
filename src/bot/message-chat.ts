import type { Message } from "discord.js";
import { chat, type ChatCallbacks } from "../agent/chat.js";
import { config } from "../config.js";
import { cleanupAttachmentScope, processAttachments } from "../discord/attachments.js";
import {
  buildTaskSourceFromMessage,
  resolveReplyParentContext,
} from "../discord/task-context.js";
import { getOrCreateMessageThread } from "../discord/message-thread.js";
import {
  createAndRunDiscordTask,
  formatTaskCompletionNotice,
} from "../discord/task-intake.js";
import { replyChunkedTextWithDeferredLinkPreviews } from "../discord/text.js";
import { createLogger } from "../lib/log.js";
import { parseExplicitMemory } from "../memory/parse.js";
import { buildChatRuntimeContext } from "../routing/chat-context.js";
import { classifySmartRoute, resolveSmartRouterAction } from "../routing/intent.js";
import { classifyRouteWithLlm } from "../routing/llm.js";
import { resolveTaskCwd } from "../routing/cwd.js";
import { addMemory } from "../store/memory.js";
import { updateSmartRouterDecision } from "../store/db.js";
import {
  askForTaskUpgrade,
  buildSmartTaskPromptForChannel,
  recordRouteDecisionForMessage,
} from "./message-smart-router.js";
import { stripBotMention } from "./message-task-channel.js";

const log = createLogger("bot");

export interface ChatMessageOptions {
  botUserId: string;
  markProcessed: (messageId: string) => boolean;
}

export function formatChatErrorReply(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/timeout|aborted/i.test(message)) {
    return `❌ chat 回复超时（${Math.round(config.chatTimeoutMs / 1000)}s）。这类日志/DB 排查或修复更适合用 task 模式。`;
  }
  const clean = message.replace(/\s+/g, " ").trim();
  return clean
    ? `❌ 回复出错: ${clean.slice(0, 300)}`
    : "❌ 回复出错，请稍后再试";
}

export async function handleChatMessage(
  message: Message,
  options: ChatMessageOptions
): Promise<void> {
  if (!options.markProcessed(message.id)) return;

  const content = stripBotMention(message.content, options.botUserId);

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
      const row = addMemory(explicitMemory.type, explicitMemory.name, explicitMemory.content, {
        source: "explicit_chat",
        ttl: "stable",
      });
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
          wasMentioned: message.mentions.has(options.botUserId),
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
                  wasMentioned: message.mentions.has(options.botUserId),
                }),
                ...(parentContext ? { parent: parentContext } : {}),
              },
              createThread: (name) => getOrCreateMessageThread(message, {
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
            await message.reactions.cache.get("👀")?.users.remove(options.botUserId).catch(() => {});
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
        wasMentioned: message.mentions.has(options.botUserId),
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
      await message.reactions.cache.get("👀")?.users.remove(options.botUserId).catch(() => {});
      await message.react("✅").catch(() => {});
    } catch (err) {
      if (typingInterval) clearInterval(typingInterval);
      log.error("Chat error:", err);
      await message.reactions.cache.get("👀")?.users.remove(options.botUserId).catch(() => {});
      await message.react("❌").catch(() => {});
      await message.reply(formatChatErrorReply(err));
    }
  } finally {
    if (attachmentScope) {
      cleanupAttachmentScope(attachmentScope);
    }
  }
}
