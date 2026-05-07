import { describe, expect, it } from "vitest";
import { formatEmailQueryProviderResult } from "../format.js";
import type { EmailSearchResult } from "../../../capabilities/email/types.js";

describe("formatEmailQueryProviderResult", () => {
  it("redacts addresses and omits raw body by default", () => {
    const result: EmailSearchResult = {
      profile: "cmb",
      generated_at: "2026-05-07T14:00:00.000Z",
      query: { folders: ["INBOX"], max_results: 1 },
      warnings: [],
      messages: [{
        id: "m1",
        profile: "cmb",
        folder: "INBOX",
        provider_uid: "1",
        message_id_hash: "sha256:message",
        received_at: "2026-05-07T12:00:00.000Z",
        from: { address: "notice@example.com" },
        to: [{ address: "me@example.org" }],
        subject: "通知",
        snippet: "sensitive snippet",
        text: "sensitive body",
        html: "<p>sensitive</p>",
        attachments: [],
      }],
    };

    const text = formatEmailQueryProviderResult(result, {
      windowStart: new Date("2026-05-06T14:00:00.000Z"),
      windowEnd: new Date("2026-05-07T14:00:00.000Z"),
      skippedDuplicates: 0,
      includeBody: false,
    });

    expect(text).toContain("[redacted]@example.com");
    expect(text).not.toContain("sensitive snippet");
    expect(text).not.toContain("sensitive body");
    expect(text).not.toContain("<p>sensitive</p>");
  });
});
