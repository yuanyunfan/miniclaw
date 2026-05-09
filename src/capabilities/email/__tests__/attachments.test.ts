import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { normalizeEmailAttachment } from "../attachments.js";

describe("email attachments", () => {
  it("extracts text-like attachment content when explicitly allowed", () => {
    const out = normalizeEmailAttachment({
      filename: "statement.csv",
      contentType: "text/csv",
      size: 64,
      content: Buffer.from("交易商户,金额\n餐厅,人民币268.00元"),
    }, {
      includeContent: true,
      allowedExtensions: [".csv"],
      maxTextBytes: 1024,
    });

    expect(out.extraction?.status).toBe("extracted");
    expect(out.text).toContain("人民币268.00元");
  });

  it("extracts text entries from zip attachments", () => {
    const zipped = zipSync({
      "statement.csv": strToU8("交易商户,金额\n餐厅,人民币268.00元"),
      "ignore.pdf": new Uint8Array([1, 2, 3]),
    });

    const out = normalizeEmailAttachment({
      filename: "statement.zip",
      contentType: "application/zip",
      size: zipped.byteLength,
      content: Buffer.from(zipped),
    }, {
      includeContent: true,
      allowedExtensions: [".zip", ".csv"],
      maxTextBytes: 1024,
    });

    expect(out.extraction?.status).toBe("extracted");
    expect(out.text).toContain("[attachment:statement.csv]");
    expect(out.text).toContain("人民币268.00元");
  });

  it("skips disallowed attachment extensions", () => {
    const out = normalizeEmailAttachment({
      filename: "statement.pdf",
      contentType: "application/pdf",
      size: 64,
      content: Buffer.from("%PDF-1.4"),
    }, {
      includeContent: true,
      allowedExtensions: [".csv"],
      maxTextBytes: 1024,
    });

    expect(out.extraction).toMatchObject({ status: "skipped", reason: "extension not allowed: .pdf" });
    expect(out.text).toBeUndefined();
  });
});
