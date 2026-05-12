import { Collection, type Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { formatChatErrorReply, handleChatMessage } from "../message-chat.js";

function fakeMessage(): Message {
  return {
    id: "msg-1",
    content: "hello",
    channel: { id: "channel-1" },
    author: { id: "user-1" },
    attachments: new Collection(),
    reply: vi.fn(async (_payload: unknown) => undefined),
  } as unknown as Message;
}

describe("chat message handler helpers", () => {
  it("uses a task-oriented timeout reply for slow chat failures", () => {
    expect(formatChatErrorReply(new Error("request aborted by timeout"))).toContain("更适合用 task 模式");
  });

  it("collapses whitespace and caps generic chat errors", () => {
    const reply = formatChatErrorReply(new Error(`bad\n${"x".repeat(400)}`));

    expect(reply).toMatch(/^❌ 回复出错: bad x+/);
    expect(reply.length).toBeLessThanOrEqual("❌ 回复出错: ".length + 300);
  });

  it("returns before chat side effects when a message id was already processed", async () => {
    const message = fakeMessage();
    const markProcessed = vi.fn(() => false);

    await handleChatMessage(message, {
      botUserId: "bot-1",
      markProcessed,
    });

    expect(markProcessed).toHaveBeenCalledWith("msg-1");
    expect(message.reply).not.toHaveBeenCalled();
  });
});
