import type {
  EastmoneyJywgAccountSnapshot,
  EastmoneyJywgPositionSummary,
  EastmoneyJywgProfileConfig,
  EastmoneyJywgRawBrokerData,
} from "./types.js";

const ACCOUNT_TOTAL_ASSETS = ["Zzc", "zzc", "total_assets", "TotalAssets", "总资产"];
const ACCOUNT_MARKET_VALUE = ["Zxsz", "zxsz", "market_value", "MarketValue", "参考市值"];
const ACCOUNT_EXPANDED_MARKET_VALUE = ["totalSecMkval", "expanded_market_value", "展开持仓市值"];
const ACCOUNT_CASH_AVAILABLE = ["Kyzj", "Kqzj", "kyzj", "kqzj", "available", "可用资金", "可取资金"];
const ACCOUNT_BALANCE = ["Zjye", "zjye", "balance", "资金余额"];
const ACCOUNT_DAILY_PNL = ["Drckyk", "Dryk", "drckyk", "daily_pnl", "当日参考盈亏", "当日盈亏"];
const ACCOUNT_FLOATING_PNL = ["Ljyk", "Fdyk", "ljyk", "floating_pnl", "累计盈亏", "浮动盈亏"];

const POSITION_CODE = ["Zqdm", "zqdm", "stockCode", "StockCode", "code", "证券代码"];
const POSITION_NAME = ["Zqmc", "zqmc", "zqName", "stockName", "name", "证券名称"];
const POSITION_QUANTITY = ["Zqsl", "zqsl", "quantity", "持仓数量"];
const POSITION_AVAILABLE = ["Kysl", "kysl", "available", "可用数量"];
const POSITION_COST_PRICE = ["Cbjg", "cbjg", "cost_price", "成本价"];
const POSITION_LAST_PRICE = ["Zxjg", "zxjg", "last_price", "最新价"];
const POSITION_MARKET_VALUE = ["Zxsz", "zxsznew", "Cksz", "zxsz", "market_value", "参考市值"];
const POSITION_DAILY_PNL = ["Drckyk", "Dryk", "Drljyk", "drckyk", "daily_pnl", "当日盈亏"];
const POSITION_DAILY_PNL_RATIO = ["Drykbl", "daily_pnl_ratio", "当日盈亏比例"];
const POSITION_FLOATING_PNL = ["Ljyk", "Fdyk", "ljyk", "floating_pnl", "浮动盈亏", "累计盈亏"];
const POSITION_PNL_RATIO = ["Ykbl", "ykbl", "pnl_ratio", "盈亏比例"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstDataArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  const candidates = [
    payload.Data,
    payload.data,
    payload.result,
    isRecord(payload.Data) ? payload.Data.Data : undefined,
    isRecord(payload.Data) ? payload.Data.data : undefined,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

function nestedRecordArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (typeof payload === "string" && payload.trim()) {
    try {
      return nestedRecordArray(JSON.parse(payload) as unknown);
    } catch {
      return [];
    }
  }
  if (!isRecord(payload)) return [];
  return firstDataArray(payload).length ? firstDataArray(payload) : [payload];
}

function num(record: Record<string, unknown> | undefined, keys: readonly string[]): number | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const normalized = value.replace(/,/g, "").replace(/%$/, "").trim();
      const parsed = Number(normalized);
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

export function mapEastmoneyJywgPosition(record: Record<string, unknown>): EastmoneyJywgPositionSummary {
  const quantity = num(record, POSITION_QUANTITY);
  const lastPrice = num(record, POSITION_LAST_PRICE);
  const explicitMarketValue = num(record, POSITION_MARKET_VALUE);
  return {
    code: str(record, POSITION_CODE, "UNKNOWN"),
    name: str(record, POSITION_NAME, "UNKNOWN"),
    currency: "CNY",
    quantity,
    available_quantity: num(record, POSITION_AVAILABLE),
    cost_price: num(record, POSITION_COST_PRICE),
    last_price: lastPrice,
    market_value: explicitMarketValue ?? (quantity !== undefined && lastPrice !== undefined ? quantity * lastPrice : undefined),
    daily_pnl: num(record, POSITION_DAILY_PNL),
    daily_pnl_ratio: num(record, POSITION_DAILY_PNL_RATIO),
    floating_pnl: num(record, POSITION_FLOATING_PNL),
    pnl_ratio: num(record, POSITION_PNL_RATIO),
  };
}

function preferredPositionRows(
  raw: EastmoneyJywgRawBrokerData,
  account: Record<string, unknown> | undefined,
): Record<string, unknown>[] {
  const nestedPositions = nestedRecordArray(account?.positions);
  const nestedBonds = nestedRecordArray(account?.bonds);
  const fallbackPositions = firstDataArray(raw.positions);
  const baseRows = nestedPositions.length ? nestedPositions : fallbackPositions;
  return [...baseRows, ...nestedBonds];
}

function sumMarketValue(positions: EastmoneyJywgPositionSummary[]): number | undefined {
  const values = positions
    .map((position) => position.market_value)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0);
}

