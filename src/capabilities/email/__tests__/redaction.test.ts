import { describe, expect, it } from "vitest";
import { matchesAddressPattern, sanitizeEmailError, stripBodyForOutput } from "../redaction.js";
import type { EmailMessage } from "../types.js";

describe("email redaction", () => {
  it("matches exact and wildcard sender patterns", () => {
    expect(matchesAddressPattern("notice@mail.cmbchina.com", ["*.cmbchina.com"])).toBe(true);
    expect(matchesAddressPattern("notice@cmbchina.com", ["cmbchina.com"])).toBe(true);
    expect(matchesAddressPattern("notice@example.com", ["*.cmbchina.com"])).toBe(false);
  });

  it("redacts addresses and drops raw html body for provider output", () => {
    const message: EmailMessage = {
      id: "m1",
      profile: "p",
      folder: "INBOX",
      provider_uid: "1",
      message_id_hash: "sha256:x",
      received_at: "2026-05-07T10:00:00.000Z",
      from: { address: "user@example.com" },
      to: [{ address: "me@example.org" }],
      subject: "hello",
      text: "secret body",
      html: "<p>secret</p>",
      attachments: [],
    };

    const out = stripBodyForOutput(message);

    expect(out.from.address).toBe("[redacted]@example.com");
    expect(JSON.stringify(out)).not.toContain("<p>secret</p>");
    expect(out.text_excerpt).toBe("secret body");
  });

  it("sanitizes credentials from errors", () => {
    const text = sanitizeEmailError("password=super-secret token=abcdefghijklmnopqrstuvwxyz user@example.com");

    expect(text).not.toContain("super-secret");
    expect(text).not.toContain("user@example.com");
    expect(text).toContain("[email]");
  });
});
