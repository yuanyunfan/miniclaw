import { describe, expect, it } from "vitest";
import { DiscordTaskViewReporter, __testables } from "../task-view-reporter.js";

const {
  rawTaskMessages,
  buildExecutionSummary,
  buildRealtimeProgress,
} = __testables;

interface RecordedDiscordAction {
  type: "send" | "edit" | "delete";
  content?: string;
  embedTitles: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function payloadContent(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload;
  const content = asRecord(payload)?.content;
  if (content === undefined) return undefined;
  return String(content);
}

function embedTitle(embed: unknown): string | undefined {
  const record = asRecord(embed);
  const toJSON = record?.toJSON;
  const json = typeof toJSON === "function"
    ? asRecord((toJSON as () => unknown).call(embed))
    : asRecord(record?.data) ?? record;
  const title = json?.title;
  return typeof title === "string" ? title : undefined;
}

function recordDiscordAction(type: RecordedDiscordAction["type"], payload?: unknown): RecordedDiscordAction {
  const embeds = asRecord(payload)?.embeds;
  return {
    type,
    content: payloadContent(payload),
    embedTitles: Array.isArray(embeds) ? embeds.map(embedTitle).filter((title): title is string => Boolean(title)) : [],
  };
}

function createRecordedChannel(): { channel: { send: (payload: unknown) => Promise<unknown> }; actions: RecordedDiscordAction[] } {
  const actions: RecordedDiscordAction[] = [];
  let sendCount = 0;
  return {
    actions,
    channel: {
      send: async (payload: unknown) => {
        const action = recordDiscordAction("send", payload);
        actions.push(action);
        let content = action.content ?? "";
        return {
          id: `message-${++sendCount}`,
          get content() {
            return content;
          },
          edit: async (next: unknown) => {
            const editAction = recordDiscordAction("edit", next);
            actions.push(editAction);
            content = editAction.content ?? content;
          },
          delete: async () => {
            actions.push(recordDiscordAction("delete"));
          },
        };
      },
    },
  };
}

describe("task view formatting", () => {
  it("uses a fallback for empty successful raw output", () => {
    expect(rawTaskMessages("1234567890", {
      success: true,
      sessionId: "",
      costUsd: 0,
      durationMs: 0,
      turns: 0,
      result: "   ",
    })).toEqual(["[无文字回复]"]);
  });

  it("uses a fallback for empty failed raw output", () => {
    expect(rawTaskMessages("1234567890", {
      success: false,
      sessionId: "",
      costUsd: 0,
      durationMs: 0,
      turns: 0,
      result: "",
    })).toEqual(["❌ `12345678` 失败: 任务失败且无错误详情"]);
  });

  it("keeps a compact completed summary with recent tool steps", () => {
    const text = buildExecutionSummary("completed", {
      success: true,
      sessionId: "codex:thread-12345678",
      costUsd: 0,
      durationMs: 12_340,
      turns: 3,
      result: "done",
      tokensSummary: "in: 100 · out: 50",
    }, [
      "web_search: \"warp\"",
      "terminal: \"pnpm test\"",
    ], 2);

    expect(text).toContain("status: completed");
    expect(text).toContain("elapsed: 12.3s");
    expect(text).toContain("turns: 3");
    expect(text).toContain("tools: 2");
    expect(text).toContain("tokens: in: 100 · out: 50");
    expect(text).toContain("- terminal: \"pnpm test\"");
  });

  it("renders a running progress block even before tool events", () => {
    const text = buildRealtimeProgress([], 0, 0);

    expect(text).toContain("### Realtime Progress");
    expect(text).toContain("status: running");
    expect(text).toContain("tools: 0");
    expect(text).toContain("- waiting for SDK events");
  });

  it("keeps only the recent progress tail and reports omitted steps", () => {
    const lines = Array.from({ length: 30 }, (_, idx) => `step ${idx + 1}`);
    const text = buildRealtimeProgress(lines, 4, 30);

    expect(text).toContain("turns: 4");
    expect(text).toContain("tools: 30");
    expect(text).toContain("omitted: 5 earlier steps");
    expect(text).not.toContain("- step 5");
    expect(text).toContain("- step 6");
    expect(text).toContain("- step 30");
  });
});

describe("DiscordTaskViewReporter", () => {
  it("renders start, progress summary, completed status, and final markdown from view events", async () => {
    const { actions, channel } = createRecordedChannel();
    const reporter = new DiscordTaskViewReporter({
      taskId: "task-view-reporter-1",
      prompt: "summarize reporter boundary",
      cwd: "/tmp/work",
      channel: channel as never,
      provider: "codex",
      model: "gpt-test",
    });

    await reporter.start();
    await reporter.handle({ type: "turn_started", provider: "codex", turn: 2 });
    await reporter.handle({
      type: "tool_progress",
      provider: "codex",
      title: "terminal",
      detail: "pnpm test",
    });
    await reporter.handle({
      type: "tool_progress",
      provider: "codex",
      title: "terminal",
      detail: "pnpm test",
    });

    const snapshot = reporter.snapshot();
    await reporter.finish({
      success: true,
      sessionId: "codex:thread-12345678",
      costUsd: 0,
      durationMs: 2500,
      turns: 2,
      result: "final report",
      tokensSummary: "in: 1 · out: 2",
    }, "completed", snapshot);

    expect(actions.some((action) => action.type === "send" && action.embedTitles.includes("🔵 任务执行中"))).toBe(true);
    expect(actions.some((action) => action.type === "send" && action.content?.startsWith("### Realtime Progress"))).toBe(true);
    expect(snapshot).toMatchObject({
      lines: ["terminal: \"pnpm test\" (×2)"],
      turns: 2,
      toolCount: 2,
    });

    const completionSummary = actions.find((action) => action.type === "edit" && action.content?.startsWith("### Execution Summary"));
    expect(completionSummary?.content).toContain("status: completed");
    expect(completionSummary?.content).toContain("turns: 2");
    expect(completionSummary?.content).toContain("tools: 2");
    expect(completionSummary?.content).toContain("- terminal: \"pnpm test\" (×2)");
    expect(actions.some((action) => action.type === "edit" && action.embedTitles.includes("✅ 任务完成"))).toBe(true);
    expect(actions.filter((action) => action.type === "send").map((action) => action.content)).toContain("final report");
  });
});