export function mapEastmoneyJywgRawBrokerData(
  raw: EastmoneyJywgRawBrokerData,
  profile: EastmoneyJywgProfileConfig,
  marketSession = "unspecified",
): EastmoneyJywgAccountSnapshot {
  const assetRows = firstDataArray(raw.asset_and_position);
  const account = assetRows[0];
  const positionRows = preferredPositionRows(raw, account);
  const positions = positionRows.map(mapEastmoneyJywgPosition);
  const dailyPnlFromPositions = positions
    .map((position) => position.daily_pnl)
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  const hasPositionDailyPnl = positions.some((position) => position.daily_pnl !== undefined);
  const dailyPnl = hasPositionDailyPnl ? dailyPnlFromPositions : num(account, ACCOUNT_DAILY_PNL);
  const totalAssets = num(account, ACCOUNT_TOTAL_ASSETS);
  const marketValue = num(account, ACCOUNT_MARKET_VALUE);
  const expandedMarketValue = num(account, ACCOUNT_EXPANDED_MARKET_VALUE);
  const positionsMarketValue = sumMarketValue(positions);
  const unclassifiedMarketValue = marketValue !== undefined && positionsMarketValue !== undefined
    ? marketValue - positionsMarketValue
    : undefined;
  const warnings = [...raw.warnings];
  if (!assetRows.length) warnings.push("未拿到东方财富账户资产行，资金汇总字段可能为空。");
  if (!positionRows.length) warnings.push("未查询到东方财富持仓数据，可能是账户无持仓或登录态权限不足。");
  if (!hasPositionDailyPnl) warnings.push("未拿到持仓当日盈亏，日报会回退到账户级盈亏字段，口径可能不同。");
  if (unclassifiedMarketValue !== undefined && Math.abs(unclassifiedMarketValue) > 1) {
    warnings.push("东方财富账户参考市值与可展开逐仓市值不完全一致，差额会按 provider 资产缺口策略处理。");
  }

  return {
    broker: "eastmoney-jywg",
    account_alias: profile.account_alias,
    captured_at: raw.captured_at,
    currency: "CNY",
    market_session: marketSession,
    total_assets: totalAssets,
    market_value: marketValue,
    expanded_market_value: expandedMarketValue,
    unclassified_market_value: unclassifiedMarketValue !== undefined && Math.abs(unclassifiedMarketValue) > 1
      ? unclassifiedMarketValue
      : undefined,
    cash_available: num(account, ACCOUNT_CASH_AVAILABLE),
    balance: num(account, ACCOUNT_BALANCE),
    daily_pnl: dailyPnl,
    floating_pnl: num(account, ACCOUNT_FLOATING_PNL),
    cumulative_pnl: num(account, ACCOUNT_FLOATING_PNL),
    daily_pnl_pct: ratioFromPnl(dailyPnl, totalAssets),
    positions,
    warnings,
  };
}

export function topEastmoneyJywgPositionsByPnl(
  snapshot: EastmoneyJywgAccountSnapshot,
  limit: number,
): EastmoneyJywgPositionSummary[] {
  return [...snapshot.positions]
    .filter((position) => position.daily_pnl !== undefined)
    .sort((a, b) => Math.abs(b.daily_pnl ?? 0) - Math.abs(a.daily_pnl ?? 0))
    .slice(0, Math.max(0, limit));
}

export const __testables = { firstDataArray, num, str };
