import {
  formatEastmoneyJywgDailyPnlReport,
  redactedSnapshotJson,
  redactJsonStringValues,
} from "../../mcp/eastmoney-jywg/redact.js";
import { topEastmoneyJywgPositionsByPnl } from "../../mcp/eastmoney-jywg/mapper.js";
import type { EastmoneyJywgProfileConfig } from "../../mcp/eastmoney-jywg/types.js";
import { buildAssetAllocationSummary } from "../data/asset-allocation.js";
import type {
  EastmoneyJywgProviderFormatOptions,
  EastmoneyJywgProviderPayload,
  EastmoneyJywgProviderPnlSummary,
  EastmoneyJywgProviderPositionPremium,
  EastmoneyJywgProviderPositionInput,
  EastmoneyJywgProviderSnapshotInput,
  EastmoneyJywgProviderTopPosition,
} from "./eastmoney-jywg-readonly-types.js";

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
    daily_pnl_ratio: position.daily_pnl_ratio,
    floating_pnl: position.floating_pnl,
    pnl_ratio: position.pnl_ratio,
    premium_rate: position.premium_rate,
    reference_nav: position.reference_nav,
    iopv: position.iopv,
  };
}

function inferInstrumentType(code: string, name: string): "stock" | "etf" {
  const text = `${code} ${name}`;
  return /ETF|LOF|REIT|REITS|指数基金|交易型开放式/i.test(text) ? "etf" : "stock";
}

function positionDailyPnl(position: EastmoneyJywgProviderPositionInput): number | undefined {
  const value = position.daily_pnl;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function positiveMarketValueGap(snapshot: EastmoneyJywgProviderSnapshotInput): number | undefined {
  const value = snapshot.unclassified_market_value;
  return value !== undefined && Number.isFinite(value) && value > 0.01 ? value : undefined;
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
  snapshot: EastmoneyJywgProviderSnapshotInput,
  limit: number,
): EastmoneyJywgProviderTopPosition[] {
  return topEastmoneyJywgPositionsByPnl(snapshot, limit).map(compactPosition);
}

function compactPositionPremiums(
  snapshot: EastmoneyJywgProviderSnapshotInput,
): EastmoneyJywgProviderPositionPremium[] {
  return snapshot.positions.map((position) => {
    const hasPremium = position.premium_rate !== undefined && Number.isFinite(position.premium_rate);
    return {
      code: position.code,
      name: position.name,
      currency: position.currency,
      data_source: "eastmoney_position" as const,
      status: hasPremium ? "ok" as const : "missing_from_eastmoney_position" as const,
      captured_at: snapshot.captured_at,
      premium_rate: position.premium_rate,
      reference_nav: position.reference_nav,
      iopv: position.iopv,
      last_price: position.last_price,
      note: hasPremium ? undefined : "Eastmoney position payload did not include a premium_rate field for this held position.",
    };
  });
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
      "positions_summary.position_premiums exposes Eastmoney premium_rate fields for all held positions; downstream prompts decide which rows are overseas/cross-border ETFs.",
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
      position_premiums: compactPositionPremiums(snapshot),
    };
  }

  if (options.includeAssetAllocation) {
    const cashLikeGap = options.assetGapPolicy.positive_market_value_gap === "cash_like"
      ? positiveMarketValueGap(snapshot)
      : undefined;
    const cash = cashLikeGap === undefined
      ? snapshot.cash_available
      : roundMoney((snapshot.cash_available ?? 0) + cashLikeGap);
    const marketValue = cashLikeGap === undefined || snapshot.market_value === undefined
      ? snapshot.market_value
      : roundMoney(snapshot.market_value - cashLikeGap);
    if (cashLikeGap !== undefined) {
      payload.warnings.push(
        `${options.assetGapPolicy.label ?? "东方财富参考市值差额"} ${roundMoney(cashLikeGap)} CNY is treated as cash-like asset by provider asset_gap_policy.`,
      );
    }
    payload.asset_summary = buildAssetAllocationSummary({
      currency: snapshot.currency,
      totalAssets: snapshot.total_assets,
      marketValue,
      cash,
      unclassifiedMarketValue: cashLikeGap === undefined ? snapshot.unclassified_market_value : undefined,
      unclassifiedLabel: "东方财富未展开证券市值",
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
