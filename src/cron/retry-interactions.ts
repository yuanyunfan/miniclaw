import type { ButtonInteraction } from "discord.js";
import { config } from "../config.js";
import { createLogger } from "../lib/log.js";
import {
  buildCronRetryRequestedPayload,
  parseCronRetryCustomId,
} from "./failure-notifier.js";
import { requestCronRetryNow } from "./scheduler.js";

const log = createLogger("cron-retry-button");

export async function handleCronRetryButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseCronRetryCustomId(interaction.customId);
  if (!parsed) return false;

  if (interaction.user.id !== config.allowedUserId) {
    await interaction.reply({ content: "⛔ 无权限", ephemeral: true });
    return true;
  }

  let updated = false;
  const result = await requestCronRetryNow(parsed.runId, interaction.client, {
    failureAlert: {
      channelId: interaction.channelId,
      messageId: interaction.message.id,
      message: interaction.message,
    },
    beforeRun: async (pending) => {
      try {
        await interaction.update(buildCronRetryRequestedPayload(pending.jobName, pending.status));
        updated = true;
      } catch (err) {
        log.warn("failed to update cron retry button message:", err);
      }
    },
  });
  if (!result.ok) {
    await interaction.reply({ content: `❌ ${result.message}`, ephemeral: true });
    return true;
  }

  if (!updated) {
    await interaction.reply({
      content: `✅ 已请求立即重新执行: ${result.jobName}`,
      ephemeral: true,
    });
  }
  return true;
}
