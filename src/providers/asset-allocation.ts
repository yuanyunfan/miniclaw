export type AssetAllocationCategory =
  | "bond"
  | "foreign_index"
  | "domestic_index"
  | "gold"
  | "cash"
  | "stock"
  | "other";

export interface AssetAllocationInputPosition {
  code: string;
  name: string;
  currency: string;
  market_value?: number;
  instrument_type?: string;
}

export interface AssetAllocationHolding {
  code: string;
  name: string;
  currency: string;
  category: AssetAllocationCategory;
  label: string;
  market_value: number;
  instrument_type?: string;
}

export interface AssetAllocationBucket {
  category: AssetAllocationCategory;
  label: string;
  currency: string;
  market_value: number;
  positions_count: number;
  holdings?: AssetAllocationHolding[];
}

export interface AssetAllocationSummary {
  currency: string;
  total_assets?: number;
  market_value?: number;
  cash?: number;
  buckets: AssetAllocationBucket[];
  warnings: string[];
}

const CATEGORY_LABELS: Record<AssetAllocationCategory, string> = {
  bond: "债券",
  foreign_index: "国外指数",
  domestic_index: "国内指数",
  gold: "黄金",
  cash: "现金",
  stock: "个股",
  other: "其他",
};

const CATEGORY_ORDER: AssetAllocationCategory[] = [
  "cash",
  "bond",
  "foreign_index",
  "domestic_index",
  "gold",
  "stock",
  "other",
];

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function assetCategoryLabel(category: AssetAllocationCategory): string {
  return CATEGORY_LABELS[category];
}

export function classifyAssetHolding(code: string, name: string, instrumentType?: string): AssetAllocationCategory {
  const text = `${code} ${name}`.toUpperCase();

  if (hasAny(text, [
    /黄金|GOLD|GLD|IAU|SGOL/,
    /\b518880\b|\b518800\b|\b159934\b|\b159937\b/,
  ])) {
    return "gold";
  }

  if (hasAny(text, [
    /债|BOND|TREASURY|GOVT|国债|政金债|信用债|可转债|城投|中债/,
    /\bTLT\b|\bIEF\b|\bSHY\b|\bBND\b|\bAGG\b|\bLQD\b|\bHYG\b/,
  ])) {
    return "bond";
  }

  if (hasAny(text, [
    /纳斯达克|纳指|NASDAQ|标普|S&P|SP500|道琼|DOW|MSCI|RUSSELL|罗素/,
    /\bQQQ\b|\bSPY\b|\bVOO\b|\bIVV\b|\bDIA\b|\bVTI\b|\bVT\b|\bIWM\b|\bEFA\b|\bEEM\b/,
    /日经|NIKKEI/,
  ])) {
    return "foreign_index";
  }

  if (hasAny(text, [
    /沪深|中证|上证|深证|创业板|科创|恒生|国企|A50|CSI|HSI|HSTECH|HANG SENG/,
    /盈富|TRACKER FUND/,
    /\b510300\b|\b510500\b|\b159919\b|\b159915\b|\b588000\b|\b588080\b/,
    /\bHK\.02800\b|\bHK\.02828\b|\bHK\.03033\b/,
  ])) {
    return "domestic_index";
  }

  if (instrumentType === "etf") return "other";
  return "stock";
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function finiteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

export function buildAssetAllocationSummary(params: {
  currency: string;
  totalAssets?: number;
  marketValue?: number;
  cash?: number;
  unclassifiedMarketValue?: number;
  unclassifiedLabel?: string;
  positions: AssetAllocationInputPosition[];
  includeHoldings: boolean;
}): AssetAllocationSummary {
  const warnings: string[] = [];
  const buckets = new Map<AssetAllocationCategory, AssetAllocationBucket>();

  function getBucket(category: AssetAllocationCategory): AssetAllocationBucket {
    const existing = buckets.get(category);
    if (existing) return existing;
    const bucket: AssetAllocationBucket = {
      category,
      label: assetCategoryLabel(category),
      currency: params.currency,
      market_value: 0,
      positions_count: 0,
      ...(params.includeHoldings ? { holdings: [] } : {}),
    };
    buckets.set(category, bucket);
    return bucket;
  }

  if (finiteNumber(params.cash)) {
    const bucket = getBucket("cash");
    bucket.market_value += params.cash;
    if (params.includeHoldings) {
      bucket.holdings?.push({
        code: "CASH",
        name: "Cash",
        currency: params.currency,
        category: "cash",
        label: assetCategoryLabel("cash"),
        market_value: roundMoney(params.cash),
      });
    }
  }

  if (finiteNumber(params.unclassifiedMarketValue) && params.unclassifiedMarketValue > 0.01) {
    const bucket = getBucket("other");
    bucket.market_value += params.unclassifiedMarketValue;
    bucket.positions_count += 1;
    const label = params.unclassifiedLabel ?? "未展开证券市值";
    warnings.push(`${label} cannot be classified from position details; kept as an unclassified reconciliation row`);
    if (params.includeHoldings) {
      bucket.holdings?.push({
        code: "UNCLASSIFIED",
        name: label,
        currency: params.currency,
        category: "other",
        label: assetCategoryLabel("other"),
        market_value: roundMoney(params.unclassifiedMarketValue),
        instrument_type: "unclassified_asset_gap",
      });
    }
  }

  for (const position of params.positions) {
    if (!finiteNumber(position.market_value)) {
      warnings.push(`${position.code} ${position.name} missing market_value; excluded from asset allocation`);
      continue;
    }
    const category = classifyAssetHolding(position.code, position.name, position.instrument_type);
    const bucket = getBucket(category);
    bucket.market_value += position.market_value;
    bucket.positions_count += 1;
    if (params.includeHoldings) {
      bucket.holdings?.push({
        code: position.code,
        name: position.name,
        currency: position.currency,
        category,
        label: assetCategoryLabel(category),
        market_value: roundMoney(position.market_value),
        instrument_type: position.instrument_type,
      });
    }
  }

  return {
    currency: params.currency,
    total_assets: params.totalAssets,
    market_value: params.marketValue,
    cash: params.cash,
    buckets: [...buckets.values()]
      .map((bucket) => ({
        ...bucket,
        market_value: roundMoney(bucket.market_value),
        ...(bucket.holdings ? { holdings: bucket.holdings.sort((a, b) => b.market_value - a.market_value) } : {}),
      }))
      .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)),
    warnings,
  };
}

export const __testables = { CATEGORY_ORDER };
