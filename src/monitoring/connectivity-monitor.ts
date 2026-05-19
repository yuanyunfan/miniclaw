import type { Client } from "discord.js";
import { config } from "../config.js";
import { createWeixinTransport } from "../im/adapters/weixin/transport.js";
import { resolveWeixinAccount, type WeixinAccountData } from "../im/adapters/weixin/store.js";
import type { IMDeliveryTarget } from "../im/contracts.js";
import { createLogger } from "../lib/log.js";
import { verifySmtpReachability } from "../notifications/smtp-email.js";
import { runConnectivityTick, type ConnectivityAlertMessage, type ProbeResult } from "./connectivity-core.js";
import { flushRecoveryOutbox } from "./recovery-outbox.js";

const log = createLogger("connectivity");

export interface ConnectivityMonitorHandle {
  stop(): void;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function measure(label: string, fn: () => Promise<void>): Promise<ProbeResult> {
  const started = Date.now();
  try {
    await fn();
    return { ok: true, latency_ms: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, latency_ms: Date.now() - started, error: `${label}: ${message}` };
  }
}

function smtpConfigured(): boolean {
  const email = config.notifications.email;
  return Boolean(email.enabled && email.smtpHost);
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

async function sendWeixinConnectivityAlert(message: ConnectivityAlertMessage): Promise<void> {
  const weixin = config.im.transports.weixin;
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
          kind: "connectivity_alert",
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
    log.warn(`weixin connectivity alert partially failed delivered=${delivered} failed=${errors.length}: ${errors.join("; ")}`);
  }
}

export function startConnectivityMonitor(client: Client): ConnectivityMonitorHandle {
  if (!config.connectivity.enabled) {
    log.info("connectivity monitor disabled");
    return { stop: () => {} };
  }

  let running = false;
  let stopped = false;
  let lastStatus = "";

  const runOnce = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const snapshot = await runConnectivityTick({
        statePath: config.connectivity.statePath,
        failureThreshold: config.connectivity.failureThreshold,
        checkers: {
          discordGateway: async () => measure("discord gateway", async () => {
            if (!client.isReady()) throw new Error("client is not ready");
          }),
          discordRest: async () => measure("discord rest", async () => {
            await withTimeout(client.guilds.fetch(config.discord.guildId).then(() => undefined), config.connectivity.requestTimeoutMs, "discord rest");
          }),
          generalNetwork: async () => measure("general network", async () => {
            const response = await fetch(config.connectivity.generalTestUrl, {
              method: "GET",
              signal: AbortSignal.timeout(config.connectivity.requestTimeoutMs),
            });
            await response.body?.cancel().catch(() => undefined);
          }),
          smtp: async () => {
            if (!smtpConfigured()) {
              return { ok: false, skipped: true, error: "email fallback is not configured" };
            }
            return measure("smtp", async () => {
              await verifySmtpReachability(config.notifications.email, config.connectivity.requestTimeoutMs);
            });
          },
        },
        sendAlert: config.im.transports.weixin.enabled ? sendWeixinConnectivityAlert : undefined,
      });
      if (snapshot.status !== lastStatus) {
        log.info(`connectivity status=${snapshot.status} consecutive=${snapshot.consecutive_failures}`);
        lastStatus = snapshot.status;
      }
      if (snapshot.status === "discord_ok" || snapshot.status === "recovered") {
        await flushRecoveryOutbox(client, { snapshot, imConfig: config.im }).catch((err) => {
          log.warn("recovery outbox flush failed:", err);
        });
      }
    } catch (err) {
      log.error("connectivity monitor tick failed:", err);
    } finally {
      running = false;
    }
  };

  void runOnce();
  const timer = setInterval(() => void runOnce(), config.connectivity.intervalMs);
  timer.unref?.();
  log.info(`connectivity monitor started interval=${config.connectivity.intervalMs}ms state=${config.connectivity.statePath}`);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
