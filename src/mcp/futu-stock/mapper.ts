import type { FutuAccountSnapshot, FutuPositionSummary, FutuRawBrokerData, FutuStockProfileConfig } from "./types.js";

const ACCOUNT_TOTAL_ASSETS = ["total_assets", "total_asset", "Total Assets", "TotalAssets"];
const ACCOUNT_MARKET_VALUE = ["market_val", "market_value", "securities_assets", "security_asset", "Market Val"];
const ACCOUNT_CASH = ["cash", "cash_all", "available_funds", "Cash"];
const ACCOUNT_UNREALIZED = ["unrealized_pl", "unrealized_pnl", "Unrealized P/L"];
const ACCOUNT_REALIZED = ["realized_pl", "realized_pnl", "Realized P/L"];

function num(record: Record<string, unknown> | undefined | null, keys: readonly string[]): number | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function str(record: Record<string, unknown>, keys: readonly string[], fallback = ""): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function ratioFromPnl(dailyPnl: number | undefined, totalAssets: number | undefined): number | undefined {
  if (dailyPnl === undefined || totalAssets === undefined) return undefined;
  const base = totalAssets - dailyPnl;
  if (!Number.isFinite(base) || Math.abs(base) < 0.000001) return undefined;
  return (dailyPnl / base) * 100;
}

export function mapFutuPosition(record: Record<string, unknown>, fallbackCurrency: string): FutuPositionSummary {
  return {
    code: str(record, ["code", "Code"], "UNKNOWN"),
    name: str(record, ["stock_name", "name", "Stock Name"], "UNKNOWN"),
    currency: str(record, ["currency", "Currency"], fallbackCurrency),
    quantity: num(record, ["qty", "quantity", "can_sell_qty", "Qty"]),
    market_value: num(record, ["market_val", "market_value", "Market Val"]),
    daily_pnl: num(record, ["today_pl_val", "daily_pnl", "Today P/L"]),
    pnl_value: num(record, ["pl_val", "pnl_value", "P/L"]),
    pnl_ratio: num(record, ["pl_ratio", "pnl_ratio", "P/L Ratio"]),
    unrealized_pnl: num(record, ["unrealized_pl", "unrealized_pnl", "Unrealized P/L"]),
    realized_pnl: num(record, ["realized_pl", "realized_pnl", "Realized P/L"]),
  };
}

export function mapFutuRawBrokerData(
  raw: FutuRawBrokerData,
  profile: FutuStockProfileConfig,
  marketSession = "unspecified",
): FutuAccountSnapshot {
  const account = raw.account ?? {};
  const positions = raw.positions.map((item) => mapFutuPosition(item, profile.currency));
  const dailyPnlFromPositions = positions
    .map((position) => position.daily_pnl)
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  const hasPositionDailyPnl = positions.some((position) => position.daily_pnl !== undefined);
  const realizedPnl = num(account, ACCOUNT_REALIZED);
  const unrealizedPnl = num(account, ACCOUNT_UNREALIZED);
  const dailyPnl = hasPositionDailyPnl
    ? dailyPnlFromPositions
    : realizedPnl !== undefined || unrealizedPnl !== undefined
      ? (realizedPnl ?? 0) + (unrealizedPnl ?? 0)
      : undefined;
  const totalAssets = num(account, ACCOUNT_TOTAL_ASSETS);
  const warnings: string[] = [];
  if (!hasPositionDailyPnl) {
    warnings.push("未拿到持仓 today_pl_val，日报会回退到账户 realized/unrealized P&L，口径可能不同。");
  }
  if (!raw.positions.length) warnings.push("未查询到持仓数据，可能是账户无持仓或 OpenD/API 权限不足。");
  return {
    broker: "futu",
    account_alias: profile.account_alias,
    captured_at: raw.captured_at,
    currency: profile.currency,
    market_session: marketSession,
    total_assets: totalAssets,
    market_value: num(account, ACCOUNT_MARKET_VALUE),
    cash: num(account, ACCOUNT_CASH),
    daily_pnl: dailyPnl,
    daily_pnl_pct: ratioFromPnl(dailyPnl, totalAssets),
    realized_pnl: realizedPnl,
    unrealized_pnl: unrealizedPnl,
    positions,
    warnings,
  };
}

export function topFutuPositionsByDailyPnl(
  snapshot: FutuAccountSnapshot,
  limit: number,
): FutuPositionSummary[] {
  return [...snapshot.positions]
    .filter((position) => position.daily_pnl !== undefined)
    .sort((a, b) => Math.abs(b.daily_pnl ?? 0) - Math.abs(a.daily_pnl ?? 0))
    .slice(0, Math.max(0, limit));
}
