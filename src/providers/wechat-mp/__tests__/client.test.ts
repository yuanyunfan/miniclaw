import { describe, expect, it } from "vitest";
import { HttpWechatMpClient } from "../client.js";
import { WechatMpFrequencyControlError, WechatMpInvalidSessionError } from "../errors.js";
import type { WechatMpSession } from "../types.js";

const session: WechatMpSession = {
  token: "123456",
  cookies: [{ name: "slave_sid", value: "secret", domain: ".qq.com" }],
};

describe("HttpWechatMpClient", () => {
  it("passes token, cookie and query params to searchbiz", async () => {
    const seen: { url?: string; cookie?: string } = {};
    const client = new HttpWechatMpClient(session, async (input, init) => {
      seen.url = input.toString();
      seen.cookie = (init?.headers as Record<string, string>).Cookie;
      return Response.json({ ret: 0, list: [{ fakeid: "fake", nickname: "阿里云开发者" }] });
    });

    const result = await client.searchBiz("阿里云开发者");

    expect(result[0].fakeid).toBe("fake");
    expect(seen.url).toContain("/cgi-bin/searchbiz");
    expect(seen.url).toContain("token=123456");
    expect(seen.cookie).toBe("slave_sid=secret");
  });

  it("maps invalid session ret code", async () => {
    const client = new HttpWechatMpClient(session, async () => Response.json({ ret: 200003, err_msg: "Invalid Session" }));
    await expect(client.searchBiz("x")).rejects.toBeInstanceOf(WechatMpInvalidSessionError);
  });

  it("maps frequency control ret code", async () => {
    const client = new HttpWechatMpClient(session, async () => Response.json({ ret: 200013, err_msg: "frequency control" }));
    await expect(client.searchBiz("x")).rejects.toBeInstanceOf(WechatMpFrequencyControlError);
  });
});
