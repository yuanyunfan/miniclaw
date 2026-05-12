import { Collection, type Message } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAndRunDiscordTask,
  taskCapacityError,
} from "../../discord/task-intake.js";
import { handleTaskChannelMessage, stripBotMention } from "../message-task-channel.js";

vi.mock("../../discord/task-intake.js", () => ({
  createAndRunDiscordTask: vi.fn(async (params: {
    createThread: (name: string) => Promise<unknown>;
    onCreated?: (result: { taskId: string; threadId: string; thread: unknown }) => Promise<void>;
  }) => {
    const thread = await params.createThread("task title");
    await params.onCreated?.({ taskId: "task-1", threadId: "thread-1", thread });
    return { taskId: "task-1", threadId: "thread-1", thread };
  }),
  formatTaskCompletionNotice: vi.fn(() => "done"),
  taskCapacityError: vi.fn(() => undefined),
}));

vi.mock("../../discord/task-context.js", () => ({
  buildTaskSourceFromMessage: vi.fn((_message: Message, routeType: string, opts: { cwd: string; wasMentioned?: boolean }) => ({
    provider: "discord",
    route_type: routeType,
    cwd: opts.cwd,
    was_mentioned: opts.wasMentioned,
  })),
  resolveReplyParentContext: vi.fn(async () => undefined),
}));

vi.mock("../../routing/cwd.js", () => ({
  resolveTaskCwd: vi.fn(() => "/repo"),
}));

vi.mock("../../lib/log.js", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn() }),
}));

function fakeMessage(content: string, overrides: Partial<Message> = {}): {
  message: Message;
  reply: ReturnType<typeof vi.fn>;
  react: ReturnType<typeof vi.fn>;
  startThread: ReturnType<typeof vi.fn>;
  removeReaction: ReturnType<typeof vi.fn>;
} {
  const reply = vi.fn(async (_payload: unknown) => undefined);
  const react = vi.fn(async (_emoji: string) => undefined);
  const startThread = vi.fn(async (_payload: unknown) => ({ id: "thread-1", name: "task title" }));
  const removeReaction = vi.fn(async (_user: string) => undefined);
  const base = {
    id: "msg-1",
    content,
    channel: { id: "channel-1" },
    author: { id: "user-1" },
    attachments: new Collection(),
    mentions: { has: vi.fn((id: string) => id === "bot-1") },
    reply,
    react,
    startThread,
    reactions: {
      cache: {
        get: vi.fn(() => ({ users: { remove: removeReaction } })),
      },
    },
    ...overrides,
  } as unknown as Message;
  return { message: base, reply, react, startThread, removeReaction };
}

describe("task channel message handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips direct bot mentions from task prompts", () => {
    expect(stripBotMention(" <@bot-1>   run tests  <@!bot-1> ", "bot-1")).toBe("run tests");
  });

  it("returns before side effects when a message id was already processed", async () => {
    const { message, reply } = fakeMessage("run tests");

    await handleTaskChannelMessage(message, {
      botUserId: "bot-1",
      markProcessed: vi.fn(() => false),
    });

    expect(reply).not.toHaveBeenCalled();
    expect(createAndRunDiscordTask).not.toHaveBeenCalled();
  });

  it("asks for a task description when the task channel message is empty", async () => {
    const { message, reply } = fakeMessage(" <@bot-1> ");

    await handleTaskChannelMessage(message, {
      botUserId: "bot-1",
      markProcessed: vi.fn(() => true),
    });

    expect(reply).toHaveBeenCalledWith("请直接发送任务描述，或附上文件后说明要 MiniClaw 做什么。");
    expect(createAndRunDiscordTask).not.toHaveBeenCalled();
  });

  it("delegates valid task channel messages to the shared Discord task intake path", async () => {
    vi.mocked(taskCapacityError).mockReturnValueOnce(undefined);
    const { message, reply, react, startThread } = fakeMessage(" <@bot-1> run tests ");

    await handleTaskChannelMessage(message, {
      botUserId: "bot-1",
      markProcessed: vi.fn(() => true),
    });

    expect(react).toHaveBeenCalledWith("👀");
    expect(createAndRunDiscordTask).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "run tests",
      cwd: "/repo",
      userId: "user-1",
      attachments: [],
      taskContext: {
        source: expect.objectContaining({
          route_type: "task_channel",
          was_mentioned: true,
        }),
      },
    }));
    expect(startThread).toHaveBeenCalledWith({
      name: "task title",
      autoArchiveDuration: 1440,
    });
    expect(reply).toHaveBeenCalledWith("✅ 任务已创建，请查看线程 <#thread-1>");
  });
});
