import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Attachment } from "discord.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { processAttachments, __testables } from "../attachments.js";

const { classify, safeName } = __testables;

function makeAtt(over: Partial<Attachment> & { name: string; size: number; contentType?: string | null; url?: string }): Attachment {
  return {
    name: over.name,
    size: over.size,
    contentType: over.contentType ?? null,
    url: over.url ?? `https://cdn.discordapp.com/attachments/${over.name}`,
    id: "0",
    proxyURL: "",
    height: null,
    width: null,
    description: null,
    ephemeral: false,
    duration: null,
    waveform: null,
    flags: { bitfield: 0 } as never,
    title: null,
  } as unknown as Attachment;
}

describe("classify", () => {
  it("png by mime", () => {
    expect(classify(makeAtt({ name: "a", size: 100, contentType: "image/png" }))).toBe("image");
  });
  it("jpeg by ext when mime missing", () => {
    expect(classify(makeAtt({ name: "a.jpg", size: 100 }))).toBe("image");
  });
  it("pdf", () => {
    expect(classify(makeAtt({ name: "a.pdf", size: 100, contentType: "application/pdf" }))).toBe("pdf");
  });
  it("md text by ext", () => {
    expect(classify(makeAtt({ name: "x.md", size: 100 }))).toBe("text");
  });
  it("audio by ext", () => {
    expect(classify(makeAtt({ name: "v.m4a", size: 100 }))).toBe("audio");
  });
  it("zip → binary", () => {
    expect(classify(makeAtt({ name: "x.zip", size: 100, contentType: "application/zip" }))).toBe("binary");
  });
});

describe("safeName", () => {
  it("strips path", () => expect(safeName("../../etc/passwd")).toBe("passwd"));
  it("keeps chinese", () => expect(safeName("赤峰大青山.pdf")).toBe("赤峰大青山.pdf"));
  it("strips weird chars", () => expect(safeName("a b c.txt")).toBe("a_b_c.txt"));
});

describe("processAttachments", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "miniclaw-att-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("空数组 → 空 blocks", async () => {
    const r = await processAttachments([], { scope: "s1" });
    expect(r.blocks).toEqual([]);
    expect(r.notices).toEqual([]);
  });

  it("图片 → base64 image block（下载）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    );
    const att = makeAtt({ name: "p.png", size: 4, contentType: "image/png", url: "https://cdn/p.png" });
    const r = await processAttachments([att], { scope: "s2" });
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png" },
    });
    expect((r.blocks[0] as { source: { data: string } }).source.data).toBe("iVBORw==");
  });

  it("PDF → base64 document block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from("%PDF-1.4"))
    );
    const att = makeAtt({ name: "doc.pdf", size: 8, contentType: "application/pdf" });
    const r = await processAttachments([att], { scope: "s3" });
    expect(r.blocks[0]).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf" },
      title: "doc.pdf",
    });
  });

  it("text → 下载 + 内联到 text block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from("hello\nworld"))
    );
    const att = makeAtt({ name: "x.md", size: 11, contentType: "text/markdown" });
    const r = await processAttachments([att], { scope: "s4" });
    expect(r.blocks[0]).toMatchObject({ type: "text" });
    expect((r.blocks[0] as { text: string }).text).toContain("hello");
    expect((r.blocks[0] as { text: string }).text).toContain('name="x.md"');
  });

  it("audio → notice，不出 block", async () => {
    const att = makeAtt({ name: "v.m4a", size: 1000, contentType: "audio/m4a" });
    const r = await processAttachments([att], { scope: "s5" });
    expect(r.blocks).toEqual([]);
    expect(r.notices[0]).toMatch(/语音/);
  });

  it("二进制 → 落盘 + 路径 text block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    );
    const att = makeAtt({ name: "x.zip", size: 4, contentType: "application/zip" });
    const r = await processAttachments([att], { cwd: dir, scope: "s6" });
    expect(r.blocks[0]).toMatchObject({ type: "text" });
    expect((r.blocks[0] as { text: string }).text).toContain("x.zip");
    expect((r.blocks[0] as { text: string }).text).toContain(".miniclaw-attachments/s6/");
    const path = join(dir, ".miniclaw-attachments", "s6", "x.zip");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it("超过 maxAttachmentMb 上限 → notice + 跳过", async () => {
    const att = makeAtt({ name: "huge.pdf", size: 500 * 1024 * 1024, contentType: "application/pdf" });
    const r = await processAttachments([att], { scope: "s7" });
    expect(r.blocks).toEqual([]);
    expect(r.notices[0]).toMatch(/超过.*MB 上限/);
  });

  it("超过 maxAttachments 数量上限 → notice + 截断", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    );
    const atts = Array.from({ length: 12 }, (_, i) =>
      makeAtt({ name: `${i}.png`, size: 4, contentType: "image/png" })
    );
    const r = await processAttachments(atts, { scope: "s8" });
    expect(r.blocks.length).toBe(10);
    expect(r.notices.find((n) => n.includes("10 个"))).toBeDefined();
  });
});
