import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEastmoneyJywgProvider, runEastmoneyJywgProvider } from "../index.js";
import type { EastmoneyJywgDryRunSummary, EastmoneyJywgProviderConfig } from "../../../stock/reports/eastmoney-jywg-readonly-types.js";
import type {
  EastmoneyJywgClient,
  EastmoneyJywgConfig,
  EastmoneyJywgHealthCheck,
  EastmoneyJywgRawBrokerData,
  EastmoneyJywgSession,
} from "../../../mcp/eastmoney-jywg/types.js";

interface EastmoneyReplayFixture {
  runAt: string;
  providerConfig: EastmoneyJywgProviderConfig;
  eastmoneyConfig: EastmoneyJywgConfig;
  session: EastmoneyJywgSession;
  health?: EastmoneyJywgHealthCheck;
  raw?: EastmoneyJywgRawBrokerData;
  error?: string;
}

function readFixture(name: string): EastmoneyReplayFixture {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as EastmoneyReplayFixture;
}

function clientFor(fixture: EastmoneyReplayFixture): EastmoneyJywgClient {
  return {
    async healthCheck(): Promise<EastmoneyJywgHealthCheck> {
      return fixture.health ?? { ok: true, host: "jywg.18.cn", session: { ok: true, cookie_count: 1 } };
    },
    async getRawBrokerData(): Promise<EastmoneyJywgRawBrokerData> {
      if (fixture.error) throw new Error(fixture.error);
      if (!fixture.raw) throw new Error("fixture raw broker payload is missing");
      return fixture.raw;
    },
  };
}

function depsFor(fixture: EastmoneyReplayFixture, saveSession?: (path: string, updated: EastmoneyJywgSession) => void) {
  return {
    client: clientFor(fixture),
    loadEastmoneyConfig: () => fixture.eastmoneyConfig,
    loadProviderConfig: () => fixture.providerConfig,
    loadSession: () => fixture.session,
    saveSession,
  };
}

function contextFor(fixture: EastmoneyReplayFixture) {
  return {
    configName: "daily-stock-market",
    jobName: "stock-market-premarket",
    channelId: "channel",
    runAt: new Date(fixture.runAt),
  };
}

describe("eastmoney-jywg provider replay fixtures", () => {
  it("replays a sensitive account fixture through health, dry-run, and delayed commit", async () => {
    const fixture = readFixture("replay-summary.json");
    let savedSession: EastmoneyJywgSession | undefined;
    const provider = createEastmoneyJywgProvider(depsFor(fixture, (_path, updated) => {
      savedSession = updated;
    }));

    const health = await provider.healthCheck?.(contextFor(fixture));
    const healthText = JSON.stringify(health);

    expect(health).toMatchObject({
      ok: true,
      safeDetails: {
        profile: "default",
        account_alias_present: true,
        host: "jywg.18.cn",
      },
    });
    expect(healthText).not.toContain("Fixture Eastmoney Account");
    expect(healthText).not.toContain("fixture-cookie-value");
    expect(healthText).not.toContain("/tmp/miniclaw-fixture/eastmoney-session.json");

    const dryRun = await provider.dryRun?.(contextFor(fixture));
    expect(dryRun).toMatchObject({
      ok: true,
      redacted: true,
      structured: {
        source: "eastmoney-jywg-readonly",
        profile: "default",
        market_session: "premarket_0915",
        positions_count: 2,
        top_positions_count: 2,
        warning_count: 2,
      },
      warnings: expect.arrayContaining([
        "account=[redacted] cookie=[redacted] validatekey=[redacted]",
      ]),
    });
    expect(dryRun?.previewText).not.toContain("Fixture Eastmoney Account");
    expect(dryRun?.previewText).not.toContain("浦发银行");
    expect(dryRun?.previewText).not.toContain("fixture-cookie-value");
    expect(dryRun?.previewText).not.toContain("fixture-validate-key");
    expect(savedSession).toBeUndefined();

    const result = await runEastmoneyJywgProvider(contextFor(fixture), depsFor(fixture, (_path, updated) => {
      savedSession = updated;
    }));
    const formattedText = result.text;
    const parsed = JSON.parse(formattedText);
    expect(parsed.positions_summary).toMatchObject({
      positions_count: 2,
      pnl_summary: {
        net_pnl: 40,
        winners_count: 1,
        losers_count: 1,
      },
    });
    expect(formattedText).toContain("account=[redacted]");
    expect(formattedText).toContain("cookie=[redacted]");
    expect(formattedText).toContain("validatekey=[redacted]");
    expect(formattedText).not.toContain("6222020000000000");
    expect(formattedText).not.toContain("fixture-cookie-value");
    expect(formattedText).not.toContain("fixture-validate-key");
    expect(savedSession).toBeUndefined();
    await result.commit?.();
    expect(savedSession?.last_verified_at).toBe("2026-05-08T07:16:00.000Z");
  });

  it("replays a no-data fixture as a redacted warning state", async () => {
    const fixture = readFixture("no-data.json");
    const provider = createEastmoneyJywgProvider(depsFor(fixture));

    const dryRun = await provider.dryRun?.(contextFor(fixture));
    const summary = dryRun?.structured as EastmoneyJywgDryRunSummary | undefined;

    expect(dryRun).toMatchObject({
      ok: true,
      redacted: true,
      structured: {
        positions_count: 0,
        top_positions_count: 0,
      },
    });
    expect(summary?.warning_count).toBeGreaterThanOrEqual(3);
    expect(dryRun?.warnings.join("\n")).toContain("未查询到东方财富持仓数据");
    expect(dryRun?.previewText).not.toContain("fixture-cookie-value");
    expect(dryRun?.previewText).not.toContain("Fixture Eastmoney Account");
  });

  it("categorizes a fixture format drift failure without leaking credentials", async () => {
    const fixture = readFixture("format-drift-error.json");
    const provider = createEastmoneyJywgProvider(depsFor(fixture));

    const dryRun = await provider.dryRun?.(contextFor(fixture));

    expect(dryRun).toMatchObject({
      ok: false,
      category: "format_drift",
      redacted: true,
    });
    expect(dryRun?.previewText).toContain("invalid payload shape [redacted] unexpected positions object");
    expect(dryRun?.previewText).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEFGH");
  });
});
