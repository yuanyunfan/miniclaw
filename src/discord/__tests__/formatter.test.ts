import { describe, it, expect } from "vitest";
import { healthEmbed, taskCompleteEmbed, taskErrorEmbed } from "../formatter.js";

describe("taskCompleteEmbed", () => {
  it("renders status metadata without embedding the full result", () => {
    const e = taskCompleteEmbed({
      taskId: "abc12345-xxx",
      durationMs: 5400,
      costUsd: 0.123456,
      turns: 7,
      sessionId: "sess-12345678-yyyy",
      provider: "codex",
      model: "gpt-5.5",
      cwd: "/repo",
      toolCount: 3,
    });
    const data = e.toJSON();
    expect(data.title).toBe("✅ 任务完成");
    expect(data.description).toBe("任务已完成，完整结果见下方普通 Markdown 消息。");
    expect(data.description).not.toContain("Done");
    expect(data.fields?.map((f) => f.name)).toEqual(["状态", "Provider / Model", "任务 ID", "耗时", "费用", "轮次", "Session", "工具调用", "工作目录"]);
    expect(data.fields?.find((f) => f.name === "Provider / Model")?.value).toBe("codex / gpt-5.5");
    expect(data.fields?.find((f) => f.name === "耗时")?.value).toBe("5.4s");
    expect(data.fields?.find((f) => f.name === "费用")?.value).toBe("$0.1235");
    expect(data.fields?.find((f) => f.name === "Session")?.value).toBe("claude:sess-123");
  });

  it("includes Tokens field when tokensSummary provided", () => {
    const e = taskCompleteEmbed({
      taskId: "abc",
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

describe("healthEmbed", () => {
  it("renders process, task and cron health fields", () => {
    const e = healthEmbed({
      provider: "claude",
      model: "claude-opus",
      uptimeSec: 3661,
      rssMb: 120.4,
      heapUsedMb: 45.2,
      activeTasks: 1,
      maxConcurrentTasks: 4,
      interruptedTasks: 2,
      scheduledJobs: 15,
      cronErrors: 0,
      openIncidents: 1,
      dbPath: "/tmp/miniclaw.db",
    });
    const data = e.toJSON();
    expect(data.title).toBe("🩺 MiniClaw Health");
    expect(data.fields?.map((f) => f.name)).toEqual(["Provider", "Uptime", "Memory", "Tasks", "Cron", "Doctor", "DB"]);
    expect(data.fields?.find((f) => f.name === "Tasks")?.value).toContain("1/4 active");
    expect(data.fields?.find((f) => f.name === "Doctor")?.value).toContain("1 open incident");
  });
});
