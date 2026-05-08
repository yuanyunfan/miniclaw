import { describe, expect, it } from "vitest";
import {
  buildCronFailurePayload,
  buildCronRetryCustomId,
  parseCronRetryCustomId,
  sanitizeCronError,
} from "../failure-notifier.js";
import type { CronJobMessage } from "../types.js";

function messageJob(): CronJobMessage {
  return {
    name: "daily-stock-summary",
    schedule: "0 17 * * 1-5",
    enabled: true,
    type: "message",
    channel: "1000000000000000000",
    content: "hello",
  };
}

describe("cron failure notifier", () => {
  it("builds and parses retry custom ids without embedding job config", () => {
    const id = buildCronRetryCustomId("run_abc-123");
    expect(id).toBe("miniclaw:cron:retry:run_abc-123");
    expect(parseCronRetryCustomId(id)).toEqual({ runId: "run_abc-123" });
    expect(parseCronRetryCustomId("miniclaw:smart:task:abc")).toBeNull();
    expect(parseCronRetryCustomId("miniclaw:cron:retry:bad/value")).toBeNull();
  });

  it("sanitizes token-like values and URL query strings from errors", () => {
    const accessTokenKey = `access_${"token"}`;
    const longValue = "abcdefghijklmnopqrstuvwxyz".repeat(3);
    const sanitized = sanitizeCronError(
      `failed token=${"abc".repeat(8)} ${accessTokenKey}:${"xyz".repeat(12)} password=${"hello"} ` +
      "url=https://example.com/path?a=1&token=secret " +
      `long=${longValue}`
    );
    expect(sanitized).toContain("token=[redacted]");
    expect(sanitized).toContain("access_token=[redacted]");
    expect(sanitized).toContain("password=[redacted]");
    expect(sanitized).toContain("https://example.com/path?[redacted]");
    expect(sanitized).not.toContain("hello");
    expect(sanitized).not.toContain(longValue);
  });

  it("failure payload is a short summary with a retry button", () => {
    const payload = buildCronFailurePayload(messageJob(), {
      runId: "run_abc",
      attempt: 1,
      maxAttempts: 5,
      durationMs: 1234,
      error: "boom",
      failedAt: new Date("2026-05-08T01:00:00.000Z"),
      nextRetryAt: new Date("2026-05-08T01:10:00.000Z"),
    });

    expect(payload.content).toContain("定时任务执行失败");
    expect(payload.content).toContain("`daily-stock-summary`");
    expect(payload.content).toContain("尝试次数: 1/5");
    expect(payload.content).toContain("错误: boom");
    expect(payload.content).not.toContain("hello");
    expect(payload.components?.length).toBe(1);
  });
});
