import { describe, expect, it } from "vitest";
import { __testables } from "../agent.js";
import type { Persona, SceneMessage } from "../types.js";

const { buildMessages, extractMentionIds, estimateCost } = __testables;

const ceo: Persona = {
  id: "ceo",
  name: "CEO",
  emoji: "🎩",
  systemPrompt: "你是 CEO",
};

describe("buildMessages", () => {
  it("空 history → 单条占位", () => {
    const msgs = buildMessages(ceo, []);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
  });

  it("user 消息标 [user]", () => {
    const history: SceneMessage[] = [{ ts: 1, speaker: "user", content: "做个登录页" }];
    const msgs = buildMessages(ceo, history);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("[user] 做个登录页");
  });

  it("自己说的话 → assistant 角色", () => {
    const history: SceneMessage[] = [
      { ts: 1, speaker: "user", content: "做个登录页" },
      { ts: 2, speaker: "ceo", content: "@engineer 你来写" },
    ];
    const msgs = buildMessages(ceo, history);
    expect(msgs).toHaveLength(3); // user + assistant + 占位 user (因 last role 是 assistant)
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toContain("@engineer 你来写");
    expect(msgs[2].role).toBe("user");
  });

  it("别的 persona 说的话 → user 角色，标 @speaker", () => {
    const history: SceneMessage[] = [
      { ts: 1, speaker: "engineer", content: "已完成" },
    ];
    const msgs = buildMessages(ceo, history);
    expect(msgs[0].content).toContain("[@engineer] 已完成");
  });

  it("连续 user/其他 chunks 合并到一条", () => {
    const history: SceneMessage[] = [
      { ts: 1, speaker: "user", content: "需求 A" },
      { ts: 2, speaker: "engineer", content: "我做了 B" },
      { ts: 3, speaker: "tester", content: "测了 C" },
    ];
    const msgs = buildMessages(ceo, history);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("[user] 需求 A");
    expect(msgs[0].content).toContain("[@engineer] 我做了 B");
    expect(msgs[0].content).toContain("[@tester] 测了 C");
  });
});

describe("extractMentionIds", () => {
  it("过滤自指", () => {
    expect(extractMentionIds("@ceo 你好", "ceo")).toEqual([]);
  });

  it("提取并 lowercase", () => {
    expect(extractMentionIds("@Engineer 干活", "ceo")).toEqual(["engineer"]);
  });

  it("去重保序", () => {
    expect(extractMentionIds("@a @b @a", "x")).toEqual(["a", "b"]);
  });
});

describe("estimateCost", () => {
  it("sonnet 价位", () => {
    // 1M in + 1M out = $3 + $15 = $18
    expect(estimateCost("claude-sonnet-4-6", 1_000_000, 1_000_000, 0, 0)).toBeCloseTo(18, 1);
  });

  it("opus 价位（贵 5x）", () => {
    // 1M in + 1M out = $15 + $75 = $90
    expect(estimateCost("claude-opus-4-7", 1_000_000, 1_000_000, 0, 0)).toBeCloseTo(90, 1);
  });

  it("cache hit 显著省钱", () => {
    // 1M cache hit (sonnet) = $0.30，远小于 $3
    const noCache = estimateCost("claude-sonnet-4-6", 1_000_000, 0, 0, 0);
    const withCache = estimateCost("claude-sonnet-4-6", 0, 0, 1_000_000, 0);
    expect(withCache).toBeLessThan(noCache / 5);
  });
});
