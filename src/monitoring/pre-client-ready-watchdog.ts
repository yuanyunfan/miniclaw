import { createLogger } from "../lib/log.js";
import { sendMacosNotification } from "../notifications/macos-notification.js";

const log = createLogger("startup-watchdog");

export interface PreClientReadyWatchdogOptions {
  enabled: boolean;
  timeoutMs: number;
  macosNotificationEnabled: boolean;
  notify?: (title: string, body: string) => Promise<void>;
}

export interface PreClientReadyWatchdogHandle {
  markClientReady(): void;
  notifyFailure(reason: string, err?: unknown): Promise<void>;
  stop(): void;
}

function errorText(err: unknown): string {
  if (!err) return "";
  return (err instanceof Error ? err.message : String(err))
    .replace(/(password|pass|token|secret|authorization|cookie|session)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/\b[A-Za-z0-9_./+=-]{32,}\b/g, "[redacted]");
}

function notificationBody(reason: string, err?: unknown): string {
  const detail = errorText(err);
  return [
    reason,
    ...(detail ? [`Error: ${detail}`] : []),
  ].join("\n").slice(0, 512);
}

export function startPreClientReadyWatchdog(options: PreClientReadyWatchdogOptions): PreClientReadyWatchdogHandle {
  let stopped = false;
  let ready = false;
  let notified = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const notify = async (reason: string, err?: unknown) => {
    if (!options.enabled || stopped || ready || notified) return;
    notified = true;
    const body = notificationBody(reason, err);
    log.warn(body.replace(/\s+/g, " "));
    if (!options.macosNotificationEnabled) return;
    try {
      if (options.notify) {
        await options.notify("MiniClaw startup failed", body);
      } else {
        const result = await sendMacosNotification({
          title: "MiniClaw startup failed",
          subtitle: "Discord clientReady not reached",
          body,
        });
        if (!result.ok) log.warn(`macOS notification failed: ${result.error ?? "unknown"}`);
      }
    } catch (notifyErr) {
      log.warn("startup watchdog notification failed:", notifyErr);
    }
  };

  if (options.enabled) {
    timer = setTimeout(() => {
      void notify(`Discord clientReady was not reached within ${options.timeoutMs}ms`);
    }, options.timeoutMs);
    timer.unref?.();
  }

  return {
    markClientReady() {
      ready = true;
      if (timer) clearTimeout(timer);
    },
    async notifyFailure(reason: string, err?: unknown) {
      await notify(reason, err);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export const __testables = { notificationBody };
