import { topEastmoneyJywgPositionsByPnl } from "./mapper.js";
import type {
  EastmoneyJywgAccountSnapshot,
  EastmoneyJywgPositionSummary,
  EastmoneyJywgProfileConfig,
  EastmoneyJywgRedactionLevel,
} from "./types.js";

function formatMoney(value: number | undefined, currency: string): string {
  if (value === undefined || !Number.isFinite(value)) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatAssetRange(value: number | undefined, currency: string): string {
  if (value === undefined || !Number.isFinite(value)) return "N/A";
  const abs = Math.abs(value);
  if (abs < 10_000) return `<10k ${currency}`;
  if (abs < 50_000) return `10k-50k ${currency}`;
  if (abs < 100_000) return `50k-100k ${currency}`;
  if (abs < 500_000) return `100k-500k ${currency}`;
  if (abs < 1_000_000) return `500k-1m ${currency}`;
  const millions = Math.floor(abs / 1_000_000);
  return `${millions}m-${millions + 1}m ${currency}`;
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/(validatekey=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(em_validatekey["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]")
    .replace(/\b1[3-9]\d{9}\b/g, "[redacted-phone]")
    .replace(/(?<![.\d])\b\d{10,20}\b(?![.\d])/g, "[redacted-account]")
    .replace(/(password|token|cookie|secret|session|account|customer|acc_id)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/([A-Za-z0-9+/=_-]{24,})/g, "[redacted]");
}

export function redactJsonStringValues(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactJsonStringValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactJsonStringValues(item)]),
  );
}

export function redactedSnapshotJson(
  snapshot: EastmoneyJywgAccountSnapshot,
  profile: EastmoneyJywgProfileConfig,
): string {
  const exact = profile.redaction === "exact" || profile.show_total_assets;
  const compact = {
    broker: snapshot.broker,
    account_alias: snapshot.account_alias,
    captured_at: snapshot.captured_at,
    market_session: snapshot.market_session,
    currency: snapshot.currency,
    daily_pnl: snapshot.daily_pnl,
    daily_pnl_pct: snapshot.daily_pnl_pct,
    floating_pnl: snapshot.floating_pnl,
    total_assets: exact ? snapshot.total_assets : undefined,
    total_assets_range: exact ? undefined : formatAssetRange(snapshot.total_assets, snapshot.currency),
    market_value: exact ? snapshot.market_value : undefined,
    market_value_range: exact ? undefined : formatAssetRange(snapshot.market_value, snapshot.currency),
    expanded_market_value: exact ? snapshot.expanded_market_value : undefined,
    unclassified_market_value: exact ? snapshot.unclassified_market_value : undefined,
    cash_available: exact ? snapshot.cash_available : undefined,
    cash_available_range: exact ? undefined : formatAssetRange(snapshot.cash_available, snapshot.currency),
    positions_count: snapshot.positions.length,
    warnings: snapshot.warnings,
  };
  return JSON.stringify(redactJsonStringValues(compact), null, 2);
}

function positionLine(position: EastmoneyJywgPositionSummary, currency: string): string {
  const pnl = position.daily_pnl ?? position.floating_pnl;
  const pctValue = position.daily_pnl !== undefined ? position.daily_pnl_ratio : position.pnl_ratio;
  const pct = pctValue !== undefined ? ` (${formatPercent(pctValue)})` : "";
  return `- ${position.code} ${position.name}: ${formatMoney(pnl, currency)}${pct}`;
}

export function formatEastmoneyJywgDailyPnlReport(
  snapshot: EastmoneyJywgAccountSnapshot,
  profile: EastmoneyJywgProfileConfig,
  options?: { topPositionsLimit?: number; redaction?: EastmoneyJywgRedactionLevel },
): string {
  const redaction = options?.redaction ?? profile.redaction;
  const showExactAssets = redaction === "exact" || profile.show_total_assets;
  const topPositions = topEastmoneyJywgPositionsByPnl(snapshot, options?.topPositionsLimit ?? 5);
  const lines = [
    `账户别名：${snapshot.account_alias}`,
    `采集时间：${snapshot.captured_at}`,
    `市场口径：${snapshot.market_session}`,
    `今日盈亏：${formatMoney(snapshot.daily_pnl, snapshot.currency)} (${formatPercent(snapshot.daily_pnl_pct)})`,
    `总资产：${showExactAssets ? formatMoney(snapshot.total_assets, snapshot.currency) : `已脱敏，区间 ${formatAssetRange(snapshot.total_assets, snapshot.currency)}`}`,
    `持仓数量：${snapshot.positions.length}`,
    "主要贡献/拖累：",
    ...(topPositions.length ? topPositions.map((position) => positionLine(position, snapshot.currency)) : ["- N/A"]),
    "风险提示：今日盈亏基于东方财富 Web 交易后台只读快照生成，可能与最终交割单或结算单存在口径差异。",
    ...snapshot.warnings.map((warning) => `口径提示：${warning}`),
  ];
  return redactSensitiveText(lines.join("\n"));
}

export const __testables = { formatMoney, formatPercent, formatAssetRange };
