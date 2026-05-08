import { describe, expect, it } from "vitest";
import { __testables } from "../smtp-email.js";

describe("smtp email notification helpers", () => {
  it("builds a plain text message and dot-stuffs body lines", () => {
    const body = __testables.buildMessage({
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      useSsl: true,
      username: "from@example.com",
      to: "to@example.com",
    }, {
      subject: "MiniClaw test",
      text: "line1\n.line2",
    });

    expect(body).toContain("From: from@example.com");
    expect(body).toContain("To: to@example.com");
    expect(body).toContain("Subject: MiniClaw test");
    expect(body).toContain("line1\r\n..line2");
  });

  it("sanitizes long token-like values from SMTP errors", () => {
    const secret = "abcdefghijklmnopqrstuvwxyz".repeat(2);
    const sanitized = __testables.sanitizeSmtpError(`password=${secret}`);
    expect(sanitized).toBe("password=[redacted]");
  });
});
