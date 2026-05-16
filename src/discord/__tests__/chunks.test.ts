import { describe, it, expect } from "vitest";
import {
  chunkMessage,
  chunkMessageWithDeferredLinkPreviews,
  extractPreviewLinks,
} from "../chunks.js";

describe("chunkMessage", () => {
  it("returns single chunk when ≤ 2000 chars", () => {
    const text = "hello world";
    expect(chunkMessage(text)).toEqual([text]);
  });

  it("uses fallback for blank text so callers never send an empty Discord message", () => {
    expect(chunkMessage("")).toEqual(["[无文字回复]"]);
    expect(chunkMessage(" \n\t ", "fallback")).toEqual(["fallback"]);
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

  it("keeps chunks under Discord limit when closing an open code fence", () => {
    const text = "```ts\n" + "x".repeat(1994) + "\nmore";
    const chunks = chunkMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(2000));
  });

  it("extracts unique preview links and trims markdown punctuation", () => {
    expect(extractPreviewLinks([
      "A [link](https://example.com/a).",
      "B https://example.com/b,",
      "No embed <https://example.com/no-preview>",
      "Again https://example.com/a",
    ].join("\n"))).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("does not create preview footer for Discord no-embed angle bracket links", () => {
    const chunks = chunkMessageWithDeferredLinkPreviews(
      [
        "- **A** · <https://example.com/a>",
        "- **B** · <https://example.com/b>",
      ].join("\n"),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      kind: "body",
      suppressEmbeds: false,
    });
    expect(chunks[0]?.content).not.toContain("链接预览集中区");
  });

  it("defers link previews to a final footer chunk", () => {
    const chunks = chunkMessageWithDeferredLinkPreviews(
      "正文保留 https://example.com/a 和 [B](https://example.com/b)。",
    );

    expect(chunks[0]).toMatchObject({
      kind: "body",
      suppressEmbeds: true,
    });
    expect(chunks[chunks.length - 1]).toMatchObject({
      kind: "link_preview_footer",
      suppressEmbeds: false,
    });
    expect(chunks[chunks.length - 1]?.content).toContain("链接预览集中区");
    expect(chunks[chunks.length - 1]?.content).toContain("https://example.com/a");
    expect(chunks[chunks.length - 1]?.content).toContain("https://example.com/b");
  });
});
