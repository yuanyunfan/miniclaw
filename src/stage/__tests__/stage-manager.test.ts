import { describe, expect, it } from "vitest";
import { __testables } from "../stage-manager.js";
import type { Persona } from "../types.js";

const { parseDecision } = __testables;

const personas: Persona[] = [
  { id: "ceo", name: "CEO", emoji: "🎩", systemPrompt: "" },
  { id: "engineer", name: "Engineer", emoji: "💻", systemPrompt: "" },
];

describe("parseDecision", () => {
  it("纯 JSON 输出", () => {
    const r = parseDecision('{"next_speaker":"engineer","reason":"需要写代码"}', personas);
    expect(r.next).toBe("engineer");
    expect(r.reason).toBe("需要写代码");
  });

  it("含前缀文字也能提取（容错）", () => {
    const r = parseDecision('好的，决定是 {"next_speaker":"ceo","reason":"汇报"}', personas);
    expect(r.next).toBe("ceo");
  });

  it("'user' 透传", () => {
    const r = parseDecision('{"next_speaker":"user","reason":"等用户决定"}', personas);
    expect(r.next).toBe("user");
  });

  it("'end' 透传", () => {
    const r = parseDecision('{"next_speaker":"end","reason":"结束"}', personas);
    expect(r.next).toBe("end");
  });

  it("不存在的 persona → fallback user", () => {
    const r = parseDecision('{"next_speaker":"ghost","reason":"x"}', personas);
    expect(r.next).toBe("user");
  });

  it("不是 JSON → fallback user", () => {
    const r = parseDecision("我觉得让 engineer 来", personas);
    expect(r.next).toBe("user");
  });

  it("大小写归一化", () => {
    const r = parseDecision('{"next_speaker":"Engineer","reason":"x"}', personas);
    expect(r.next).toBe("engineer");
  });
});
