import { describe, expect, it } from "vitest";
import { buildMarketIntelCalendarSnapshot, marketCalendarAt, parseTimeToMinutes } from "../../../stock/data/market-calendar.js";
import type { MarketIntelMarketConfig } from "../types.js";

describe("market-intel calendar guard", () => {
  const us: MarketIntelMarketConfig = {
    timezone: "America/New_York",
    sessions: [{ start: "09:30", end: "16:00" }],
    holidays: [],
    early_closes: [],
  };
  const cn: MarketIntelMarketConfig = {
    timezone: "Asia/Shanghai",
    sessions: [{ start: "09:30", end: "11:30" }, { start: "13:00", end: "15:00" }],
    holidays: [],
    early_closes: [],
  };
  const hk: MarketIntelMarketConfig = {
    timezone: "Asia/Hong_Kong",
    sessions: [{ start: "09:30", end: "12:00" }, { start: "13:00", end: "16:00" }],
    holidays: [],
    early_closes: [],
  };

  it("validates HH:mm times", () => {
    expect(parseTimeToMinutes("09:30")).toBe(570);
    expect(() => parseTimeToMinutes("24:00")).toThrow(/invalid/);
  });

  it("classifies US pre-market, open, after-close, weekend, and holiday states", () => {
    expect(marketCalendarAt(new Date("2026-05-08T12:45:00.000Z"), "us", us).status).toBe("pre_market");
    expect(marketCalendarAt(new Date("2026-05-08T13:45:00.000Z"), "us", us).status).toBe("open");
    expect(marketCalendarAt(new Date("2026-05-08T20:30:00.000Z"), "us", us).status).toBe("after_close");
    expect(marketCalendarAt(new Date("2026-05-09T13:45:00.000Z"), "us", us).reason).toBe("weekend");
    expect(marketCalendarAt(new Date("2026-05-08T13:45:00.000Z"), "us", { ...us, holidays: ["2026-05-08"] }).reason).toBe("holiday");
  });

  it("classifies CN lunch break and aggregates partial calendars", () => {
    expect(marketCalendarAt(new Date("2026-05-08T04:30:00.000Z"), "cn-a", cn).status).toBe("break");

    const snapshot = buildMarketIntelCalendarSnapshot({
      date: new Date("2026-05-08T01:00:00.000Z"),
      timezone: "Asia/Shanghai",
      markets: {
        "cn-a": cn,
        hk: { ...hk, holidays: ["2026-05-08"] },
      },
    });

    expect(snapshot.status).toBe("partial");
    expect(snapshot.tradable_markets).toEqual(["cn-a"]);
    expect(snapshot.closed_markets).toEqual(["hk"]);
  });

  it("applies early close overrides", () => {
    const earlyClose = marketCalendarAt(new Date("2026-12-24T18:30:00.000Z"), "us", {
      ...us,
      early_closes: [{ date: "2026-12-24", close: "13:00" }],
    });

    expect(earlyClose.status).toBe("after_close");
    expect(earlyClose.early_close).toBe("13:00");
    expect(earlyClose.sessions).toEqual([{ start: "09:30", end: "13:00" }]);
  });
});
