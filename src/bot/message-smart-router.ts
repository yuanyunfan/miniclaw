import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Attachment,
  type Message,
} from "discord.js";
import { config } from "../config.js";
import {
  buildTaskSourceFromMessage,
  resolveReplyParentContext,
} from "../discord/task-context.js";
import { createLogger } from "../lib/log.js";
import {
  buildSmartRouterCustomId,
  createPendingConfirmation,
  type ConfirmationAction,
} from "../routing/confirmations.js";
import { buildSmartTaskPrompt } from "../routing/context.js";
import { hashPrompt, promptPreview } from "../routing/decision-log.js";
import type { RouteDecision } from "../routing/intent.js";
import type { TaskContextEnvelope } from "../routing/task-context.js";
import {
  getChatHistory,
  recordSmartRouterDecision,
} from "../store/db.js";

const log = createLogger("bot");

type SmartRouterDecisionInput = Parameters<typeof recordSmartRouterDecision>[0];

function smartRouterEvaluationFields(actionResult: string): Partial<SmartRouterDecisionInput> {
  if (actionResult === "chat") {
    return {
      final_route: "chat",
      task_final_status: "not_created",
      correction_type: "none",
      resolved_at: new Date().toISOString(),
    };
  }
  if (actionResult === "auto_task_start") {
    return {
      user_choice: "auto_task_no_choice",
      final_route: "task",
      correction_type: "none",
    };
  }
  return {};
}

export function recordRouteDecisionForMessage(
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
      ...(decision.capabilities ? { capabilities_json: JSON.stringify(decision.capabilities) } : {}),
      ...(decision.capabilities?.classifierElapsedMs !== undefined
        ? { classifier_elapsed_ms: decision.capabilities.classifierElapsedMs }
        : {}),
      ...(decision.capabilities?.classifierErrorType
        ? { classifier_error_type: decision.capabilities.classifierErrorType }
        : {}),
      ...(decision.capabilities?.classifierErrorMessage
        ? { classifier_error_message: decision.capabilities.classifierErrorMessage }
        : {}),
      action_result: actionResult,
      ...smartRouterEvaluationFields(actionResult),
      ...(createdTaskId ? { created_task_id: createdTaskId } : {}),
    });
  } catch (err) {
    log.error("Failed to record smart-router decision:", err);
    return undefined;
  }
}

export function buildSmartTaskPromptForChannel(channelId: string, prompt: string): string {
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

export async function askForTaskUpgrade(
  message: Message,
  decision: RouteDecision,
  prompt: string,
  cwd: string,
  attachments: Attachment[]
): Promise<void> {
  const logId = recordRouteDecisionForMessage(message, prompt, decision, "confirmation_pending");
  const parentContext = await resolveReplyParentContext(message);
  const taskContext: TaskContextEnvelope = {
    source: buildTaskSourceFromMessage(message, "smart_router_confirmed", {
      cwd,
      wasMentioned: message.client.user ? message.mentions.has(message.client.user) : false,
    }),
    ...(parentContext ? { parent: parentContext } : {}),
  };
  const pending = createPendingConfirmation({
    userId: message.author.id,
    channelId: message.channel.id,
    messageId: message.id,
    prompt,
    cwd,
    attachments,
    decision,
    taskContext,
    ...(logId !== undefined ? { decisionLogId: logId } : {}),
    ttlMs: config.smartRouter.confirmation.timeoutSeconds * 1000,
  });
  await message.reply({
    content: routerPromptText(decision, prompt),
    components: confirmationComponents(pending.id),
  });
}
