import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 重要：在 import 前设 env，让 config.dbPath 指向临时 DB
const tmpDir = mkdtempSync(join(tmpdir(), "stage-orch-"));
process.env.MINICLAW_DB_PATH = join(tmpDir, "test.db");
process.env.MINICLAW_STAGE_BUDGET_USD = "0.05";  // 故意调极小，方便测 budget cap
process.env.MINICLAW_STAGE_TURN_CAP = "5";

// mock chatOnce 返回固定结果（避免真实 LLM 调用）
vi.mock("../agent.js", () => ({
  chatOnce: vi.fn(),
  __testables: {},
}));

const { chatOnce } = await import("../agent.js");
const { initDb } = await import("../../store/db.js");
const { Orchestrator } = await import("../orchestrator.js");
const { parseCommand, applyCommand } = await import("../commands.js");
import type { Persona, ChatOnceResult } from "../types.js";

initDb();

const ceo: Persona = { id: "ceo", name: "CEO", emoji: "🎩", systemPrompt: "" };
const eng: Persona = { id: "engineer", name: "Engineer", emoji: "💻", systemPrompt: "" };
const tester: Persona = { id: "tester", name: "Tester", emoji: "🧪", systemPrompt: "" };
const registry = new Map([["ceo", ceo], ["engineer", eng], ["tester", tester]]);

