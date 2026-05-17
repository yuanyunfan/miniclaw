import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initDb, getDb } from "../db.js";
import {
  extractMarketContextJsonFromReport,
  findMarketContextDaily,
  listActiveMarketContextItems,
  recordMarketContextFromReport,
  stripMarketContextJsonForDisplay,
} from "../market-context.js";

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  getDb().prepare("DELETE FROM market_context_items").run();
  getDb().prepare("DELETE FROM market_context_daily").run();
});

describe("market context persistence", () => {
  it("extracts, stores, and reuses rolling market context items", () => {
    const report = [
      "# 美股长期市场记忆",
      "Fed 利率路径仍是跨资产定价主线。",
      "",
      "<market_context_json>",
      JSON.stringify({
        market_scope: "us",
        trade_date: "2026-05-15",
        digest_text: "Fed 利率路径仍是跨资产定价主线，AI capex 仍支撑纳指风险偏好。",
        active_items: [{
          stable_key: "fed-policy-path",
          topic: "Fed 利率路径",
          fact: "市场继续交易更久维持高利率的风险。",
          market_impact: "推高美债收益率波动，并压制长久期成长股估值。",
          affected_markets: ["us", "hk", "cn-a"],
          horizon: "1m",
          confidence: 0.72,
          source_urls: ["https://www.federalreserve.gov/"],
        }],
        new_items: [{
          stable_key: "ai-capex-cycle",
          topic: "AI capex",
          fact: "AI 基建投入继续支撑大型科技股盈利预期。",
          market_impact: "支撑纳指相对强势，但也提高财报失望风险。",
          affected_markets: ["us"],
          horizon: "3m",
          confidence: 0.65,
        }],
        resolved_items: [{
          stable_key: "old-inflation-print",
          topic: "旧通胀数据",
          fact: "上一期 CPI 冲击已被后续 FOMC 定价吸收。",
          market_impact: "不再作为独立活跃驱动。",
          affected_markets: ["us"],
          horizon: "done",
        }],
        data_quality: { sources: ["fed", "earnings"], warnings: [] },
      }, null, 2),
      "</market_context_json>",
    ].join("\n");

    const result = recordMarketContextFromReport({
      marketScope: "us",
      generatedAt: "2026-05-15T22:30:00.000Z",
      tradeDate: "2026-05-15",
      reportText: report,
    });

    expect(result).toMatchObject({ hasJson: true, upsertedItemCount: 3 });
    const daily = findMarketContextDaily("us", "2026-05-15");
    expect(daily?.digest_text).toContain("Fed 利率路径");
    expect(JSON.parse(daily?.active_items_json ?? "[]")).toHaveLength(1);

    const activeItems = listActiveMarketContextItems(["us"], "2026-05-16T00:00:00.000Z", 10);
    expect(activeItems.map((item) => item.stable_key)).toEqual(expect.arrayContaining(["ai-capex-cycle", "fed-policy-path"]));
    expect(activeItems).toHaveLength(2);
    expect(activeItems.find((item) => item.stable_key === "old-inflation-print")).toBeUndefined();
  });

  it("links a new daily context to the previous daily context", () => {
    const first = recordMarketContextFromReport({
      marketScope: "hk",
      generatedAt: "2026-05-14T10:00:00.000Z",
      tradeDate: "2026-05-14",
      reportText: "<market_context_json>{\"digest_text\":\"day one\",\"active_items\":[]}</market_context_json>",
    });
    const second = recordMarketContextFromReport({
      marketScope: "hk",
      generatedAt: "2026-05-15T10:00:00.000Z",
      tradeDate: "2026-05-15",
      reportText: "<market_context_json>{\"digest_text\":\"day two\",\"active_items\":[]}</market_context_json>",
    });

    expect(first.dailyId).toBeDefined();
    expect(second.dailyId).toBeDefined();
    expect(findMarketContextDaily("hk", "2026-05-15")?.previous_context_id).toBe(first.dailyId);
  });

  it("extracts fenced JSON and strips tagged machine JSON from display text", () => {
    const parsed = extractMarketContextJsonFromReport([
      "```market-context-json",
      "{\"market_scope\":\"cross-market\",\"digest_text\":\"FOMC is the global risk anchor\",\"active_items\":[]}",
      "```",
    ].join("\n"));

    expect(parsed?.market_scope).toBe("cross-market");
    const display = stripMarketContextJsonForDisplay("visible\n<market_context_json>{\"digest_text\":\"hidden\"}</market_context_json>");
    expect(display).toBe("visible");
  });
});
