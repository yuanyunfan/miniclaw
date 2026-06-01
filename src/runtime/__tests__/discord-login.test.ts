import { describe, expect, it, vi } from "vitest";
import {
  buildDiscordLoginFailureAlert,
  loginDiscordWithRetry,
  type DiscordLoginClient,
  type DiscordLoginFailureEvent,
} from "../discord-login.js";

function failingClient(error: Error, destroyed: string[], id: string): DiscordLoginClient {
  return {
    login: vi.fn(async () => {
      throw error;
    }),
    destroy: vi.fn(async () => {
      destroyed.push(id);
    }),
  };
}

describe("discord login retry", () => {
  it("retries with configured backoff delays and returns the successful client", async () => {
    const delays: number[] = [];
    const failures: DiscordLoginFailureEvent[] = [];
    const destroyed: string[] = [];
    let attempt = 0;
    const clients: DiscordLoginClient[] = [];

    const result = await loginDiscordWithRetry(
      () => {
        attempt += 1;
        const id = `client-${attempt}`;
        const client: DiscordLoginClient = attempt < 3
          ? failingClient(new Error(`boom-${attempt}`), destroyed, id)
          : {
              login: vi.fn(async () => "token-ok"),
              destroy: vi.fn(async () => {
                destroyed.push(id);
              }),
            };
        clients.push(client);
        return client;
      },
      "discord-token",
      {
        retryDelaysMs: [10, 20, 40],
        sleep: async (ms) => {
          delays.push(ms);
        },
        onFailure: (event) => {
          failures.push(event);
        },
      }
    );

    expect(result).toMatchObject({ ok: true, attempts: 3 });
    expect(clients).toHaveLength(3);
    expect(delays).toEqual([10, 20]);
    expect(destroyed).toEqual(["client-1", "client-2"]);
    expect(failures.map((event) => ({
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      nextRetryDelayMs: event.nextRetryDelayMs,
      final: event.final,
    }))).toEqual([
      { attempt: 1, maxAttempts: 4, nextRetryDelayMs: 10, final: false },
      { attempt: 2, maxAttempts: 4, nextRetryDelayMs: 20, final: false },
    ]);
  });

  it("notifies final failure after the retry budget is exhausted", async () => {
    const delays: number[] = [];
    const failures: DiscordLoginFailureEvent[] = [];
    const destroyed: string[] = [];
    let attempt = 0;

    const result = await loginDiscordWithRetry(
      () => {
        attempt += 1;
        return failingClient(new Error(`token=secret-value-${attempt}`), destroyed, `client-${attempt}`);
      },
      "discord-token",
      {
        retryDelaysMs: [10, 20, 40],
        sleep: async (ms) => {
          delays.push(ms);
        },
        onFailure: (event) => {
          failures.push(event);
        },
      }
    );

    expect(result).toMatchObject({ ok: false, attempts: 4 });
    expect(delays).toEqual([10, 20, 40]);
    expect(destroyed).toEqual(["client-1", "client-2", "client-3", "client-4"]);
    expect(failures.map((event) => ({
      attempt: event.attempt,
      nextRetryDelayMs: event.nextRetryDelayMs,
      final: event.final,
    }))).toEqual([
      { attempt: 1, nextRetryDelayMs: 10, final: false },
      { attempt: 2, nextRetryDelayMs: 20, final: false },
      { attempt: 3, nextRetryDelayMs: 40, final: false },
      { attempt: 4, nextRetryDelayMs: undefined, final: true },
    ]);
  });

  it("keeps retrying when the failure notifier fails", async () => {
    let attempt = 0;
    const result = await loginDiscordWithRetry(
      () => {
        attempt += 1;
        return attempt === 1
          ? failingClient(new Error("first failure"), [], "client-1")
          : {
              login: vi.fn(async () => "token-ok"),
              destroy: vi.fn(async () => {}),
            };
      },
      "discord-token",
      {
        retryDelaysMs: [1],
        sleep: async () => {},
        onFailure: () => {
          throw new Error("notify failed");
        },
      }
    );

    expect(result).toMatchObject({ ok: true, attempts: 2 });
  });

  it("builds a redacted ops alert with the next retry window", () => {
    const alert = buildDiscordLoginFailureAlert({
      attempt: 1,
      maxAttempts: 4,
      nextRetryDelayMs: 10 * 60_000,
      final: false,
      occurredAt: "2026-05-25T02:39:00.000Z",
      error: new Error("Connect timeout token=abcdefghijklmnopqrstuvwxyz1234567890"),
    });

    expect(alert.subject).toBe("MiniClaw Discord 登录失败");
    expect(alert.text).toContain("尝试: 1/4");
    expect(alert.text).toContain("重试: 10m 后进行第 2/4 次登录。");
    expect(alert.text).toContain("token=[redacted]");
  });
});
