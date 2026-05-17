import { describe, expect, it } from "vitest";
import { describeCronActiveWindow, isCronActiveWindowOpen } from "../active-window.js";

describe("cron active window", () => {
  const activeWindow = {
    enabled: true,
    timezone: "Asia/Shanghai",
    start: "08:00",
    end: "00:00",
  };

  it("matches the configured Beijing day window and excludes midnight", () => {
    expect(isCronActiveWindowOpen(new Date("2026-05-15T00:00:00.000Z"), activeWindow)).toBe(true);
    expect(isCronActiveWindowOpen(new Date("2026-05-15T15:59:00.000Z"), activeWindow)).toBe(true);
    expect(isCronActiveWindowOpen(new Date("2026-05-15T16:00:00.000Z"), activeWindow)).toBe(false);
    expect(isCronActiveWindowOpen(new Date("2026-05-15T23:59:00.000Z"), activeWindow)).toBe(false);
  });

  it("treats disabled active windows as always open", () => {
    expect(isCronActiveWindowOpen(new Date("2026-05-15T18:00:00.000Z"), {
      ...activeWindow,
      enabled: false,
    })).toBe(true);
  });

  it("formats the window for scheduler skip messages", () => {
    expect(describeCronActiveWindow(activeWindow)).toBe("08:00-00:00 Asia/Shanghai");
  });
});
