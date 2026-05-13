import type { Client } from "discord.js";
import { renderTemplate } from "./template.js";
import type { CronJobMessage, CronJobRunContext, CronJobRunOutcome } from "./types.js";
import { createLogger } from "../lib/log.js";
import { sendTextFanout } from "../im/delivery.js";

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
  const text = renderTemplate(job.content, { "cron.name": job.name });
  try {
    await sendTextFanout({
      client,
      fallbackDiscordTarget: job.channel,
      route: job.delivery_route,
      content: text,
      metadata: { cron_name: job.name, cron_type: job.type },
    });
  } catch (err) {
    const msg = `${job.name}: IM delivery failed: ${err instanceof Error ? err.message : String(err)}`;
    log.warn(msg);
    throw new CronMessageRunError(msg);
  }
  throwIfAborted(context.signal);
  return { status: "success" };
}
