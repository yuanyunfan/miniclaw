import { formatFutuDailyPnlReport, redactedSnapshotJson, redactJsonStringValues } from "../../mcp/futu-stock/redact.js";
import { topFutuPositionsByDailyPnl } from "../../mcp/futu-stock/mapper.js";
import type { FutuStockProfileConfig } from "../../mcp/futu-stock/types.js";
import { buildAssetAllocationSummary } from "../data/asset-allocation.js";
import type {
  FutuStockProviderFormatOptions,
  FutuStockProviderPayload,
  FutuStockProviderPnlSummary,
  FutuStockProviderPositionInput,
  FutuStockProviderSnapshotInput,
  FutuStockProviderTopPosition,
} from "./futu-stock-types.js";

function parseRedactedSnapshotJson(snapshot: FutuStockProviderSnapshotInput, profile: FutuStockProfileConfig): Record<string, unknown> {
  return JSON.parse(redactedSnapshotJson(snapshot, profile)) as Record<string, unknown>;
}

function compactPosition(position: FutuStockProviderPositionInput): FutuStockProviderTopPosition {
  return {
    code: position.code,
    name: position.name,
    currency: position.currency,
    instrument_type: inferInstrumentType(position.code, position.name),
    daily_pnl: position.daily_pnl,
    pnl_value: position.pnl_value,
    pnl_ratio: position.pnl_ratio,
    unrealized_pnl: position.unrealized_pnl,
    realized_pnl: position.realized_pnl,
  };
}

function inferInstrumentType(code: string, name: string): "stock" | "etf" {
  const text = `${code} ${name}`;
  return /ETF|LOF|REIT|REITS|指数基金|交易型开放式/i.test(text) ? "etf" : "stock";
}

function positionDailyPnl(position: FutuStockProviderPositionInput): number | undefined {
  const value = position.daily_pnl;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function compactTopGainers(
  snapshot: FutuStockProviderSnapshotInput,
  limit: number,
): FutuStockProviderTopPosition[] {
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
  snapshot: FutuStockProviderSnapshotInput,
  limit: number,
): FutuStockProviderTopPosition[] {
  return [...snapshot.positions]
    .filter((position) => {
      const pnl = positionDailyPnl(position);
      return pnl !== undefined && pnl < 0;
    })
    .sort((a, b) => (positionDailyPnl(a) ?? 0) - (positionDailyPnl(b) ?? 0))
    .slice(0, Math.max(0, limit))
    .map(compactPosition);
}

function buildPnlSummary(snapshot: FutuStockProviderSnapshotInput): FutuStockProviderPnlSummary {
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

  if (positionsWithPnlCount === 0 && snapshot.daily_pnl !== undefined && Number.isFinite(snapshot.daily_pnl)) {
    return {
      currency: snapshot.currency,
      gross_profit: snapshot.daily_pnl > 0 ? snapshot.daily_pnl : 0,
      gross_loss: snapshot.daily_pnl < 0 ? snapshot.daily_pnl : 0,
      net_pnl: snapshot.daily_pnl,
      winners_count: 0,
      losers_count: 0,
      flat_count: 0,
      positions_with_pnl_count: 0,
      pnl_source: "aggregate_pnl_fallback",
    };
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
    pnl_source: positionsWithPnlCount > 0 ? "positions_daily_pnl" : "unavailable",
  };
}

function compactTopPositions(
  snapshot: FutuStockProviderSnapshotInput,
  limit: number,
): FutuStockProviderTopPosition[] {
  return topFutuPositionsByDailyPnl(snapshot, limit).map(compactPosition);
}

export function buildFutuStockProviderPayload(
  snapshot: FutuStockProviderSnapshotInput,
  profile: FutuStockProfileConfig,
  options: FutuStockProviderFormatOptions,
): FutuStockProviderPayload {
  const payload: FutuStockProviderPayload = {
    generated_at: options.generatedAt.toISOString(),
    source: "futu-opend-readonly",
    profile: options.profileName,
    account_alias: snapshot.account_alias,
    market_session: options.marketSession,
    redaction: options.redaction,
    warnings: [...snapshot.warnings],
    usage_notes: [
      "This payload is generated from local Futu OpenD through a read-only provider.",
      options.redaction === "exact"
        ? "Exact account asset and holding market values are intentionally included for trusted private channels; still do not output account id, phone number, token, cookie, or trade password."
        : "Do not infer or output account id, exact total assets, phone number, token, cookie, or trade password.",
      "Daily P&L is based on a broker snapshot and may differ from the final settlement statement because of cash flows, fees, dividends, and FX.",
    ],
  };

  if (options.includeDailyReport) {
    payload.report = formatFutuDailyPnlReport(snapshot, profile, {
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
      cash: snapshot.cash,
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

export function formatFutuStockProviderPayload(payload: FutuStockProviderPayload): string {
  return JSON.stringify(redactJsonStringValues(payload), null, 2);
}
