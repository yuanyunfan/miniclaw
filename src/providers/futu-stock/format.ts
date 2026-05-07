import { formatFutuDailyPnlReport, redactedSnapshotJson, redactJsonStringValues } from "../../mcp/futu-stock/redact.js";
import { topFutuPositionsByDailyPnl } from "../../mcp/futu-stock/mapper.js";
import type { FutuStockProfileConfig } from "../../mcp/futu-stock/types.js";
import type {
  FutuStockProviderFormatOptions,
  FutuStockProviderPayload,
  FutuStockProviderPositionInput,
  FutuStockProviderSnapshotInput,
  FutuStockProviderTopPosition,
} from "./types.js";

function parseRedactedSnapshotJson(snapshot: FutuStockProviderSnapshotInput, profile: FutuStockProfileConfig): Record<string, unknown> {
  return JSON.parse(redactedSnapshotJson(snapshot, profile)) as Record<string, unknown>;
}

function compactPosition(position: FutuStockProviderPositionInput): FutuStockProviderTopPosition {
  return {
    code: position.code,
    name: position.name,
    currency: position.currency,
    daily_pnl: position.daily_pnl,
    pnl_value: position.pnl_value,
    pnl_ratio: position.pnl_ratio,
    unrealized_pnl: position.unrealized_pnl,
    realized_pnl: position.realized_pnl,
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
      "Do not infer or output account id, exact total assets, phone number, token, cookie, or trade password.",
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
      top_positions: compactTopPositions(snapshot, options.topPositionsLimit),
    };
  }

  return payload;
}

export function formatFutuStockProviderPayload(payload: FutuStockProviderPayload): string {
  return JSON.stringify(redactJsonStringValues(payload), null, 2);
}
