import { describe, expect, it } from "vitest";
import { HttpEastmoneyMyfavorClient, __testables } from "../client.js";
import type { EastmoneyMyfavorProfileConfig, EastmoneyMyfavorSession } from "../types.js";

const profile: EastmoneyMyfavorProfileConfig = {
  account_alias: "Eastmoney MyFavor",
  base_url: "https://myfavor.eastmoney.com",
  appkey: "app-key",
  session_secret_path: "~/.miniclaw/secrets/eastmoney-myfavor-session.json",
  browser_profile_dir: "~/.miniclaw/browser-profiles/eastmoney-myfavor",
  timeout_ms: 8000,
};

const session: EastmoneyMyfavorSession = {
  version: 1,
  host: "myfavor.eastmoney.com",
  cookies: [{ name: "sid", value: "abc", domain: ".eastmoney.com", path: "/" }],
};

describe("HttpEastmoneyMyfavorClient", () => {
  it("parses JSONP groups and securities", async () => {
    const seen: string[] = [];
    const fetchImpl = async (input: string | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/v4/webouter/ggdefstkindexinfos")) {
        return new Response(`jQuery1({"state":true,"data":{"ginfolist":[{"gid":"1","gname":"美股"},{"gid":"2","gname":"港股"}]}})`);
      }
      if (url.includes("/v4/webouter/gstkinfos") && url.includes("g=1")) {
        return new Response(`jQuery2({"state":true,"data":{"stkinfolist":[{"security":"105$AAPL","sname":"Apple"}]}})`);
      }
      if (url.includes("/v4/webouter/gstkinfos") && url.includes("g=2")) {
        return new Response(`jQuery3({"state":true,"data":{"stkinfolist":[{"security":"116$00700","sname":"Tencent"}]}})`);
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const client = new HttpEastmoneyMyfavorClient(fetchImpl);

    const result = await client.getSecurities(profile, session, { groups: ["美股"], limit: 10 });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("/v4/webouter/ggdefstkindexinfos");
    expect(seen[1]).toContain("/v4/webouter/gstkinfos");
    expect(result.securities).toEqual([
      {
        group_id: "1",
        group_name: "美股",
        security: "105$AAPL",
        code: "AAPL",
        name: "Apple",
        market_flag: "105",
      },
    ]);
    expect(result.session.last_verified_at).toBeTruthy();
  });

  it("rejects missing appkey before making a request", async () => {
    const client = new HttpEastmoneyMyfavorClient(async () => {
      throw new Error("should not fetch");
    });

    await expect(client.getGroups({ ...profile, appkey: "" }, session)).rejects.toThrow(/appkey is required/);
  });

  it("exposes parser helpers for fixed payload shapes", () => {
    const groupsPayload = __testables.parseJsonp(`cb({"state":"1","data":{"ginfolist":[{"gid":3,"gname":"ETF"}]}})`);
    expect(__testables.groupRows(groupsPayload as Record<string, unknown>)).toEqual([{ gid: "3", gname: "ETF" }]);

    const securitiesPayload = __testables.parseJsonp(`cb({"state":true,"data":{"stkinfolist":[{"security":"1$600000","stockname":"浦发银行"}]}})`);
    expect(__testables.securityRows(securitiesPayload as Record<string, unknown>, { gid: "3", gname: "ETF" })).toEqual([
      {
        group_id: "3",
        group_name: "ETF",
        security: "1$600000",
        code: "600000",
        name: "浦发银行",
        market_flag: "1",
      },
    ]);
    expect(__testables.securityCode("106$BRK.B")).toEqual({ marketFlag: "106", code: "BRK.B" });
  });

  it("detects login challenge and non-JSONP responses", () => {
    expect(() => __testables.parseJsonp("<html>login</html>")).toThrow(/login challenge/);
    expect(() => __testables.parseJsonp("not-jsonp")).toThrow(/non-JSONP/);
  });
});
