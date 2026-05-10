import "../proxy.js";
import type { Client } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { getActiveTasks, markTaskInterrupted, type TaskRow } from "../store/db.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("recovery");

const RECENT_RECOVERY_SKIP_MS = 60_000;

function buildRecoveryEmbed(task: TaskRow): EmbedBuilder {
  const shortId = task.id.slice(0, 8);
  return new EmbedBuilder()
    .setTitle("⚠️ 任务因进程重启被中断")
    .setDescription(
      `任务 \`${shortId}\` 在执行中被中断（pm2 重启 / 进程退出）。\n\n` +
      `回复 \`/resume task_id:${shortId} followup:"继续"\` 即可从上次 session 续跑。`
    )
    .addFields(
      { name: "原始 prompt", value: task.prompt.slice(0, 1000) || "(空)", inline: false },
      { name: "Session", value: task.session_id ? task.session_id.slice(0, 8) : "(无 — 未建立 session 时被中断)", inline: true }
    )
    .setColor(0xf39c12)
    .setTimestamp();
}

export async function recoverInterruptedTasks(client: Client): Promise<void> {
  const stale = getActiveTasks();
  if (!stale.length) return;

  log.info(`Recovering ${stale.length} interrupted task(s)...`);

  for (const task of stale) {
    try {
      // Skip if completed_at on a previous recovery is too recent (restart storm guard).
      if (task.completed_at) {
        const ts = Date.parse(task.completed_at + "Z");
        if (Number.isFinite(ts) && Date.now() - ts < RECENT_RECOVERY_SKIP_MS) {
          continue;
        }
      }

      markTaskInterrupted(task.id);

      if (!task.discord_thread_id) continue;

      const channel = await client.channels.fetch(task.discord_thread_id).catch(() => null);
      if (!channel || !("isTextBased" in channel) || !channel.isTextBased() || !channel.isSendable()) {
        continue;
      }

      // Best-effort: edit the dangling progress message to mark it as interrupted.
      if (task.progress_message_id) {
        try {
          const msg = await channel.messages.fetch(task.progress_message_id);
          const current = msg.content ?? "";
          const suffix = "\n\n⚠️ 进程重启中断";
          if (!current.includes(suffix)) {
            await msg.edit((current + suffix).slice(0, 2000));
          }
        } catch {
          // message gone or non-editable — fall through to embed notice
        }
      }

      await channel.send({ embeds: [buildRecoveryEmbed(task)] });
    } catch (err) {
      log.error(`Failed to recover task ${task.id}:`, err);
    }
  }
}
