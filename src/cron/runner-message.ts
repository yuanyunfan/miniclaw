import type { Client, SendableChannels } from "discord.js";
import { renderTemplate } from "./template.js";
import type { CronJobMessage } from "./types.js";

export async function runMessage(job: CronJobMessage, client: Client): Promise<void> {
  const ch = await client.channels.fetch(job.channel);
  if (!ch || !("isSendable" in ch) || !ch.isSendable()) {
    console.warn(`[cron] ${job.name}: channel ${job.channel} not sendable`);
    return;
  }
  const channel = ch as SendableChannels;
  const text = renderTemplate(job.content, { "cron.name": job.name });
  await channel.send(text.slice(0, 2000));
}
