import {
  formatEastmoneyJywgDailyPnlReport,
  redactedSnapshotJson,
  redactJsonStringValues,
} from "../../mcp/eastmoney-jywg/redact.js";
import { topEastmoneyJywgPositionsByPnl } from "../../mcp/eastmoney-jywg/mapper.js";
import type { EastmoneyJywgProfileConfig } from "../../mcp/eastmoney-jywg/types.js";
import type {
  EastmoneyJywgProviderFormatOptions,
  EastmoneyJywgProviderPayload,
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
    daily_pnl: position.daily_pnl,
    floating_pnl: position.floating_pnl,
    pnl_ratio: position.pnl_ratio,
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
      "Do not infer or output account id, customer id, shareholder id, exact total assets, cookie, validatekey, password, or trade password.",
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
      top_positions: compactTopPositions(snapshot, options.topPositionsLimit),
    };
  }

  return payload;
}

export function formatEastmoneyJywgProviderPayload(payload: EastmoneyJywgProviderPayload): string {
  return JSON.stringify(redactJsonStringValues(payload), null, 2);
}
