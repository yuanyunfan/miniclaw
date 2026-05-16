import { describe, expect, it } from "vitest";
import { mapEastmoneyFundSelectorRow, runEastmoneyEtfPremiumProvider } from "../index.js";
import type { EastmoneyEtfPremiumClient, EastmoneyEtfPremiumProviderConfig } from "../types.js";

const config: EastmoneyEtfPremiumProviderConfig = {
  timeout_ms: 1000,
  concurrency: 2,
  symbols: [
    { code: "159513", name: "纳指大成" },
    { code: "159632", name: "纳斯达克" },
  ],
};

describe("eastmoney-etf-premium provider", () => {
  it("maps Eastmoney discount ratio to MiniClaw premium_rate", () => {
    const item = mapEastmoneyFundSelectorRow({ code: "159513", name: "纳指大成" }, {
      SECUCODE: "159513.SZ",
      SECURITY_CODE: "159513",
      SECURITY_NAME_ABBR: "纳斯达克100ETF大成",
      INDEX_NAME: "纳斯达克100",
      NEW_PRICE: 1.733,
      PREMIUM_DISCOUNT_RATIO: -2.51,
      DEC_NAV: 69.4975144373,
    }, "2026-05-16T07:30:02.000Z");

    expect(item).toMatchObject({
      code: "159513",
      name: "纳斯达克100ETF大成",
      data_source: "eastmoney_fund_selector",
      status: "ok",
      premium_rate: 2.51,
      eastmoney_discount_ratio: -2.51,
      latest_price: 1.733,
      dec_nav: 69.4975144373,
    });
  });

  it("formats public ETF premium payloads and marks missing rows explicitly", async () => {
    const client: EastmoneyEtfPremiumClient = {
      async getFundSelectorRow(code) {
        if (code === "159513") {
          return {
            SECUCODE: "159513.SZ",
            SECURITY_CODE: "159513",
            SECURITY_NAME_ABBR: "纳斯达克100ETF大成",
            NEW_PRICE: 1.733,
            PREMIUM_DISCOUNT_RATIO: -2.51,
          };
        }
        return undefined;
      },
    };

    const result = await runEastmoneyEtfPremiumProvider({
      configName: "cn-stock",
      jobName: "cn-stock-ing-market",
      channelId: "channel",
      runAt: new Date("2026-05-16T07:30:02.000Z"),
    }, {
      loadProviderConfig: () => config,
      client,
    });
    const parsed = JSON.parse(result.text);

    expect(parsed.source).toBe("eastmoney-etf-premium");
    expect(parsed.premium_summary.items).toEqual([
      expect.objectContaining({
        code: "159513",
        status: "ok",
        premium_rate: 2.51,
        eastmoney_discount_ratio: -2.51,
      }),
      expect.objectContaining({
        code: "159632",
        status: "missing_from_eastmoney_fund_selector",
      }),
    ]);
    expect(parsed.warnings).toEqual([
      "1 ETF premium row(s) missing PREMIUM_DISCOUNT_RATIO from Eastmoney fund selector.",
    ]);
  });
});
