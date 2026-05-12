import { describe, expect, it, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import { handleTaskLog } from "../handlers.js";
import { buildTaskLogReply, formatTaskTraceError, TASK_TRACE_INLINE_LIMIT } from "../task-log.js";
import type { TaskTraceModel } from "../../store/task-trace-export.js";

function model(overrides: Partial<TaskTraceModel> = {}): TaskTraceModel {
  return {
    task: {
      id: "task-1234567890",
      status: "completed",
      cwd: "/tmp/task",
      sessionId: "codex:session-1",
      durationMs: 123,
      costUsd: 0,
      createdAt: "2026-05-11T00:00:00.000Z",
      completedAt: "2026-05-11T00:00:01.000Z",
      sourceRouteType: "slash_command",
      sourceChannelId: "channel-1",
      sourceThreadId: "thread-1",
      sourceMessageId: "message-1",
      sourceMessageUrl: "https://discord.com/channels/g/c/m",
    },
    events: [],
    totalEventCount: 1,
    renderedEventCount: 1,
    omittedEventCount: 0,
    generatedAt: "2026-05-11T00:00:02.000Z",
    redactionPolicy: "allowlist",
    ...overrides,
  };
}

describe("task-log command helpers", () => {
  it("formats explicit trace errors", () => {
    expect(formatTaskTraceError({ code: "missing_id", message: "task id 不能为空" })).toBe("❌ task id 不能为空");
    expect(formatTaskTraceError({
      code: "ambiguous_prefix",
      message: "task id 前缀 `abc` 匹配多条任务",
      matches: ["abcdef111111", "abcdef222222"],
    })).toContain("abcdef111111, abcdef222222");
  });

  it("keeps short traces inline and attaches long traces", () => {
    expect(buildTaskLogReply(model(), "# short trace\n")).toEqual({ content: "# short trace\n" });

    const reply = buildTaskLogReply(model(), "x".repeat(TASK_TRACE_INLINE_LIMIT + 1));
    expect(reply.content).toContain("Trace 较长");
    expect(reply.files).toHaveLength(1);
  });
});

describe("handleTaskLog", () => {
  it("rejects unauthorized users before reading options or DB state", async () => {
    const interaction = {
      user: { id: "not-allowed" },
      reply: vi.fn(),
      options: { getString: vi.fn() },
    } as unknown as ChatInputCommandInteraction;

    await handleTaskLog(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({ content: "⛔ 无权限", ephemeral: true });
    expect(interaction.options.getString).not.toHaveBeenCalled();
  });
});
