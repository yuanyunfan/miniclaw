import { describe, expect, it } from "vitest";
import { toYahooSymbol } from "../symbols.js";

describe("stock-pulse symbol mapping", () => {
  it("maps US class-share dots to Yahoo hyphen symbols", () => {
    expect(toYahooSymbol("US.BRK.B", "us")).toBe("BRK-B");
    expect(toYahooSymbol("BRK.B", "us")).toBe("BRK-B");
  });

  it("keeps exchange suffixes for CN and HK symbols", () => {
    expect(toYahooSymbol("SH.600000", "cn-a")).toBe("600000.SS");
    expect(toYahooSymbol("HK.700", "hk")).toBe("0700.HK");
  });
});
