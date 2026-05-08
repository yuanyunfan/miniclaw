import { describe, expect, it } from "vitest";
import { buildStockPortfolioPayload, formatStockPortfolioPayload } from "../format.js";

describe("stock-portfolio formatter", () => {
  it("formats aggregate payload and redacts nested sensitive strings", () => {
    const payload = buildStockPortfolioPayload({
      generatedAt: new Date("2026-05-08T01:15:00.000Z"),
      profile: "daily-stock-market",
      sources: [
        {
          provider: "futu-stock",
          config: "daily-stock-market",
          status: "ok",
          payload: { source: "futu-opend-readonly", warning: "acc_id=123456789012" },
        },
        {
          provider: "eastmoney-jywg-readonly",
          config: "daily-stock-market",
          status: "error",
          error: "cookie=abcabcabcabcabcabcabcabcabcabc",
        },
      ],
    });

    const text = formatStockPortfolioPayload(payload);
    const parsed = JSON.parse(text);

    expect(parsed.source).toBe("stock-portfolio");
    expect(parsed.ok_count).toBe(1);
    expect(parsed.failed_count).toBe(1);
    expect(text).toContain("acc_id=[redacted]");
    expect(text).toContain("cookie=[redacted]");
    expect(text).not.toContain("123456789012");
  });
});
