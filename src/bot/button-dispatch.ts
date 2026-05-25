import type { ButtonInteraction } from "discord.js";
import { chat } from "../agent/chat.js";
import { config } from "../config.js";
import { handleCronRetryButton } from "../cron/retry-interactions.js";
import { handleCliSessionButton } from "./cli-session-buttons.js";
import { cleanupAttachmentScope, processAttachments } from "../discord/attachments.js";
import {
  createAndRunDiscordTask,
  formatTaskCompletionNotice,
} from "../discord/task-intake.js";
import { sendChunkedTextWithDeferredLinkPreviews } from "../discord/text.js";
import { createLogger } from "../lib/log.js";
import { buildChatRuntimeContext } from "../routing/chat-context.js";
import {
  consumePendingConfirmation,
  getPendingConfirmation,
  parseSmartRouterCustomId,
  type PendingTaskConfirmation,
} from "../routing/confirmations.js";
import { recordSmartRouterUserChoice } from "../store/db.js";
import { buildSmartTaskPromptForChannel } from "./message-smart-router.js";

const log = createLogger("bot");

export interface ButtonDispatchDependencies {
  handleCronRetryButton: (interaction: ButtonInteraction) => Promise<boolean>;
  handleCliSessionButton: (interaction: ButtonInteraction) => Promise<boolean>;
  handleSmartRouterButton: (interaction: ButtonInteraction) => Promise<boolean>;
  logError: (message: string, err: unknown) => void;
}

const defaultButtonDispatchDependencies: ButtonDispatchDependencies = {
  handleCronRetryButton,
  handleCliSessionButton,
  handleSmartRouterButton,
  logError: (message, err) => log.error(message, err),
};

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
      attachmentCodexInputs,
      buildChatRuntimeContext(confirmation.taskContext)
    );
    await sendChunkedTextWithDeferredLinkPreviews(channel, reply);
  } finally {
    if (attachmentScope) cleanupAttachmentScope(attachmentScope);
  }
}

export async function handleSmartRouterButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseSmartRouterCustomId(interaction.customId);
  if (!parsed) return false;

  if (interaction.user.id !== config.allowedUserId) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return true;
  }

  const pending = getPendingConfirmation(parsed.id);
  if (pending?.status === "expired") {
    if (pending.decisionLogId !== undefined) {
      recordSmartRouterUserChoice(pending.decisionLogId, "ignored", "none", {
        action_result: "confirmation_expired",
        task_final_status: "not_created",
        correction_type: "none",
        correction_note: "confirmation expired before user choice",
      });
    }
    await interaction.reply({ content: "确认已过期，请重新发送请求。", ephemeral: true });
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

  if (parsed.action === "cancel") {
    if (confirmation.decisionLogId !== undefined) {
      recordSmartRouterUserChoice(confirmation.decisionLogId, "cancelled", "none", {
        action_result: "cancelled",
        task_final_status: "not_created",
        correction_type: "user_override",
        correction_note: "user cancelled smart router confirmation",
      });
    }
    await interaction.update({ content: "已取消 task 升级。", components: [] });
    return true;
  }

  if (parsed.action === "chat") {
    if (confirmation.decisionLogId !== undefined) {
      recordSmartRouterUserChoice(confirmation.decisionLogId, "continued_chat", "chat", {
        action_result: "continued_chat",
        task_final_status: "not_created",
        correction_type: "user_override",
        correction_note: "user chose chat from smart router confirmation",
      });
    }
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
      taskContext: confirmation.taskContext,
      createThread: (name) => interaction.message.startThread({
        name,
        autoArchiveDuration: 1440,
      }),
      onCreated: async (created) => {
        await interaction.followUp(`✅ 任务已创建，请查看线程 <#${created.threadId}>`);
      },
      onCompleted: async (created, taskResult) => {
        await interaction.message.reply(formatTaskCompletionNotice(created, taskResult));
      },
    });
    if (confirmation.decisionLogId !== undefined) {
      recordSmartRouterUserChoice(confirmation.decisionLogId, "accepted_task", "task", {
        action_result: "confirmed_task_created",
        created_task_id: result.taskId,
      });
    }
  } catch (err) {
    if (confirmation.decisionLogId !== undefined) {
      recordSmartRouterUserChoice(confirmation.decisionLogId, "accepted_task", "none", {
        action_result: "task_creation_failed",
        task_final_status: "not_created",
        correction_type: "none",
        correction_note: "task creation failed before execution",
      });
    }
    log.error("Confirmed task creation failed:", err);
    await interaction.followUp({ content: `❌ 创建任务失败: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
  }
  return true;
}

export async function dispatchButtonInteraction(
  interaction: ButtonInteraction,
  dependencies: ButtonDispatchDependencies = defaultButtonDispatchDependencies
): Promise<boolean> {
  try {
    const cronRetryHandled = await dependencies.handleCronRetryButton(interaction);
    if (cronRetryHandled) return true;
    const cliSessionHandled = await dependencies.handleCliSessionButton(interaction);
    if (cliSessionHandled) return true;
    const handled = await dependencies.handleSmartRouterButton(interaction);
    if (handled) return true;
    return false;
  } catch (err) {
    dependencies.logError("Button interaction error:", err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "❌ 按钮处理出错", ephemeral: true });
      } else {
        await interaction.reply({ content: "❌ 按钮处理出错", ephemeral: true });
      }
    } catch (replyErr) {
      dependencies.logError("Failed to send button error reply:", replyErr);
    }
    return true;
  }
}
