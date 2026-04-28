import { describe, it, expect } from "vitest";
import { taskCompleteEmbed, taskErrorEmbed } from "../formatter.js";

describe("taskCompleteEmbed", () => {
  it("renders 4 base fields", () => {
    const e = taskCompleteEmbed({
      taskId: "abc12345-xxx",
      result: "Done",
      durationMs: 5400,
      costUsd: 0.123456,
      turns: 7,
      sessionId: "sess-12345678-yyyy",
    });
    const data = e.toJSON();
    expect(data.title).toBe("✅ 任务完成");
    expect(data.description).toBe("Done");
    expect(data.fields?.map((f) => f.name)).toEqual(["耗时", "费用", "轮次", "Session"]);
    expect(data.fields?.find((f) => f.name === "耗时")?.value).toBe("5.4s");
    expect(data.fields?.find((f) => f.name === "费用")?.value).toBe("$0.1235");
  });

  it("includes Tokens field when tokensSummary provided", () => {
    const e = taskCompleteEmbed({
      taskId: "abc",
      result: "Done",
      durationMs: 1000,
      costUsd: 0.01,
      turns: 1,
      sessionId: "sess-yyy",
      tokensSummary: "in: 100 · out: 50",
    });
    const data = e.toJSON();
    const tokens = data.fields?.find((f) => f.name === "Tokens");
    expect(tokens?.value).toBe("in: 100 · out: 50");
    expect(tokens?.inline).toBe(false);
  });
});

describe("taskErrorEmbed", () => {
  it("renders error title and short id", () => {
    const e = taskErrorEmbed("abcdef12-xxx", "boom");
    const data = e.toJSON();
    expect(data.title).toBe("❌ 任务失败");
    expect(data.description).toBe("boom");
    expect(data.fields?.[0].value).toBe("abcdef12");
  });
});
