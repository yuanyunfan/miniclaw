import {
  formatEastmoneyJywgDailyPnlReport,
  redactedSnapshotJson,
  redactJsonStringValues,
} from "../../mcp/eastmoney-jywg/redact.js";
import { topEastmoneyJywgPositionsByPnl } from "../../mcp/eastmoney-jywg/mapper.js";
import type { EastmoneyJywgProfileConfig } from "../../mcp/eastmoney-jywg/types.js";
import { buildAssetAllocationSummary } from "../asset-allocation.js";
import type {
  EastmoneyJywgProviderFormatOptions,
  EastmoneyJywgProviderPayload,
  EastmoneyJywgProviderPnlSummary,
  EastmoneyJywgProviderPositionInput,
  EastmoneyJywgProviderSnapshotInput,
  EastmoneyJywgProviderTopPosition,
} from "./types.js";

function parseRedactedSnapshotJson(
  snapshot: EastmoneyJywgProviderSnapshotInput,
  profile: EastmoneyJywgProfileConfig,
): Record<string, unknown> {
  return JSON.parse(redactedSnapshotJson(snapshot, profile)) as Record<string, unknown>;
}

function compactPosition(position: EastmoneyJywgProviderPositionInput): EastmoneyJywgProviderTopPosition {
  return {
    code: position.code,
    name: position.name,
    currency: position.currency,
    instrument_type: inferInstrumentType(position.code, position.name),
    daily_pnl: position.daily_pnl,
    floating_pnl: position.floating_pnl,
    pnl_ratio: position.pnl_ratio,
  };
}

function inferInstrumentType(code: string, name: string): "stock" | "etf" {
  const text = `${code} ${name}`;
  return /ETF|LOF|REIT|REITS|指数基金|交易型开放式/i.test(text) ? "etf" : "stock";
}

function positionDailyPnl(position: EastmoneyJywgProviderPositionInput): number | undefined {
  const value = position.daily_pnl ?? position.floating_pnl;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function compactTopGainers(
  snapshot: EastmoneyJywgProviderSnapshotInput,
  limit: number,
): EastmoneyJywgProviderTopPosition[] {
  return [...snapshot.positions]
    .filter((position) => {
      const pnl = positionDailyPnl(position);
      return pnl !== undefined && pnl > 0;
    })
    .sort((a, b) => (positionDailyPnl(b) ?? 0) - (positionDailyPnl(a) ?? 0))
    .slice(0, Math.max(0, limit))
    .map(compactPosition);
}

function compactTopLosers(
  snapshot: EastmoneyJywgProviderSnapshotInput,
  limit: number,
): EastmoneyJywgProviderTopPosition[] {
  return [...snapshot.positions]
    .filter((position) => {
      const pnl = positionDailyPnl(position);
      return pnl !== undefined && pnl < 0;
    })
    .sort((a, b) => (positionDailyPnl(a) ?? 0) - (positionDailyPnl(b) ?? 0))
    .slice(0, Math.max(0, limit))
    .map(compactPosition);
}

function buildPnlSummary(snapshot: EastmoneyJywgProviderSnapshotInput): EastmoneyJywgProviderPnlSummary {
  let grossProfit = 0;
  let grossLoss = 0;
  let winnersCount = 0;
  let losersCount = 0;
  let flatCount = 0;
  let positionsWithPnlCount = 0;

  for (const position of snapshot.positions) {
    const pnl = positionDailyPnl(position);
    if (pnl === undefined) continue;
    positionsWithPnlCount += 1;
    if (pnl > 0) {
      grossProfit += pnl;
      winnersCount += 1;
    } else if (pnl < 0) {
      grossLoss += pnl;
      losersCount += 1;
    } else {
      flatCount += 1;
    }
  }

  return {
    currency: snapshot.currency,
    gross_profit: grossProfit,
    gross_loss: grossLoss,
    net_pnl: grossProfit + grossLoss,
    winners_count: winnersCount,
    losers_count: losersCount,
    flat_count: flatCount,
    positions_with_pnl_count: positionsWithPnlCount,
  };
}

function compactTopPositions(
  snapshot: EastmoneyJywgProviderSnapshotInput,
  limit: number,
): EastmoneyJywgProviderTopPosition[] {
  return topEastmoneyJywgPositionsByPnl(snapshot, limit).map(compactPosition);
}

export function buildEastmoneyJywgProviderPayload(
  snapshot: EastmoneyJywgProviderSnapshotInput,
  profile: EastmoneyJywgProfileConfig,
  options: EastmoneyJywgProviderFormatOptions,
): EastmoneyJywgProviderPayload {
  const payload: EastmoneyJywgProviderPayload = {
    generated_at: options.generatedAt.toISOString(),
    source: "eastmoney-jywg-readonly",
    profile: options.profileName,
    account_alias: snapshot.account_alias,
    market_session: options.marketSession,
    redaction: options.redaction,
    warnings: [...snapshot.warnings],
    usage_notes: [
      "This payload is generated from jywg.18.cn through a local read-only provider.",
      options.redaction === "exact"
        ? "Exact account asset and holding market values are intentionally included for trusted private channels; still do not output account id, customer id, shareholder id, cookie, validatekey, password, or trade password."
        : "Do not infer or output account id, customer id, shareholder id, exact total assets, cookie, validatekey, password, or trade password.",
      "Daily P&L is based on a broker web snapshot and may differ from final settlement statements because of cash flows, fees, dividends, and data timing.",
    ],
  };

  if (options.includeDailyReport) {
    payload.report = formatEastmoneyJywgDailyPnlReport(snapshot, profile, {
      redaction: options.redaction,
      topPositionsLimit: options.topPositionsLimit,
    });
  }

  if (options.includeAccountSnapshot) {
    payload.snapshot = parseRedactedSnapshotJson(snapshot, profile);
  }

  if (options.includePositionsSummary) {
    payload.positions_summary = {
      positions_count: snapshot.positions.length,
      pnl_summary: buildPnlSummary(snapshot),
      top_positions: compactTopPositions(snapshot, options.topPositionsLimit),
      top_gainers: compactTopGainers(snapshot, options.topPositionsLimit),
      top_losers: compactTopLosers(snapshot, options.topPositionsLimit),
    };
  }

  if (options.includeAssetAllocation) {
    payload.asset_summary = buildAssetAllocationSummary({
      currency: snapshot.currency,
      totalAssets: snapshot.total_assets,
      marketValue: snapshot.market_value,
      cash: snapshot.cash_available,
      positions: snapshot.positions.map((position) => ({
        code: position.code,
        name: position.name,
        currency: position.currency,
        market_value: position.market_value,
        instrument_type: inferInstrumentType(position.code, position.name),
      })),
      includeHoldings: options.redaction === "exact",
    });
  }

  return payload;
}

export function formatEastmoneyJywgProviderPayload(payload: EastmoneyJywgProviderPayload): string {
  return JSON.stringify(redactJsonStringValues(payload), null, 2);
}
