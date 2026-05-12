import { describe, expect, it } from "vitest";
import {
  formatDiagnosticValue,
  isSensitiveDiagnosticKey,
  redactDiagnosticText,
  redactDiagnosticValue,
} from "../diagnostic-redaction.js";

describe("diagnostic redaction", () => {
  it("redacts common credential, prompt, account, email, and phone text", () => {
    const text = redactDiagnosticText(`
      Authorization: Bearer abcdefghijklmnop
      Cookie: sid=secret
      token=abc123
      email=user@example.com
      phone=13800138000
      sk-1234567890abcdef
      prompt: this is a private prompt body
    `);

    expect(text).toBe(
      "Authorization: [REDACTED] Cookie: [REDACTED] token=[REDACTED] email=[redacted-email] phone=[redacted-phone] [REDACTED] prompt: [REDACTED]"
    );
  });

  it("classifies sensitive diagnostic keys and hashes session/account values", () => {
    expect(isSensitiveDiagnosticKey("session_id")).toBe(true);
    expect(isSensitiveDiagnosticKey("full_prompt")).toBe(true);
    expect(isSensitiveDiagnosticKey("provider")).toBe(false);

    expect(redactDiagnosticValue("session_id", "codex:session-1")).toMatch(/^\[redacted-session:[a-f0-9]{12}\]$/);
    expect(redactDiagnosticValue("account_number", "123456789012")).toMatch(/^\[redacted-account:[a-f0-9]{12}\]$/);
    expect(redactDiagnosticValue("market_session", "pre_market")).toBe("pre_market");
  });

  it("recursively redacts diagnostic objects before formatting", () => {
    const formatted = formatDiagnosticValue({
      provider: "codex",
      session_id: "codex:session-1",
      headers: { authorization: "Bearer abcdefghijklmnop" },
      nested: {
        message: "failed token=abc123",
      },
    });

    expect(formatted).toContain("\"provider\":\"codex\"");
    expect(formatted).toContain("\"session_id\":\"[redacted-session:");
    expect(formatted).toContain("\"headers\":\"[redacted-payload]\"");
    expect(formatted).toContain("token=[REDACTED]");
    expect(formatted).not.toContain("codex:session-1");
    expect(formatted).not.toContain("abcdefgh");
  });
});
