import type { Client, SendableChannels } from "discord.js";
import { renderTemplate } from "./template.js";
import type { CronJobMessage, CronJobRunContext, CronJobRunOutcome } from "./types.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("cron");

class CronMessageRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronMessageRunError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new CronMessageRunError("cron message run aborted");
}

export async function runMessage(job: CronJobMessage, client: Client, context: CronJobRunContext = {}): Promise<CronJobRunOutcome> {
  throwIfAborted(context.signal);
  const ch = await client.channels.fetch(job.channel);
  throwIfAborted(context.signal);
  if (!ch || !("isSendable" in ch) || !ch.isSendable()) {
    const msg = `${job.name}: channel ${job.channel} not sendable`;
    log.warn(msg);
    throw new CronMessageRunError(msg);
  }
  const channel = ch as SendableChannels;
  const text = renderTemplate(job.content, { "cron.name": job.name });
  await channel.send(text.slice(0, 2000));
  throwIfAborted(context.signal);
  return { status: "success" };
}
