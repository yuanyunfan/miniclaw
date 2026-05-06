import { describe, expect, it } from "vitest";
import { buildCookieHeader, parseWechatMpSession, redactSessionForLog } from "../auth.js";

describe("wechat-mp auth", () => {
  it("parses a valid session and builds cookie header", () => {
    const session = parseWechatMpSession({
      token: "123456",
      cookies: [
        { name: "bizuin", value: "abc", domain: ".qq.com" },
        { name: "slave_sid", value: "sid", domain: ".qq.com" },
      ],
      saved_at: "2026-05-06T00:00:00.000Z",
    });

    expect(session.token).toBe("123456");
    expect(buildCookieHeader(session.cookies)).toBe("bizuin=abc; slave_sid=sid");
  });

  it("rejects malformed session objects", () => {
    expect(() => parseWechatMpSession({ token: "abc", cookies: [] })).toThrow(/token/);
    expect(() => parseWechatMpSession({ token: "123", cookies: [] })).toThrow(/cookies/);
  });

  it("redacts sensitive session fields for logging", () => {
    const redacted = redactSessionForLog({
      token: "123456",
      cookies: [{ name: "slave_sid", value: "secret" }],
      source_url: "https://mp.weixin.qq.com/cgi-bin/home?t=home/index&token=123456",
    });

    expect(redacted.token).toBe("<redacted>");
    expect(redacted.source_url).toContain("token=<redacted>");
    expect(JSON.stringify(redacted)).not.toContain("secret");
    expect(JSON.stringify(redacted)).not.toContain("123456");
  });
});
