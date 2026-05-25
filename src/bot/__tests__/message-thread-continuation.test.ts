import { Collection, type Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { appendTaskControlEvent } from "../../store/db.js";
import type { TaskRow } from "../../store/db.js";
import { handleThreadContinuationMessage } from "../message-thread-continuation.js";

vi.mock("../../agent/session.js", () => ({
  assertProviderSession: vi.fn(() => {
    throw new Error("session provider mismatch");
  }),
}));

vi.mock("../../store/db.js", () => ({
  appendTaskControlEvent: vi.fn(() => ({
    id: "control-event-1",
  })),
  createTask: vi.fn(),
}));

function fakeMessage(): {
  message: Message;
  reply: ReturnType<typeof vi.fn>;
  react: ReturnType<typeof vi.fn>;
} {
  const reply = vi.fn(async (_payload: unknown) => undefined);
  const react = vi.fn(async (_emoji: string) => undefined);
  const message = {
    id: "msg-1",
    content: "continue this",
    channel: {
      id: "thread-1",
      name: "task thread",
      isSendable: () => true,
      send: vi.fn(async (_payload: unknown) => undefined),
    },
    author: { id: "user-1" },
    attachments: new Collection(),
    mentions: { has: vi.fn(() => false) },
    reply,
    react,
  } as unknown as Message;
  return { message, reply, react };
}

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-1",
    discord_thread_id: "thread-1",
    discord_user_id: "user-1",
    prompt: "original",
    cwd: "/repo",
    session_id: "codex:session-1",
    status: "completed",
    result_summary: null,
    cost_usd: null,
    duration_ms: null,
    created_at: "2026-05-12T00:00:00.000Z",
    completed_at: null,
    progress_message_id: null,
    source_route_type: null,
    source_channel_id: null,
    source_message_id: null,
    source_message_url: null,
    source_metadata_json: null,
    parent_context_json: null,
    ...overrides,
  };
}

describe("thread continuation message handler", () => {
  it("rejects incompatible provider sessions before marking the message processed", async () => {
    const { message, reply } = fakeMessage();
    const markProcessed = vi.fn(() => true);

    await handleThreadContinuationMessage(message, taskRow(), {
      botUserId: "bot-1",
      markProcessed,
    });

    expect(reply).toHaveBeenCalledWith("❌ session provider mismatch");
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it("queues operator messages for running tasks instead of starting a resume task", async () => {
    const { message, reply, react } = fakeMessage();
    const markProcessed = vi.fn(() => true);

    await handleThreadContinuationMessage(message, taskRow({ status: "running" }), {
      botUserId: "bot-1",
      markProcessed,
    });

    expect(markProcessed).toHaveBeenCalledWith("msg-1");
    expect(appendTaskControlEvent).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      eventType: "operator_message",
      payload: {
        text: "continue this",
        attachments: [],
      },
      discordMessageId: "msg-1",
      actorId: "user-1",
    }));
    expect(react).toHaveBeenCalledWith("📌");
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Queued operator instruction"));
  });
});