function mockReply(content: string, costUsd = 0.001, mentions: string[] = []): ChatOnceResult {
  return {
    content,
    mentions,
    toolCalls: [],
    costUsd,
    iters: 1,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    aborted: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function flushQueue(orch: any, maxWait = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (!(orch as any).running && !(orch as any).queue.length) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("Orchestrator: summon/dismiss", () => {
  it("summon 添加 participant 并 emit", () => {
    const orch = new Orchestrator({ registry });
    const evt: string[][] = [];
    orch.on("participants", (ids) => evt.push(ids));
    expect(orch.summon("ceo").ok).toBe(true);
    expect(orch.scene.participants.has("ceo")).toBe(true);
    expect(evt[0]).toEqual(["ceo"]);
  });

  it("summon 不存在 persona 失败", () => {
    const orch = new Orchestrator({ registry });
    expect(orch.summon("ghost").ok).toBe(false);
  });

  it("summon 重复返回 ok=false", () => {
    const orch = new Orchestrator({ registry });
    orch.summon("ceo");
    expect(orch.summon("ceo").ok).toBe(false);
  });

  it("dismiss 移除 participant", () => {
    const orch = new Orchestrator({ registry });
    orch.summon("ceo");
    expect(orch.dismiss("ceo").ok).toBe(true);
    expect(orch.scene.participants.has("ceo")).toBe(false);
  });
});

describe("Orchestrator: routing via @mention", () => {
  it("user @ceo → ceo 接到调用", async () => {
    (chatOnce as any).mockResolvedValue(mockReply("ok"));
    const orch = new Orchestrator({ registry });
    orch.summon("ceo");
    orch.userSay("@ceo 你好");
    await flushQueue(orch);
    expect(chatOnce).toHaveBeenCalledTimes(1);
    expect((chatOnce as any).mock.calls[0][0].id).toBe("ceo");
  });

  it("ceo 回复里 @engineer → engineer 接力", async () => {
    (chatOnce as any)
      .mockResolvedValueOnce(mockReply("分活给 @engineer", 0.001, ["engineer"]))
      .mockResolvedValueOnce(mockReply("done"));
    const orch = new Orchestrator({ registry });
    orch.summon("ceo");
    orch.summon("engineer");
    orch.userSay("@ceo 做事");
    await flushQueue(orch);
    expect(chatOnce).toHaveBeenCalledTimes(2);
    expect((chatOnce as any).mock.calls[1][0].id).toBe("engineer");
  });

  it("@ 已注册但未召唤 → emit warn 提示先 /summon", async () => {
    const orch = new Orchestrator({ registry });
    orch.summon("ceo");
    const notices: string[] = [];
    orch.on("notice", (lvl, t) => lvl === "warn" && notices.push(t));
    orch.userSay("@tester 你来"); // tester 在 registry 但未 summon
    await flushQueue(orch);
    expect(notices.some((n) => n.includes("tester"))).toBe(true);
  });

  it("自指 @ 被 chatOnce 过滤（已在 agent.test 验证），orchestrator 不重入", async () => {
    (chatOnce as any).mockResolvedValue(mockReply("self loop", 0.001, []));  // mentions 已被 chatOnce 过滤
    const orch = new Orchestrator({ registry });
    orch.summon("ceo");
    orch.userSay("@ceo go");
    await flushQueue(orch);
    expect(chatOnce).toHaveBeenCalledTimes(1);
  });
});

describe("Orchestrator: anti-loop / budget / turn caps", () => {
  it("budget cap 触发 → pause + 清空队列", async () => {
    (chatOnce as any).mockResolvedValue(mockReply("贵的回复", 0.06));  // 一发就超 0.05 cap
    const orch = new Orchestrator({ registry });
    orch.summon("ceo");
    orch.summon("engineer");
    let pauseReason = "";
    orch.on("pause", (r) => (pauseReason = r));
    orch.userSay("@ceo @engineer go");
    await flushQueue(orch);
    expect(pauseReason).toContain("budget");
    expect((orch as any).queue.length).toBe(0);
  });

  it("turn cap 触发 → pause（互 @ 死循环场景）", async () => {
    // ceo @ engineer，engineer @ ceo，无限互弹
    (chatOnce as any).mockImplementation(async (p: Persona) => {
      const next = p.id === "ceo" ? "engineer" : "ceo";
      return mockReply(`你来 @${next}`, 0.001, [next]);
    });
    const orch = new Orchestrator({ registry });
    orch.summon("ceo");
    orch.summon("engineer");
    let pauseReason = "";
    orch.on("pause", (r) => (pauseReason = r));
    orch.userSay("@ceo go");
    await flushQueue(orch, 5000);
    // turnCap=5（env 设的），应该在 5 turn 处 pause
    expect(orch.scene.totalTurns).toBeLessThanOrEqual(6);
    expect(pauseReason).toMatch(/turn cap|budget/);
  }, 8000);
});

describe("commands.parseCommand", () => {
  it("普通文本 → say", () => {
    expect(parseCommand("hello").kind).toBe("say");
  });
  it("/summon a b", () => {
    const a = parseCommand("/summon ceo engineer");
    expect(a).toMatchObject({ kind: "summon", ids: ["ceo", "engineer"] });
  });
  it("/dismiss x", () => {
    expect(parseCommand("/dismiss ceo")).toMatchObject({ kind: "dismiss", id: "ceo" });
  });
  it("/auto", () => {
    expect(parseCommand("/auto")).toMatchObject({ kind: "mode", mode: "auto" });
  });
  it("/q /quit /exit 都退出", () => {
    expect(parseCommand("/q").kind).toBe("quit");
    expect(parseCommand("/quit").kind).toBe("quit");
    expect(parseCommand("/exit").kind).toBe("quit");
  });
  it("未知命令", () => {
    expect(parseCommand("/nope").kind).toBe("unknown");
  });
  it("空 /summon 失败", () => {
    expect(parseCommand("/summon").kind).toBe("unknown");
  });
});

describe("applyCommand → orchestrator 副作用", () => {
  it("/summon 多个 → 全部 summon", () => {
    const orch = new Orchestrator({ registry });
    const r = applyCommand(parseCommand("/summon ceo engineer"), orch);
    expect(r.kind).toBe("ok");
    expect(orch.scene.participants.size).toBe(2);
  });

  it("/cost 输出文本含 scene 摘要", () => {
    const orch = new Orchestrator({ registry });
    orch.summon("ceo");
    const r = applyCommand(parseCommand("/cost"), orch);
    expect(r.kind).toBe("ok");
    expect((r as any).text).toContain("Scene");
    expect((r as any).text).toContain("$0.0000");
  });

  it("/roster 列出 in/out 状态", () => {
    const orch = new Orchestrator({ registry });
    orch.summon("ceo");
    const r = applyCommand(parseCommand("/roster"), orch);
    expect((r as any).text).toContain("ceo");
    expect((r as any).text).toContain("在场");
    expect((r as any).text).toContain("待召唤");
  });
});
