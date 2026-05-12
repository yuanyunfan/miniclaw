import { describe, expect, it } from "vitest";
import { getProviderManifest, listProviderManifests, listPreProviderNames } from "../index.js";

describe("provider registry", () => {
  it("keeps legacy pre-provider names while exposing framework manifests", () => {
    expect(listPreProviderNames()).toContain("stock-pulse");
    expect(getProviderManifest("stock-pulse")).toMatchObject({
      name: "stock-pulse",
      kind: "stock",
      supportsDryRun: true,
      supportsHealthCheck: true,
      outputSchemaVersion: "stock-pulse.payload.v1",
    });
    expect(listProviderManifests().map((manifest) => manifest.name)).toContain("stock-pulse");
    expect(getProviderManifest("stock-portfolio")).toBeUndefined();
  });
});
