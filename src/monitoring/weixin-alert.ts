import { config } from "../config.js";
import { createWeixinTransport } from "../im/adapters/weixin/transport.js";
import { resolveWeixinAccount, type WeixinAccountData } from "../im/adapters/weixin/store.js";
import type { IMDeliveryTarget } from "../im/contracts.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("weixin-alert");

export interface OpsAlertMessage {
  subject: string;
  text: string;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function weixinAlertTargets(account: WeixinAccountData): IMDeliveryTarget[] {
  const weixin = config.im.transports.weixin;
  const explicitTargets = weixin.allowedUserIds.filter((id) => id !== "*");
  const fallbackTargets = [
    account.userId,
    ...Object.keys(account.contextTokens ?? {}),
  ];
  return uniqueNonEmpty(explicitTargets.length ? explicitTargets : fallbackTargets).map((target) => ({
    transport: "weixin",
    target,
    accountId: account.accountId,
  }));
}

export async function sendWeixinOpsAlert(
  message: OpsAlertMessage,
  options: { kind?: string } = {}
): Promise<void> {
  const weixin = config.im.transports.weixin;
  if (!weixin.enabled) throw new Error("Weixin transport is not enabled");

  const account = resolveWeixinAccount(weixin.defaultAccountId, weixin.stateDir);
  const targets = weixinAlertTargets(account);
  if (!targets.length) throw new Error("Weixin alert target is not configured");

  const transport = createWeixinTransport({
    stateDir: weixin.stateDir,
    defaultAccountId: account.accountId,
  });
  const errors: string[] = [];
  let delivered = 0;
  for (const target of targets) {
    try {
      await transport.send({
        target,
        content: message.text,
        metadata: {
          kind: options.kind ?? "ops_alert",
          subject: message.subject,
        },
      });
      delivered += 1;
    } catch (err) {
      errors.push(`${target.target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (delivered === 0) {
    throw new Error(`Weixin alert delivery failed: ${errors.join("; ") || "unknown error"}`);
  }
  if (errors.length) {
    log.warn(`weixin alert partially failed delivered=${delivered} failed=${errors.length}: ${errors.join("; ")}`);
  }
}
