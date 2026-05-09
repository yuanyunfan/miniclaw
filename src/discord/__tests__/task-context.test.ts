import { describe, expect, it } from "vitest";
import { Collection, type Message } from "discord.js";
import {
  buildTaskSourceFromMessage,
  resolveReplyParentContext,
  withTaskThreadMetadata,
} from "../task-context.js";

function attachment(name: string, contentType: string, size: number) {
  return { name, contentType, size };
}

function message(overrides: Record<string, unknown> = {}): Message {
  const base = {
    id: "msg-1",
    channelId: "channel-1",
    url: "https://discord.com/channels/guild-1/channel-1/msg-1",
    guildId: "guild-1",
    guild: { id: "guild-1", name: "Home Guild" },
    channel: {
      id: "channel-1",
      name: "monitor-github",
      type: 0,
      isThread: () => false,
    },
    author: {
      id: "user-1",
      username: "yuan",
      globalName: "Yuan",
    },
    member: { displayName: "Yuan Y." },
    content: "hello",
    createdTimestamp: Date.UTC(2026, 4, 9, 8, 0, 0),
    createdAt: new Date(Date.UTC(2026, 4, 9, 8, 0, 0)),
    attachments: new Collection([["a1", attachment("repo.txt", "text/plain", 12)]]),
    reference: null,
    fetchReference: async () => null,
  };
  return { ...base, ...overrides } as unknown as Message;
}

describe("Discord task context", () => {
  it("builds source metadata from a Discord message", () => {
    const source = buildTaskSourceFromMessage(message(), "task_channel", {
      cwd: "/repo",
      wasMentioned: true,
    });

    expect(source).toMatchObject({
      provider: "discord",
      route_type: "task_channel",
      guild_id: "guild-1",
      guild_name: "Home Guild",
      source_channel_id: "channel-1",
      source_channel_name: "monitor-github",
      source_message_id: "msg-1",
      author_id: "user-1",
      author_display_name: "Yuan Y.",
      cwd: "/repo",
      was_mentioned: true,
    });
    expect(source.attachments).toEqual([{ name: "repo.txt", content_type: "text/plain", size_bytes: 12 }]);
  });

  it("adds created task thread metadata without changing source route", () => {
    const source = buildTaskSourceFromMessage(message(), "smart_router_auto", { cwd: "/repo" });
    const withThread = withTaskThreadMetadata(source, { id: "thread-1", name: "task thread" });

    expect(withThread).toMatchObject({
      route_type: "smart_router_auto",
      task_thread_id: "thread-1",
      task_thread_name: "task thread",
    });
  });

  it("resolves reply parent context", async () => {
    const parent = message({
      id: "parent-1",
      channelId: "channel-1",
      content: "Add this repo to the existing monitor",
      author: { id: "user-2", username: "alice", globalName: "Alice" } as never,
      member: null,
      attachments: new Collection(),
    });
    const child = message({
      id: "child-1",
      content: "Do this",
      reference: { messageId: "parent-1" } as never,
      fetchReference: async () => parent as never,
    });

    const context = await resolveReplyParentContext(child);
    expect(context).toMatchObject({
      kind: "reply",
      provider: "discord",
      message_id: "parent-1",
      author_username: "alice",
      author_display_name: "Alice",
      content: "Add this repo to the existing monitor",
    });
  });
});
