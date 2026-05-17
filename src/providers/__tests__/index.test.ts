import { describe, expect, it } from "vitest";
import { getProviderManifest, listProviderManifests, listPreProviderNames } from "../index.js";

describe("provider registry", () => {
  it("keeps legacy pre-provider names while exposing framework manifests", () => {
    expect(listPreProviderNames()).toContain("stock-pulse");
    expect(getProviderManifest("eastmoney-etf-premium")).toMatchObject({
      name: "eastmoney-etf-premium",
      kind: "stock",
      privacy: "public",
      supportsDryRun: true,
      supportsHealthCheck: true,
      outputSchemaVersion: "eastmoney-etf-premium.payload.v1",
    });
    expect(getProviderManifest("stock-pulse")).toMatchObject({
      name: "stock-pulse",
      kind: "stock",
      supportsDryRun: true,
      supportsHealthCheck: true,
      outputSchemaVersion: "stock-pulse.payload.v1",
    });
    expect(getProviderManifest("eastmoney-jywg-readonly")).toMatchObject({
      name: "eastmoney-jywg-readonly",
      kind: "stock",
      privacy: "sensitive",
      supportsDryRun: true,
      supportsHealthCheck: true,
      outputSchemaVersion: "eastmoney-jywg-readonly.payload.v1",
    });
    expect(getProviderManifest("market-context")).toMatchObject({
      name: "market-context",
      kind: "stock",
      privacy: "private",
      supportsDryRun: true,
      supportsHealthCheck: true,
      outputSchemaVersion: "market-context.payload.v1",
    });
    expect(listProviderManifests().map((manifest) => manifest.name)).toEqual([
      "eastmoney-etf-premium",
      "eastmoney-jywg-readonly",
      "market-context",
      "stock-pulse",
      "stock-watchlist-research",
    ]);
    expect(getProviderManifest("stock-watchlist-research")).toMatchObject({
      name: "stock-watchlist-research",
      kind: "stock",
      privacy: "private",
      supportsDryRun: true,
      supportsHealthCheck: true,
      outputSchemaVersion: "stock-watchlist-research.payload.v1",
    });
    expect(getProviderManifest("stock-portfolio")).toBeUndefined();
  });
});
