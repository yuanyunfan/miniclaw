import { describe, expect, it } from "vitest";
import { buildChatRuntimeContext } from "../chat-context.js";

describe("buildChatRuntimeContext", () => {
  it("includes Discord channel/message metadata and reply parent as untrusted context", () => {
    const context = buildChatRuntimeContext({
      source: {
        provider: "discord",
        route_type: "chat_message",
        source_channel_id: "channel-1",
        source_channel_name: "daily-ai-news",
        source_message_id: "message-1",
        cwd: "/repo",
        was_mentioned: true,
      },
      parent: {
        kind: "reply",
        provider: "discord",
        message_id: "parent-1",
        channel_id: "channel-1",
        content: "previous failure card",
      },
    });

    expect(context).toContain("<discord_message_context trust=\"untrusted\">");
    expect(context).toContain("\"source_channel_name\": \"daily-ai-news\"");
    expect(context).toContain("\"was_mentioned\": true");
    expect(context).toContain("<reply_parent_context trust=\"untrusted\">");
    expect(context).toContain("\"content\": \"previous failure card\"");
  });

  it("returns an empty string when no runtime context is available", () => {
    expect(buildChatRuntimeContext()).toBe("");
  });
});
