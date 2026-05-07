import { describe, expect, it } from "vitest";
import {
  buildSmartTaskPrompt,
  buildUntrustedRecentChatContext,
  referencesRecentContext,
} from "../context.js";

describe("recent chat context", () => {
  it("detects explicit references to prior context", () => {
    expect(referencesRecentContext("按照上面的方案开始实现")).toBe(true);
    expect(referencesRecentContext("implement your plan above")).toBe(true);
    expect(referencesRecentContext("修改 README 并跑测试")).toBe(false);
  });

  it("builds bounded untrusted context", () => {
    const text = buildUntrustedRecentChatContext(
      [
        { role: "user", content: "先分析方案" },
        { role: "assistant", content: "建议分三步实现" },
      ],
      { includeRecentWhenReferenced: true, recentTurns: 6, maxChars: 1000 }
    );
    expect(text).toContain('trust="untrusted"');
    expect(text).toContain("建议分三步实现");
  });

  it("injects context only when current task references it", () => {
    const rows = [{ role: "assistant", content: "计划：先改配置，再补测试" }];
    const withContext = buildSmartTaskPrompt("按你说的开始实现", rows, {
      includeRecentWhenReferenced: true,
      recentTurns: 6,
      maxChars: 1000,
    });
    const withoutContext = buildSmartTaskPrompt("修改 README", rows, {
      includeRecentWhenReferenced: true,
      recentTurns: 6,
      maxChars: 1000,
    });

    expect(withContext).toContain("<recent_chat_context");
    expect(withContext).toContain('<user_task priority="current">');
    expect(withoutContext).toBe("修改 README");
  });
});
