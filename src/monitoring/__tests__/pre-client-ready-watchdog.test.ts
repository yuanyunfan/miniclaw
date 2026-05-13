import { afterEach, describe, expect, it, vi } from "vitest";
import { startPreClientReadyWatchdog } from "../pre-client-ready-watchdog.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("pre-clientReady watchdog", () => {
  it("sends one local notification when clientReady is not reached", async () => {
    vi.useFakeTimers();
    const notified: Array<{ title: string; body: string }> = [];
    startPreClientReadyWatchdog({
      enabled: true,
      timeoutMs: 1000,
      macosNotificationEnabled: true,
      notify: async (title, body) => {
        notified.push({ title, body });
      },
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(notified).toHaveLength(1);
    expect(notified[0]?.title).toBe("MiniClaw startup failed");
    expect(notified[0]?.body).toContain("Discord clientReady was not reached");
  });

  it("does not notify after clientReady is marked", async () => {
    vi.useFakeTimers();
    const notify = vi.fn(async () => {});
    const watchdog = startPreClientReadyWatchdog({
      enabled: true,
      timeoutMs: 1000,
      macosNotificationEnabled: true,
      notify,
    });

    watchdog.markClientReady();
    await vi.advanceTimersByTimeAsync(1000);

    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies immediately on bot.login failure and redacts sensitive details", async () => {
    const notify = vi.fn<(title: string, body: string) => Promise<void>>(async () => {});
    const watchdog = startPreClientReadyWatchdog({
      enabled: true,
      timeoutMs: 60_000,
      macosNotificationEnabled: true,
      notify,
    });

    await watchdog.notifyFailure("bot.login failed before Discord clientReady", new Error("token=abcdefghijklmnopqrstuvwxyz1234567890"));

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toBe("MiniClaw startup failed");
    expect(notify.mock.calls[0]?.[1]).toContain("bot.login failed before Discord clientReady");
    expect(notify.mock.calls[0]?.[1]).toContain("token=[redacted]");
  });
});
