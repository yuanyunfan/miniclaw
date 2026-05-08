import { describe, expect, it } from "vitest";
import { isActiveWindow, isMarketOpen, openMarketsAt } from "../market.js";
import type { StockPulseMarketConfig } from "../types.js";

describe("stock-pulse market guard", () => {
  const cn: StockPulseMarketConfig = {
    timezone: "Asia/Shanghai",
    sessions: [{ start: "09:30", end: "11:30" }, { start: "13:00", end: "15:00" }],
    holidays: [],
  };

  it("handles Beijing active window crossing midnight", () => {
    const window = { timezone: "Asia/Shanghai", start: "09:30", end: "01:00" };
    expect(isActiveWindow(new Date("2026-05-08T01:30:00.000Z"), window)).toBe(true);
    expect(isActiveWindow(new Date("2026-05-08T16:30:00.000Z"), window)).toBe(true);
    expect(isActiveWindow(new Date("2026-05-08T18:00:00.000Z"), window)).toBe(false);
  });

  it("honors market sessions, lunch break, weekends, and holidays", () => {
    expect(isMarketOpen(new Date("2026-05-08T02:00:00.000Z"), cn)).toBe(true);
    expect(isMarketOpen(new Date("2026-05-08T04:00:00.000Z"), cn)).toBe(false);
    expect(isMarketOpen(new Date("2026-05-09T02:00:00.000Z"), cn)).toBe(false);
    expect(isMarketOpen(new Date("2026-05-08T02:00:00.000Z"), { ...cn, holidays: ["2026-05-08"] })).toBe(false);
  });

  it("returns only currently open configured markets", () => {
    const hk: StockPulseMarketConfig = {
      timezone: "Asia/Hong_Kong",
      sessions: [{ start: "09:30", end: "12:00" }, { start: "13:00", end: "16:00" }],
      holidays: [],
    };
    expect(openMarketsAt(new Date("2026-05-08T07:30:00.000Z"), { "cn-a": cn, hk })).toEqual(["hk"]);
  });
});
