import { describe, it, expect } from "vitest";
import { parseExplicitMemory } from "../parse.js";

describe("parseExplicitMemory", () => {
  it("parses Chinese 记住: prefix", () => {
    expect(parseExplicitMemory("记住: 我喜欢深色模式")).toEqual({
      type: "user",
      name: "我喜欢深色模式",
      content: "我喜欢深色模式",
    });
  });

  it("parses English remember prefix (case-insensitive)", () => {
    expect(parseExplicitMemory("Remember I prefer pnpm")?.content).toBe("I prefer pnpm");
    expect(parseExplicitMemory("REMEMBER: dark theme")?.content).toBe("dark theme");
  });

  it("parses /memory slash prefix", () => {
    expect(parseExplicitMemory("/memory: use pnpm not npm")?.content).toBe("use pnpm not npm");
  });

  it("returns null for unrelated text", () => {
    expect(parseExplicitMemory("hello world")).toBeNull();
    expect(parseExplicitMemory("")).toBeNull();
  });

  it("trims name to 30 chars and replaces newlines in name", () => {
    const long = "a".repeat(50) + "\nb";
    const result = parseExplicitMemory(`记住: ${long}`);
    expect(result?.name.length).toBeLessThanOrEqual(30);
    expect(result?.content).toContain("\nb");
  });

  it("returns null when content is empty after prefix", () => {
    expect(parseExplicitMemory("记住:")).toBeNull();
    expect(parseExplicitMemory("记住:   ")).toBeNull();
  });
});
