import { describe, expect, it } from "vitest";
import { resolveDiscordMessageRoute } from "../message-route.js";

const base = {
  authorAllowed: true,
  isThread: false,
  hasContinuableTask: false,
  channelId: "chat",
  taskChannelIds: ["task"],
  autoReplyChannelIds: ["chat"],
  isMentioned: false,
};

describe("resolveDiscordMessageRoute", () => {
  it("ignores unauthorized authors before any routing decision", () => {
    expect(resolveDiscordMessageRoute({ ...base, authorAllowed: false, channelId: "task", isMentioned: true })).toBe("ignore");
  });

  it("prioritizes task thread continuation over channel routing", () => {
    expect(resolveDiscordMessageRoute({
      ...base,
      isThread: true,
      hasContinuableTask: true,
      channelId: "task",
    })).toBe("thread_continuation");
  });

  it("routes configured task channels before chat channels", () => {
    expect(resolveDiscordMessageRoute({
      ...base,
      channelId: "shared",
      taskChannelIds: ["shared"],
      autoReplyChannelIds: ["shared"],
    })).toBe("task_channel");
  });

  it("routes auto-reply or mention messages to chat", () => {
    expect(resolveDiscordMessageRoute({ ...base, channelId: "chat" })).toBe("chat");
    expect(resolveDiscordMessageRoute({ ...base, channelId: "other", isMentioned: true })).toBe("chat");
  });

  it("ignores ordinary messages outside configured channels", () => {
    expect(resolveDiscordMessageRoute({ ...base, channelId: "other" })).toBe("ignore");
  });
});
