import { describe, it, expect } from "vitest";
import { chunkMessage } from "../chunks.js";

describe("chunkMessage", () => {
  it("returns single chunk when ≤ 2000 chars", () => {
    const text = "hello world";
    expect(chunkMessage(text)).toEqual([text]);
  });

  it("splits long text on newline boundaries", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i} ` + "x".repeat(30));
    const text = lines.join("\n");
    const chunks = chunkMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(2000));
  });

  it("preserves all content (no characters dropped)", () => {
    const text = "x".repeat(5000);
    const chunks = chunkMessage(text);
    const recombined = chunks.join("").replace(/\n```\n```\w*/g, "");
    expect(recombined.length).toBeGreaterThanOrEqual(5000);
  });

  it("balances code fences across split", () => {
    const text =
      "before\n```ts\n" +
      Array.from({ length: 100 }, () => "x".repeat(30)).join("\n") +
      "\n```\nafter";
    const chunks = chunkMessage(text);
    chunks.forEach((c) => {
      const fences = (c.match(/^```/gm) || []).length;
      expect(fences % 2).toBe(0);
    });
  });
});
