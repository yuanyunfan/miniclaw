import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "stage-store-"));
process.env.MINICLAW_DB_PATH = join(tmpDir, "test.db");
process.env.HOME = tmpDir; // 让 ~/.miniclaw/scenes 落到 tmp

vi.mock("../agent.js", () => ({ chatOnce: vi.fn(), __testables: {} }));

const { initDb, appendSceneMessage } = await import("../../store/db.js");
const { Orchestrator } = await import("../orchestrator.js");
const { saveScene, loadScene, __testables } = await import("../scene-store.js");
import type { Persona } from "../types.js";

initDb();
const ceo: Persona = { id: "ceo", name: "CEO", emoji: "🎩", systemPrompt: "" };
const eng: Persona = { id: "engineer", name: "Engineer", emoji: "💻", systemPrompt: "" };
const registry = new Map([["ceo", ceo], ["engineer", eng]]);

beforeEach(() => vi.clearAllMocks());

describe("saveScene", () => {
  it("写 transcript md + 更新 DB name + totals", () => {
    const orch = new Orchestrator({ registry });
    orch.summon("ceo");
    orch.userSay("hello");
    // 手 push 一个 ceo 消息（不走真实 chatOnce），同步写 DB
    const ceoMsg = { ts: Date.now(), speaker: "ceo", content: "hi @engineer", costUsd: 0.001, iters: 1 };
    orch.scene.messages.push(ceoMsg);
    appendSceneMessage({
      scene_id: orch.scene.id,
      ts: new Date(ceoMsg.ts).toISOString(),
      speaker: "ceo",
      content: "hi @engineer",
      cost_usd: 0.001,
    });
    orch.scene.totalCostUsd = 0.001;
    orch.scene.totalTurns = 1;

    const r = saveScene(orch, "test-save");
    expect(r.name).toBe("test-save");
    expect(existsSync(r.path)).toBe(true);
    const md = readFileSync(r.path, "utf8");
    expect(md).toContain("# MiniClaw Stage Scene");
    expect(md).toContain("CEO");
    expect(md).toContain("hi @engineer");
    expect(md).toContain("$0.0010");
  });
});

describe("loadScene", () => {
  it("按 name 找回 + 重建 messages + 推断 participants", () => {
    const orchA = new Orchestrator({ registry });
    orchA.summon("ceo");
    orchA.summon("engineer");
    orchA.userSay("启动");
    // 手插两条 + 同步 DB
    const sceneId = orchA.scene.id;
    const m1 = { ts: Date.now(), speaker: "ceo", content: "@engineer 看下", costUsd: 0.002 };
    const m2 = { ts: Date.now() + 1, speaker: "engineer", content: "好的", costUsd: 0.003 };
    orchA.scene.messages.push(m1, m2);
    appendSceneMessage({ scene_id: sceneId, ts: new Date(m1.ts).toISOString(), speaker: "ceo", content: m1.content, cost_usd: 0.002 });
    appendSceneMessage({ scene_id: sceneId, ts: new Date(m2.ts).toISOString(), speaker: "engineer", content: m2.content, cost_usd: 0.003 });
    orchA.scene.totalCostUsd = 0.005;
    orchA.scene.totalTurns = 2;
    saveScene(orchA, "load-test");

    const orchB = new Orchestrator({ registry });
    const r = loadScene(orchB, "load-test");
    expect(r.ok).toBe(true);
    expect(r.messageCount).toBe(3);
    expect(orchB.scene.totalCostUsd).toBeCloseTo(0.005, 4);
    expect(orchB.scene.totalTurns).toBe(2);
    expect(orchB.scene.participants.has("ceo")).toBe(true);
    expect(orchB.scene.participants.has("engineer")).toBe(true);
  });

  it("不存在的 name → 失败", () => {
    const orch = new Orchestrator({ registry });
    const r = loadScene(orch, "nonexistent");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("不存在");
  });
});

describe("renderTranscript", () => {
  it("包含 metadata + 时间戳 + tool calls", () => {
    const md = __testables.renderTranscript(
      "test-id",
      [
        { ts: 1700000000000, speaker: "user", content: "做事" },
        {
          ts: 1700000001000,
          speaker: "ceo",
          content: "好",
          toolCalls: [{ name: "bash", input: { command: "ls" } }],
          costUsd: 0.001,
        },
      ],
      registry,
      { totalCostUsd: 0.001, totalTurns: 1, mode: "manual" },
    );
    expect(md).toContain("scene_id");
    expect(md).toContain("test-id");
    expect(md).toContain("CEO");
    expect(md).toContain("`bash`");
  });
});
