import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let addMemory: typeof import("../../store/memory-md.js").addMemory;
let getAllMemories: typeof import("../../store/memory-md.js").getAllMemories;
let curateAndApplyMemoryCandidates: typeof import("../curation.js").curateAndApplyMemoryCandidates;
let decideMemoryMerge: typeof import("../curation.js").decideMemoryMerge;
let validateMemoryCandidate: typeof import("../curation.js").validateMemoryCandidate;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "miniclaw-memory-curation-"));
  process.env.MINICLAW_MEMORY_PATH = join(dir, "MEMORY.md");
  vi.resetModules();
  ({ addMemory, getAllMemories } = await import("../../store/memory-md.js"));
  ({ curateAndApplyMemoryCandidates, decideMemoryMerge, validateMemoryCandidate } = await import("../curation.js"));
});

describe("memory curation", () => {
  it("rejects dirty auto-extracted JSON content", () => {
    expect(validateMemoryCandidate({ type: "user", name: "json", content: "[]" }).ok).toBe(false);
    expect(validateMemoryCandidate({
      type: "user",
      name: "macOS多机使用",
      content: "[{\"type\":\"user\",\"name\":\"x\",\"content\":\"y\"}]",
    }).ok).toBe(false);
  });

  it("rejects invalid auto-extracted types instead of silently storing as user", () => {
    const result = validateMemoryCandidate({ type: "bogus", name: "x", content: "用户偏好中文回复" });
    expect(result).toMatchObject({ ok: false });
  });

  it("updates same canonical key instead of creating duplicate rows", () => {
    addMemory("feedback", "Chat 模式能力限制", "Chat 模式只有只读工具，没有 Write/Edit 能力。", {
      canonical_key: "feedback:chat模式能力限制",
      source: "legacy_import",
      ttl: "stable",
    });

    const results = curateAndApplyMemoryCandidates([
      {
        type: "feedback",
        name: "Chat 模式能力限制",
        content: "Chat 模式只有只读 + 调研工具，没有 Write/Edit/Agent 能力；修改文件需要用 /task。",
        confidence: 0.95,
      },
    ]);

    expect(results[0].decision.action).toBe("update");
    expect(getAllMemories()).toHaveLength(1);
    expect(getAllMemories()[0].content).toContain("/task");
  });

  it("treats exact normalized content as noop", () => {
    const existing = addMemory("user", "语言偏好", "用户默认使用中文回复。", {
      source: "manual",
      ttl: "stable",
    });
    const validation = validateMemoryCandidate({
      type: "user",
      name: "默认语言",
      content: "用户默认使用中文回复。",
      confidence: 0.9,
    });
    expect(validation.ok).toBe(true);
    const decision = decideMemoryMerge(validation.candidate!, [existing]);
    expect(decision).toMatchObject({ action: "noop", targetId: existing.id });
  });
});
