import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

let getAllMemories: typeof import("../../store/memory-md.js").getAllMemories;
let startMemoryMaintenanceScheduler: typeof import("../maintenance-scheduler.js").startMemoryMaintenanceScheduler;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "miniclaw-memory-maintenance-scheduler-"));
  process.env.MINICLAW_MEMORY_PATH = join(dir, "MEMORY.md");
  vi.useFakeTimers();
  vi.resetModules();
  ({ getAllMemories } = await import("../../store/memory-md.js"));
  ({ startMemoryMaintenanceScheduler } = await import("../maintenance-scheduler.js"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("memory maintenance scheduler", () => {
  it("periodically applies maintenance without requiring a Discord cron channel", () => {
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

    const handle = startMemoryMaintenanceScheduler({
      enabled: true,
      intervalMs: 1_000,
      apply: true,
      runOnStart: false,
    });

    vi.advanceTimersByTime(1_000);
    handle?.stop();

    expect(getAllMemories()).toHaveLength(0);
  });
});
