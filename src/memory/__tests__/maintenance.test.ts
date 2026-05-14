import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

let addMemory: typeof import("../../store/memory-md.js").addMemory;
let getAllMemories: typeof import("../../store/memory-md.js").getAllMemories;
let runMemoryMaintenance: typeof import("../maintenance.js").runMemoryMaintenance;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "miniclaw-memory-maintenance-"));
  process.env.MINICLAW_MEMORY_PATH = join(dir, "MEMORY.md");
  vi.resetModules();
  ({ addMemory, getAllMemories } = await import("../../store/memory-md.js"));
  ({ runMemoryMaintenance } = await import("../maintenance.js"));
});

describe("memory maintenance", () => {
  it("dry-run reports dirty JSON memories without changing the file", () => {
    const path = process.env.MINICLAW_MEMORY_PATH!;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `# MiniClaw Memory

## 🧑 user
[]
<!-- name="memory_json" id=aaaa -->

## 📋 project
（暂无）

## 💬 feedback
（暂无）

## 📚 reference
（暂无）
`);
    const report = runMemoryMaintenance({ dryRun: true });
    expect(report.findings).toEqual([
      expect.objectContaining({ kind: "dirty", action: "delete", id: "aaaa" }),
    ]);
    expect(getAllMemories()).toHaveLength(1);
  });

  it("apply deletes dirty memories and fills missing metadata", () => {
    const path = process.env.MINICLAW_MEMORY_PATH!;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `# MiniClaw Memory

## 🧑 user
[]
<!-- name="memory_json" id=aaaa -->
§
用户默认用中文回复
<!-- name="语言偏好" id=bbbb -->

## 📋 project
（暂无）

## 💬 feedback
（暂无）

## 📚 reference
（暂无）
`);
    const report = runMemoryMaintenance({ dryRun: false, now: new Date("2026-05-14T00:00:00.000Z") });
    expect(report.applied.some((finding) => finding.id === "aaaa" && finding.action === "delete")).toBe(true);
    const rows = getAllMemories();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "bbbb",
      status: "active",
      source: "legacy_import",
      ttl: "stable",
    });
    expect(rows[0].canonical_key).toBeTruthy();
  });

  it("apply archives stale volatile memories", () => {
    const row = addMemory("project", "旧 incident", "当前 MiniClaw 某任务失败，需要排查。", {
      ttl: "volatile",
      source: "auto_extract",
      now: "2026-01-01T00:00:00.000Z",
    });
    const report = runMemoryMaintenance({ dryRun: false, now: new Date("2026-05-14T00:00:00.000Z") });
    expect(report.applied.some((finding) => finding.id === row.id && finding.action === "archive")).toBe(true);
    expect(getAllMemories()[0]).toMatchObject({ status: "archived" });
  });
});
