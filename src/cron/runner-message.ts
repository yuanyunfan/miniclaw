import type { Client, SendableChannels } from "discord.js";
import { renderTemplate } from "./template.js";
import type { CronJobMessage } from "./types.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("cron");

class CronMessageRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronMessageRunError";
  }
}

export async function runMessage(job: CronJobMessage, client: Client): Promise<void> {
  const ch = await client.channels.fetch(job.channel);
  if (!ch || !("isSendable" in ch) || !ch.isSendable()) {
    const msg = `${job.name}: channel ${job.channel} not sendable`;
    log.warn(msg);
    throw new CronMessageRunError(msg);
  }
  const channel = ch as SendableChannels;
  const text = renderTemplate(job.content, { "cron.name": job.name });
  await channel.send(text.slice(0, 2000));
}
