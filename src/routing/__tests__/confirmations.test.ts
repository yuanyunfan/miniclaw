import { beforeEach, describe, expect, it } from "vitest";
import {
  __clearConfirmationsForTests,
  buildSmartRouterCustomId,
  consumePendingConfirmation,
  createPendingConfirmation,
  parseSmartRouterCustomId,
  pruneExpired,
} from "../confirmations.js";

const decision = {
  intent: "task_confirm" as const,
  confidence: 0.9,
  reason: "test",
  matchedSignals: ["modify"],
  riskFlags: ["writes_files"],
};

beforeEach(() => {
  __clearConfirmationsForTests();
});

describe("confirmation custom ids", () => {
  it("round-trips action and token", () => {
    const customId = buildSmartRouterCustomId("task", "abc123");
    expect(parseSmartRouterCustomId(customId)).toEqual({ action: "task", id: "abc123" });
    expect(parseSmartRouterCustomId("other")).toBeUndefined();
  });
});

describe("pending confirmations", () => {
  it("allows only the original user to consume", () => {
    const row = createPendingConfirmation({
      userId: "u-1",
      channelId: "ch-1",
      messageId: "msg-1",
      prompt: "修改 README",
      cwd: "/tmp",
      decision,
      ttlMs: 600_000,
      now: 1000,
    });

    expect(consumePendingConfirmation(row.id, "task", "u-2", 2000)).toEqual({
      ok: false,
      reason: "unauthorized",
    });

    const consumed = consumePendingConfirmation(row.id, "task", "u-1", 2000);
    expect(consumed.ok).toBe(true);
    if (consumed.ok) expect(consumed.confirmation.status).toBe("accepted");
  });

  it("expires after ttl", () => {
    const row = createPendingConfirmation({
      userId: "u-1",
      channelId: "ch-1",
      messageId: "msg-1",
      prompt: "修改 README",
      cwd: "/tmp",
      decision,
      ttlMs: 1000,
      now: 1000,
    });

    expect(consumePendingConfirmation(row.id, "task", "u-1", 2500)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("prunes expired confirmations", () => {
    createPendingConfirmation({
      userId: "u-1",
      channelId: "ch-1",
      messageId: "msg-1",
      prompt: "修改 README",
      cwd: "/tmp",
      decision,
      ttlMs: 1000,
      now: 1000,
    });
    expect(pruneExpired(2500)).toBe(1);
  });
});
