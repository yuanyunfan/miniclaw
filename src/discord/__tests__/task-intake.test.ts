import { describe, expect, it } from "vitest";
import { formatTaskCompletionNotice, taskThreadName } from "../task-intake.js";

describe("task-intake helpers", () => {
  it("formats compact success completion notices", () => {
    expect(formatTaskCompletionNotice(
      { taskId: "12345678-aaaa-bbbb-cccc-dddddddddddd", threadId: "thread-1" },
      { success: true, durationMs: 12_345 }
    )).toBe("✅ 任务已完成: `12345678`，耗时 12.3s，结果见线程 <#thread-1>");
  });

  it("formats compact failure completion notices", () => {
    expect(formatTaskCompletionNotice(
      { taskId: "abcdef12-aaaa-bbbb-cccc-dddddddddddd", threadId: "thread-2" },
      { success: false, durationMs: 67_890 }
    )).toBe("❌ 任务未成功完成: `abcdef12`，耗时 67.9s，结果见线程 <#thread-2>");
  });

  it("keeps thread names compact", () => {
    expect(taskThreadName("  hello   world  ")).toBe("🤖 hello world");
  });
});
