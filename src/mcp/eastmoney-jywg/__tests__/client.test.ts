import { describe, expect, it } from "vitest";
import { HttpEastmoneyJywgClient } from "../client.js";
import type { EastmoneyJywgProfileConfig, EastmoneyJywgSession } from "../types.js";

const profile: EastmoneyJywgProfileConfig = {
  account_alias: "Eastmoney A",
  base_url: "https://jywg.18.cn",
  session_secret_path: "~/.miniclaw/secrets/eastmoney-jywg-session.json",
  browser_profile_dir: "~/.miniclaw/browser-profiles/eastmoney-jywg",
  snapshot_dir: "~/.miniclaw/providers/eastmoney-jywg-readonly/snapshots",
  redaction: "summary",
  top_positions_limit: 8,
  include_orders: false,
  include_deals: false,
  allow_non_jywg_host: false,
  fail_on_login_challenge: true,
  show_total_assets: false,
};

const session: EastmoneyJywgSession = {
  version: 1,
  host: "jywg.18.cn",
  cookies: [{ name: "sid", value: "abc", domain: ".18.cn", path: "/" }],
};

describe("HttpEastmoneyJywgClient", () => {
  it("extracts validatekey and queries only read-only endpoints", async () => {
    const seen: string[] = [];
    const fetchImpl = async (input: string | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/Trade/Buy")) {
        return new Response('<input id="em_validatekey" type="hidden" value="validate-123" />', {
          headers: { "set-cookie": "sid=next; Domain=.18.cn; Path=/; HttpOnly; Secure" },
        });
      }
      if (url.includes("/Com/queryAssetAndPositionV1")) {
        return Response.json({ Status: 0, Data: [{ Zzc: "101000", Zxsz: "80000", Kyzj: "21000", Drckyk: "1000" }] });
      }
      if (url.includes("/Search/GetStockList")) {
        return Response.json({ Status: 0, Data: [{ Zqdm: "600000", Zqmc: "浦发银行", Zqsl: "1000", Zxjg: "10", Drckyk: "100" }] });
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const client = new HttpEastmoneyJywgClient(fetchImpl);

    const raw = await client.getRawBrokerData(profile, session);

    expect(seen).toEqual([
      "https://jywg.18.cn/Trade/Buy",
      "https://jywg.18.cn/Com/queryAssetAndPositionV1?validatekey=validate-123",
      "https://jywg.18.cn/Search/GetStockList?validatekey=validate-123",
    ]);
    expect(raw.updated_session.cookies.find((cookie) => cookie.name === "sid")?.value).toBe("next");
    expect(raw.updated_session.last_verified_at).toBeTruthy();
  });

  it("maps Status=-2 to an expired session error", async () => {
    const fetchImpl = async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/Trade/Buy")) {
        return new Response('<input id="em_validatekey" type="hidden" value="validate-123" />');
      }
      return Response.json({ Status: -2, Message: "会话已超时，请重新登录!" });
    };
    const client = new HttpEastmoneyJywgClient(fetchImpl);

    await expect(client.getRawBrokerData(profile, session)).rejects.toThrow(/session expired/);
  });

  it("blocks redirects to non-jywg hosts", async () => {
    const fetchImpl = async () => new Response("", {
      status: 302,
      headers: { location: "https://example.com/Login" },
    });
    const client = new HttpEastmoneyJywgClient(fetchImpl);

    await expect(client.getRawBrokerData(profile, session)).rejects.toThrow(/blocked eastmoney-jywg redirect host/);
  });
});
