import { describe, expect, it } from "vitest";
import type { Client } from "discord.js";
import { runMessage } from "../runner-message.js";
import type { CronJobMessage } from "../types.js";

function messageJob(overrides: Partial<CronJobMessage> = {}): CronJobMessage {
  return {
    name: "test-message",
    schedule: "* * * * *",
    enabled: true,
    type: "message",
    channel: "1000000000000000000",
    content: "hello {{cron.name}}",
    ...overrides,
  };
}

function fakeClient(channel: unknown): Client {
  return {
    channels: {
      fetch: async () => channel,
    },
  } as unknown as Client;
}

describe("runMessage", () => {
  it("发送模板渲染后的消息", async () => {
    const sent: unknown[] = [];
    const channel = {
      isSendable: () => true,
      send: async (body: unknown) => {
        sent.push(body);
        return {};
      },
    };

    await runMessage(messageJob(), fakeClient(channel));

    expect(sent).toEqual([{
      content: "hello test-message",
      allowedMentions: { parse: [] },
    }]);
  });

  it("频道不可发送时抛错，方便 scheduler 记录 error", async () => {
    await expect(runMessage(messageJob(), fakeClient(null))).rejects.toThrow(/not sendable/);
  });
});
