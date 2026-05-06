import { describe, it, expect } from "vitest";
import { __testables } from "../task.js";

const { fmtTokens, formatUsage, finalTaskStatus, rawTaskMessages } = __testables;

describe("fmtTokens", () => {
  it("returns '-' for undefined / null", () => {
    expect(fmtTokens(undefined)).toBe("-");
    expect(fmtTokens(null as unknown as undefined)).toBe("-");
  });
  it("returns plain number under 1000", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(999)).toBe("999");
  });
  it("formats K under 1M", () => {
    expect(fmtTokens(1000)).toBe("1.0K");
    expect(fmtTokens(24500)).toBe("24.5K");
    expect(fmtTokens(999_999)).toBe("1000.0K");
  });
  it("formats M for ≥ 1M", () => {
    expect(fmtTokens(1_000_000)).toBe("1.00M");
    expect(fmtTokens(2_345_678)).toBe("2.35M");
  });
});

describe("formatUsage", () => {
  it("returns undefined for falsy input", () => {
    expect(formatUsage(undefined)).toBeUndefined();
    expect(formatUsage(null)).toBeUndefined();
    expect(formatUsage("not an object")).toBeUndefined();
  });
  it("returns undefined for empty object", () => {
    expect(formatUsage({})).toBeUndefined();
  });
  it("formats all 4 fields", () => {
    expect(formatUsage({
      input_tokens: 9,
      output_tokens: 2600,
      cache_read_input_tokens: 124800,
      cache_creation_input_tokens: 4900,
    })).toBe("in: 9 · out: 2.6K · cache hit: 124.8K · cache write: 4.9K");
  });
  it("skips cache fields when zero", () => {
    expect(formatUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })).toBe("in: 100 · out: 50");
  });
  it("formats partial fields (only output)", () => {
    expect(formatUsage({ output_tokens: 1500 })).toBe("out: 1.5K");
  });
});

describe("finalTaskStatus", () => {
  it("preserves completed/failed when not cancelled", () => {
    const ctrl = new AbortController();
    expect(finalTaskStatus("task-a", ctrl, true)).toBe("completed");
    expect(finalTaskStatus("task-a", ctrl, false)).toBe("failed");
  });

  it("maps aborted controller to cancelled", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(finalTaskStatus("task-a", ctrl, false)).toBe("cancelled");
  });
});

describe("rawTaskMessages", () => {
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
});
