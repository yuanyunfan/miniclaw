import { describe, expect, it } from "vitest";
import { buildFakeChatReply, buildFakeTaskResult, extractE2eRunId } from "../fake-agent.js";

describe("E2E fake agent", () => {
  it("extracts stable run ids from chat, task and follow-up prompts", () => {
    expect(extractE2eRunId("e2e chat run-123")).toBe("run-123");
    expect(extractE2eRunId("please e2e task abc_456 now")).toBe("abc_456");
    expect(extractE2eRunId("e2e followup run.789")).toBe("run.789");
    expect(extractE2eRunId("[cron:e2e-task] e2e task cron-run-1")).toBe("cron-run-1");
  });

  it("returns deterministic chat and task sentinels", () => {
    expect(buildFakeChatReply("e2e chat run-123").reply).toBe("E2E_CHAT_OK run-123");
    expect(buildFakeTaskResult("e2e task run-123", "codex")).toMatchObject({
      reply: "E2E_TASK_OK run-123",
      sessionId: "codex:e2e-run-123",
      tokensSummary: "in=17 out=9 cacheR=0 cacheW=0",
    });
  });
});
