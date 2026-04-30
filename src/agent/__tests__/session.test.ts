import { describe, it, expect } from "vitest";
import { assertProviderSession, displaySessionId, formatSessionId, parseSessionId } from "../session.js";

describe("provider session ids", () => {
  it("formats and parses prefixed ids", () => {
    const id = formatSessionId("codex", "thread-123456789");
    expect(id).toBe("codex:thread-123456789");
    expect(parseSessionId(id)).toEqual({ provider: "codex", id: "thread-123456789" });
  });

  it("treats historical raw ids as claude", () => {
    expect(parseSessionId("sess-abc")).toEqual({ provider: "claude", id: "sess-abc" });
  });

  it("rejects provider mismatch", () => {
    expect(() => assertProviderSession("claude:sess-abc", "codex")).toThrow(/无法恢复 claude session/);
  });

  it("displays provider and short raw id", () => {
    expect(displaySessionId("codex:thread-123456789")).toBe("codex:thread-1");
    expect(displaySessionId("sess-123456789")).toBe("claude:sess-123");
  });
});
