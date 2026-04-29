import { describe, expect, it, beforeEach } from "vitest";
import { loadPersonas, parseMentions, resetPersonasCache } from "../personas.js";

describe("loadPersonas", () => {
  beforeEach(() => resetPersonasCache());

  it("加载 repo personas/", () => {
    const { byId, errors } = loadPersonas();
    expect(errors).toEqual([]);
    expect(byId.has("ceo")).toBe(true);
    expect(byId.has("engineer")).toBe(true);
    expect(byId.has("tester")).toBe(true);
  });

  it("解析 frontmatter 字段", () => {
    const { byId } = loadPersonas();
    const ceo = byId.get("ceo")!;
    expect(ceo.name).toBe("CEO");
    expect(ceo.emoji).toBe("🎩");
    expect(ceo.systemPrompt).toContain("MiniClaw Stage");
    const engineer = byId.get("engineer")!;
    expect(engineer.tools).toEqual(["read_file", "bash", "web_fetch"]);
  });
});

describe("parseMentions", () => {
  const registry = new Map([
    ["ceo", { id: "ceo" } as const],
    ["engineer", { id: "engineer" } as const],
    ["tester", { id: "tester" } as const],
  ]) as unknown as Map<string, import("../types.js").Persona>;

  it("提取存在的 @mention", () => {
    expect(parseMentions("@engineer 看下", registry)).toEqual(["engineer"]);
  });

  it("忽略不存在的 @", () => {
    expect(parseMentions("@nobody hello", registry)).toEqual([]);
  });

  it("大小写不敏感 + 去重", () => {
    expect(parseMentions("@CEO @ceo @Engineer", registry)).toEqual(["ceo", "engineer"]);
  });

  it("多个不同 mentions 保序", () => {
    expect(parseMentions("先 @tester 再 @engineer", registry)).toEqual(["tester", "engineer"]);
  });
});
