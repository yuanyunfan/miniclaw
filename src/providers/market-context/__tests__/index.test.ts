import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb, getDb } from "../../../store/db.js";
import { recordMarketContextFromReport } from "../../../store/market-context.js";
import { buildMarketContextProviderPayload } from "../index.js";

let tmp: string;
let previousConfigDir: string | undefined;

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  getDb().prepare("DELETE FROM market_context_items").run();
  getDb().prepare("DELETE FROM market_context_daily").run();
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-market-context-provider-"));
  previousConfigDir = process.env.MINICLAW_MARKET_CONTEXT_PROVIDER_CONFIG_DIR;
  process.env.MINICLAW_MARKET_CONTEXT_PROVIDER_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.MINICLAW_MARKET_CONTEXT_PROVIDER_CONFIG_DIR;
  } else {
    process.env.MINICLAW_MARKET_CONTEXT_PROVIDER_CONFIG_DIR = previousConfigDir;
  }
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, yaml: string): void {
  writeFileSync(join(tmp, `${name}.yaml`), yaml);
}

function record(scope: "us" | "cross-market", key: string, digest: string): void {
  recordMarketContextFromReport({
    marketScope: scope,
    generatedAt: "2026-05-15T22:00:00.000Z",
    tradeDate: "2026-05-15",
    reportText: [
      "<market_context_json>",
      JSON.stringify({
        market_scope: scope,
        trade_date: "2026-05-15",
        digest_text: digest,
        active_items: [{
          stable_key: key,
          topic: key,
          fact: `${key} fact`,
          market_impact: `${key} impact`,
          affected_markets: [scope],
          horizon: "1m",
          confidence: 0.6,
        }],
      }),
      "</market_context_json>",
    ].join("\n"),
  });
}

describe("market-context provider", () => {
  it("builds an inject payload from latest daily summaries and active items", () => {
    writeConfig("us-inject", `
mode: inject
market_scopes:
  - us
  - cross-market
max_items: 10
max_digest_chars: 80
`);
    record("us", "fed-policy-path", "Fed policy path remains relevant.");
    record("cross-market", "dollar-yields", "Dollar and yields remain the cross-market anchor.");

    const payload = buildMarketContextProviderPayload({
      configName: "us-inject",
      jobName: "us-stock-pre-market",
      channelId: "channel-1",
      runAt: new Date("2026-05-16T12:45:00.000Z"),
    });

    expect(payload).toMatchObject({
      source: "market-context",
      profile: "us-inject",
      mode: "inject",
      run_context: {
        job_name: "us-stock-pre-market",
        requested_market_scopes: ["us", "cross-market"],
      },
    });
    expect(payload.previous_contexts.map((context) => context.market_scope)).toEqual(expect.arrayContaining(["us", "cross-market"]));
    expect(payload.active_items.map((item) => item.stable_key)).toEqual(expect.arrayContaining(["fed-policy-path", "dollar-yields"]));
    expect(payload.latest_forecast).toBeUndefined();
  });

  it("builds an update payload with target scope and latest forecast when supplied", () => {
    writeConfig("us-update", `
mode: update
market_scope: us
forecast_market_scope: us
max_items: 4
`);

    const payload = buildMarketContextProviderPayload({
      configName: "us-update",
      jobName: "us-market-context-daily",
      channelId: "channel-1",
      runAt: new Date("2026-05-15T22:30:00.000Z"),
    }, {
      findForecast: () => ({
        id: "forecast-1",
        task_id: null,
        job_name: "us-stock-pre-market",
        channel_id: "channel-1",
        market_scope: "us",
        trade_date: "2026-05-15",
        session: "pre_market",
        calendar_status: "pre_market",
        generated_at: "2026-05-15T12:45:00.000Z",
        payload_json: "{}",
        data_quality_status: "ok",
        report_text: "## Forecast\n<market_forecast_json>{}</market_forecast_json>",
        created_at: "2026-05-15T12:45:00.000Z",
        updated_at: "2026-05-15T12:45:00.000Z",
      }),
      listForecastItems: () => [{
        id: "item-1",
        forecast_id: "forecast-1",
        item_type: "horizon_probability",
        target: "1m | SPY",
        direction: "up",
        probability: 0.52,
        confidence: 0.4,
        evidence_ids_json: "[\"quote.indices.1\"]",
        rationale: "risk-on base case",
        invalidation: null,
        source: "llm_report",
        created_at: "2026-05-15T12:45:00.000Z",
      }],
    });

    expect(payload.mode).toBe("update");
    expect(payload.run_context.target_market_scope).toBe("us");
    expect(payload.latest_forecast).toMatchObject({
      id: "forecast-1",
      market_scope: "us",
      trade_date: "2026-05-15",
      items: [expect.objectContaining({ target: "1m | SPY" })],
    });
    expect(payload.latest_forecast?.report_excerpt).toBe("## Forecast");
  });
});
