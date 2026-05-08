import type {
  StockPortfolioAssetCategorySummary,
  StockPortfolioAssetHolding,
  StockPortfolioAssetSummary,
  StockPortfolioClassifiableHolding,
  StockPortfolioClassificationGuidance,
  StockPortfolioCnyPosition,
  StockPortfolioCnySummary,
  StockPortfolioCurrencyPnlSummary,
  StockPortfolioPayload,
  StockPortfolioProviderConfig,
  StockPortfolioSourceOk,
  StockPortfolioSourceResult,
} from "./types.js";
import { assetCategoryLabel, type AssetAllocationCategory } from "../asset-allocation.js";

export function sanitizeStockPortfolioError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(validatekey=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(password|token|cookie|secret|session|account|customer|acc_id)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/([A-Za-z0-9+/=_-]{24,})/g, "[redacted]")
    .slice(0, 800);
}

function redactJsonStringValues(value: unknown): unknown {
  if (typeof value === "string") return sanitizeStockPortfolioError(value);
  if (Array.isArray(value)) return value.map(redactJsonStringValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactJsonStringValues(item)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function inferInstrumentType(code: string, name: string, raw: unknown): "stock" | "etf" {
  if (raw === "etf" || raw === "stock") return raw;
  const text = `${code} ${name}`;
  return /ETF|LOF|REIT|REITS|指数基金|交易型开放式/i.test(text) ? "etf" : "stock";
}

function positionPnl(position: Record<string, unknown>): number | undefined {
  return num(position.daily_pnl) ?? num(position.pnl_value) ?? num(position.floating_pnl);
}

interface SourceTopPosition {
  provider: StockPortfolioSourceOk["provider"];
  config: string;
  label?: string;
  code: string;
  name: string;
  instrument_type: "stock" | "etf";
  source_currency: string;
  pnl: number;
  pnl_ratio?: number;
}

function fxRateFor(currency: string, config: StockPortfolioProviderConfig, warnings: Set<string>): number | undefined {
  const normalized = currency.trim().toUpperCase() || config.base_currency;
  const rate = normalized === config.base_currency ? 1 : config.fx_rates[normalized];
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
    warnings.add(`missing FX rate for ${normalized}->${config.base_currency}; CNY rollup excludes this currency`);
    return undefined;
  }
  return rate;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function sourcePnlSummary(source: StockPortfolioSourceOk): Record<string, unknown> | undefined {
  const summary = source.payload.positions_summary;
  if (!isRecord(summary) || !isRecord(summary.pnl_summary)) return undefined;
  return summary.pnl_summary;
}

function sourceTopPositions(source: StockPortfolioSourceOk, key: "top_gainers" | "top_losers"): SourceTopPosition[] {
  const summary = source.payload.positions_summary;
  if (!isRecord(summary) || !Array.isArray(summary[key])) return [];
  return summary[key]
    .filter(isRecord)
    .map((position) => {
      const code = str(position.code, "UNKNOWN");
      const name = str(position.name, "UNKNOWN");
      const currency = str(position.currency, "CNY").toUpperCase();
      const pnl = positionPnl(position);
      if (pnl === undefined) return undefined;
      const candidate: SourceTopPosition = {
        provider: source.provider,
        config: source.config,
        label: source.label,
        code,
        name,
        instrument_type: inferInstrumentType(code, name, position.instrument_type),
        source_currency: currency,
        pnl,
        pnl_ratio: num(position.pnl_ratio),
      };
      return candidate;
    })
    .filter((position): position is SourceTopPosition => position !== undefined);
}

function categoryValue(value: unknown): AssetAllocationCategory | undefined {
  if (
    value === "bond" ||
    value === "foreign_index" ||
    value === "domestic_index" ||
    value === "gold" ||
    value === "cash" ||
    value === "stock" ||
    value === "other"
  ) {
    return value;
  }
  return undefined;
}

function sourceAssetSummary(source: StockPortfolioSourceOk): Record<string, unknown> | undefined {
  return isRecord(source.payload.asset_summary) ? source.payload.asset_summary : undefined;
}

function sourceAccountAlias(source: StockPortfolioSourceOk): string | undefined {
  const snapshot = isRecord(source.payload.snapshot) ? source.payload.snapshot : undefined;
  return str(snapshot?.account_alias, source.label ?? "");
}

const LLM_CLASSIFICATION_GUIDANCE: StockPortfolioClassificationGuidance = {
  mode: "llm",
  categories: [
    {
      category: "domestic_index",
      label: "国内指数",
      description: "A股、港股、中国相关宽基/行业/主题指数 ETF 或指数基金；例如 HS300ETF、银行ETF、恒生/国企/中证/沪深相关 ETF。",
    },
    {
      category: "foreign_stock",
      label: "国外个股",
      description: "非中国公司的单一股票或股票型持仓；例如美国、欧洲、日本等市场的公司股票。",
    },
    {
      category: "foreign_index",
      label: "国外指数",
      description: "跟踪非中国市场、国家、地区或海外宽基/行业指数的 ETF 或指数基金；例如 德国ETF、法国ETF、纳指/标普/道指相关 ETF。",
    },
    {
      category: "domestic_stock",
      label: "国内个股",
      description: "A股、港股、中国公司或中概相关的单一股票持仓。",
    },
    {
      category: "bond",
      label: "债券",
      description: "债券、国债、政金债、信用债、可转债、债券 ETF 或固定收益类持仓。",
    },
    {
      category: "gold",
      label: "黄金",
      description: "黄金、黄金 ETF、黄金基金或明确跟踪黄金价格的持仓。",
    },
  ],
  cash_handling: "现金不进入上述六类投资分类，应单独展示为现金。",
  instructions: [
    "Classify holdings from asset_summary.holdings_for_classification by code and name.",
    "Do not use asset_summary.by_category as the final classification; it is only a deterministic pre-bucket and may be wrong for cross-market ETFs.",
    "Use CNY fields only for reportable money values.",
    "If a holding is ambiguous, choose the closest category and mention the uncertainty briefly.",
  ],
};

function nestedSourceCurrency(payload: Record<string, unknown>): string | undefined {
  const assetSummary = isRecord(payload.asset_summary) ? payload.asset_summary : undefined;
  const positionsSummary = isRecord(payload.positions_summary) ? payload.positions_summary : undefined;
  const pnlSummary = isRecord(positionsSummary?.pnl_summary) ? positionsSummary.pnl_summary : undefined;
  const snapshot = isRecord(payload.snapshot) ? payload.snapshot : undefined;
  const currency = str(assetSummary?.currency, str(pnlSummary?.currency, str(snapshot?.currency)));
  return currency ? currency.toUpperCase() : undefined;
}

function sourcePnlSummaryCnyForReport(
  source: StockPortfolioSourceOk,
  config: StockPortfolioProviderConfig,
): Record<string, unknown> | undefined {
  const summary = sourcePnlSummary(source);
  if (!summary) return undefined;
  const currency = str(summary.currency, nestedSourceCurrency(source.payload) ?? "CNY").toUpperCase();
  const rate = fxRateFor(currency, config, new Set<string>());
  if (rate === undefined) return undefined;
  const grossProfit = num(summary.gross_profit) ?? 0;
  const grossLoss = num(summary.gross_loss) ?? 0;
  const netPnl = num(summary.net_pnl) ?? grossProfit + grossLoss;
  return {
    source_currency: currency,
    fx_rate_to_cny: rate,
    gross_profit_cny: roundMoney(grossProfit * rate),
    gross_loss_cny: roundMoney(grossLoss * rate),
    net_pnl_cny: roundMoney(netPnl * rate),
    winners_count: num(summary.winners_count) ?? 0,
    losers_count: num(summary.losers_count) ?? 0,
    flat_count: num(summary.flat_count) ?? 0,
    positions_with_pnl_count: num(summary.positions_with_pnl_count) ?? 0,
  };
}

function compactSourcePayloadForCnyReport(
  source: StockPortfolioSourceOk,
  config: StockPortfolioProviderConfig,
): Record<string, unknown> {
  const positionsSummary = isRecord(source.payload.positions_summary) ? source.payload.positions_summary : undefined;
  const warnings = Array.isArray(source.payload.warnings)
    ? source.payload.warnings.filter((item): item is string => typeof item === "string").map(sanitizeStockPortfolioError)
    : undefined;

  return {
    source: str(source.payload.source),
    profile: str(source.payload.profile),
    account_alias: sourceAccountAlias(source),
    market_session: str(source.payload.market_session),
    redaction: str(source.payload.redaction),
    source_currency: nestedSourceCurrency(source.payload),
    positions_count: num(positionsSummary?.positions_count),
    pnl_summary_cny: sourcePnlSummaryCnyForReport(source, config),
    warnings,
    usage_notes: [
      "Nested source monetary fields are intentionally omitted from stock-portfolio asset summaries.",
      "Use aggregate cny_summary and asset_summary fields only; all reportable money amounts are CNY.",
    ],
  };
}

function outputSourcesForConfig(
  sources: StockPortfolioSourceResult[],
  config: StockPortfolioProviderConfig,
): StockPortfolioSourceResult[] {
  if (!config.include_asset_summary) return sources;
  return sources.map((source) => source.status === "ok"
    ? { ...source, payload: compactSourcePayloadForCnyReport(source, config) }
    : source);
}

function buildAssetSummary(
  sources: StockPortfolioSourceResult[],
  config: StockPortfolioProviderConfig,
): StockPortfolioAssetSummary | undefined {
  if (!config.include_asset_summary) return undefined;

  const warnings = new Set<string>();
  const byAccount: StockPortfolioAssetSummary["by_account"] = [];
  const byCategory = new Map<AssetAllocationCategory, StockPortfolioAssetCategorySummary>();
  const holdingsForClassification: StockPortfolioClassifiableHolding[] = [];

  function categoryBucket(category: AssetAllocationCategory): StockPortfolioAssetCategorySummary {
    const existing = byCategory.get(category);
    if (existing) return existing;
    const bucket: StockPortfolioAssetCategorySummary = {
      category,
      label: assetCategoryLabel(category),
      market_value_cny: 0,
      positions_count: 0,
      holdings: [],
    };
    byCategory.set(category, bucket);
    return bucket;
  }

  const okSources = sources.filter((source): source is StockPortfolioSourceOk => source.status === "ok");
  for (const source of okSources) {
    const summary = sourceAssetSummary(source);
    if (!summary) {
      warnings.add(`${source.provider}/${source.config} has no asset_summary; asset allocation may be incomplete`);
      continue;
    }
    const currency = str(summary.currency, "CNY").toUpperCase();
    const rate = fxRateFor(currency, config, warnings);
    if (rate === undefined) continue;

    const totalAssets = num(summary.total_assets);
    const marketValue = num(summary.market_value);
    const cash = num(summary.cash);

    byAccount.push({
      provider: source.provider,
      config: source.config,
      label: source.label,
      account_alias: sourceAccountAlias(source),
      source_currency: currency,
      fx_rate_to_cny: rate,
      total_assets_cny: totalAssets === undefined ? undefined : roundMoney(totalAssets * rate),
      market_value_cny: marketValue === undefined ? undefined : roundMoney(marketValue * rate),
      cash_cny: cash === undefined ? undefined : roundMoney(cash * rate),
    });

    const buckets = Array.isArray(summary.buckets) ? summary.buckets.filter(isRecord) : [];
    for (const rawBucket of buckets) {
      const category = categoryValue(rawBucket.category);
      if (!category) {
        warnings.add(`${source.provider}/${source.config} has unknown asset category: ${String(rawBucket.category)}`);
        continue;
      }
      const value = num(rawBucket.market_value);
      if (value === undefined) continue;
      const convertedValue = roundMoney(value * rate);
      const bucket = categoryBucket(category);
      bucket.market_value_cny = roundMoney(bucket.market_value_cny + convertedValue);
      bucket.positions_count += num(rawBucket.positions_count) ?? 0;

      const holdings = Array.isArray(rawBucket.holdings) ? rawBucket.holdings.filter(isRecord) : [];
      for (const rawHolding of holdings) {
        const holdingValue = num(rawHolding.market_value);
        if (holdingValue === undefined) continue;
        const holdingCategory = categoryValue(rawHolding.category) ?? category;
        const holding: StockPortfolioAssetHolding = {
          provider: source.provider,
          config: source.config,
          source_label: source.label,
          code: str(rawHolding.code, "UNKNOWN"),
          name: str(rawHolding.name, "UNKNOWN"),
          source_currency: str(rawHolding.currency, currency).toUpperCase(),
          category: holdingCategory,
          label: str(rawHolding.label, assetCategoryLabel(holdingCategory)),
          market_value_cny: roundMoney(holdingValue * rate),
          fx_rate_to_cny: rate,
          instrument_type: str(rawHolding.instrument_type) || undefined,
        };
        bucket.holdings.push(holding);
        if (holdingCategory !== "cash") {
          holdingsForClassification.push({
            provider: source.provider,
            config: source.config,
            source_label: source.label,
            code: holding.code,
            name: holding.name,
            source_currency: holding.source_currency,
            market_value_cny: holding.market_value_cny,
            fx_rate_to_cny: holding.fx_rate_to_cny,
            instrument_type: holding.instrument_type,
          });
        }
      }
    }
  }

  const totalAssetsCnyValues = byAccount
    .map((account) => account.total_assets_cny)
    .filter((value): value is number => value !== undefined);
  const totalAssetsCny = totalAssetsCnyValues.length
    ? roundMoney(totalAssetsCnyValues.reduce((sum, value) => sum + value, 0))
    : undefined;
  const marketValueCnyValues = byAccount
    .map((account) => account.market_value_cny)
    .filter((value): value is number => value !== undefined);
  const marketValueCny = marketValueCnyValues.length
    ? roundMoney(marketValueCnyValues.reduce((sum, value) => sum + value, 0))
    : undefined;
  const cashCnyValues = byAccount
    .map((account) => account.cash_cny)
    .filter((value): value is number => value !== undefined);
  const cashCny = cashCnyValues.length
    ? roundMoney(cashCnyValues.reduce((sum, value) => sum + value, 0))
    : undefined;

  const byCategoryRows = [...byCategory.values()]
    .map((bucket) => ({
      ...bucket,
      percentage_of_total_assets_cny: totalAssetsCny && totalAssetsCny !== 0
        ? roundMoney((bucket.market_value_cny / totalAssetsCny) * 100)
        : undefined,
      holdings: bucket.holdings.sort((a, b) => b.market_value_cny - a.market_value_cny),
    }))
    .sort((a, b) => b.market_value_cny - a.market_value_cny);

  return {
    base_currency: config.base_currency,
    fx_rates: Object.fromEntries(Object.entries(config.fx_rates).map(([currency, rate]) => [currency.toUpperCase(), rate])),
    fx_rates_as_of: config.fx_rates_as_of,
    fx_rates_source: config.fx_rates_source,
    total_assets_cny: totalAssetsCny,
    market_value_cny: marketValueCny,
    cash_cny: cashCny,
    by_account: byAccount,
    by_category: byCategoryRows,
    holdings_for_classification: holdingsForClassification.sort((a, b) => b.market_value_cny - a.market_value_cny),
    classification_guidance: LLM_CLASSIFICATION_GUIDANCE,
    warnings: [...warnings],
  };
}

function buildCnySummary(
  sources: StockPortfolioSourceResult[],
  config: StockPortfolioProviderConfig,
): StockPortfolioCnySummary | undefined {
  if (!config.include_cny_summary) return undefined;

  const warnings = new Set<string>();
  const byCurrency = new Map<string, StockPortfolioCurrencyPnlSummary>();
  const topGainers: StockPortfolioCnyPosition[] = [];
  const topLosers: StockPortfolioCnyPosition[] = [];

  const okSources = sources.filter((source): source is StockPortfolioSourceOk => source.status === "ok");
  for (const source of okSources) {
    const summary = sourcePnlSummary(source);
    if (!summary) {
      warnings.add(`${source.provider}/${source.config} has no positions_summary.pnl_summary; CNY totals may be incomplete`);
      continue;
    }
    const currency = str(summary.currency, str(source.payload.snapshot && isRecord(source.payload.snapshot) ? source.payload.snapshot.currency : undefined, "CNY")).toUpperCase();
    const rate = fxRateFor(currency, config, warnings);
    if (rate === undefined) continue;

    const grossProfit = num(summary.gross_profit) ?? 0;
    const grossLoss = num(summary.gross_loss) ?? 0;
    const netPnl = num(summary.net_pnl) ?? grossProfit + grossLoss;
    const current = byCurrency.get(currency) ?? {
      source_currency: currency,
      gross_profit_cny: 0,
      gross_loss_cny: 0,
      net_pnl_cny: 0,
      winners_count: 0,
      losers_count: 0,
      flat_count: 0,
      positions_with_pnl_count: 0,
      fx_rate_to_cny: rate,
    };
    current.gross_profit_cny += grossProfit * rate;
    current.gross_loss_cny += grossLoss * rate;
    current.net_pnl_cny += netPnl * rate;
    current.winners_count += num(summary.winners_count) ?? 0;
    current.losers_count += num(summary.losers_count) ?? 0;
    current.flat_count += num(summary.flat_count) ?? 0;
    current.positions_with_pnl_count += num(summary.positions_with_pnl_count) ?? 0;
    byCurrency.set(currency, current);

    for (const position of [...sourceTopPositions(source, "top_gainers"), ...sourceTopPositions(source, "top_losers")]) {
      const positionRate = fxRateFor(position.source_currency, config, warnings);
      if (positionRate === undefined) continue;
      const converted: StockPortfolioCnyPosition = {
        provider: position.provider,
        config: position.config,
        label: position.label,
        code: position.code,
        name: position.name,
        instrument_type: position.instrument_type,
        source_currency: position.source_currency,
        fx_rate_to_cny: positionRate,
        pnl_cny: roundMoney(position.pnl * positionRate),
        pnl_ratio: position.pnl_ratio,
      };
      if (converted.pnl_cny > 0) topGainers.push(converted);
      else if (converted.pnl_cny < 0) topLosers.push(converted);
    }
  }

  const roundedByCurrency = [...byCurrency.values()]
    .map((item) => ({
      ...item,
      gross_profit_cny: roundMoney(item.gross_profit_cny),
      gross_loss_cny: roundMoney(item.gross_loss_cny),
      net_pnl_cny: roundMoney(item.net_pnl_cny),
    }))
    .sort((a, b) => a.source_currency.localeCompare(b.source_currency));

  const grossProfitCny = roundedByCurrency.reduce((sum, item) => sum + item.gross_profit_cny, 0);
  const grossLossCny = roundedByCurrency.reduce((sum, item) => sum + item.gross_loss_cny, 0);
  const netPnlCny = roundedByCurrency.reduce((sum, item) => sum + item.net_pnl_cny, 0);
  const winnersCount = roundedByCurrency.reduce((sum, item) => sum + item.winners_count, 0);
  const losersCount = roundedByCurrency.reduce((sum, item) => sum + item.losers_count, 0);
  const flatCount = roundedByCurrency.reduce((sum, item) => sum + item.flat_count, 0);
  const positionsWithPnlCount = roundedByCurrency.reduce((sum, item) => sum + item.positions_with_pnl_count, 0);

  return {
    base_currency: config.base_currency,
    fx_rates: Object.fromEntries(Object.entries(config.fx_rates).map(([currency, rate]) => [currency.toUpperCase(), rate])),
    fx_rates_as_of: config.fx_rates_as_of,
    fx_rates_source: config.fx_rates_source,
    gross_profit_cny: roundMoney(grossProfitCny),
    gross_loss_cny: roundMoney(grossLossCny),
    net_pnl_cny: roundMoney(netPnlCny),
    winners_count: winnersCount,
    losers_count: losersCount,
    flat_count: flatCount,
    positions_with_pnl_count: positionsWithPnlCount,
    by_currency: roundedByCurrency,
    top_gainers: topGainers
      .sort((a, b) => b.pnl_cny - a.pnl_cny)
      .slice(0, config.top_movers_limit),
    top_losers: topLosers
      .sort((a, b) => a.pnl_cny - b.pnl_cny)
      .slice(0, config.top_movers_limit),
    warnings: [...warnings],
  };
}

export function buildStockPortfolioPayload(params: {
  generatedAt: Date;
  profile: string;
  config: StockPortfolioProviderConfig;
  sources: StockPortfolioSourceResult[];
}): StockPortfolioPayload {
  const failed = params.sources.filter((source) => source.status === "error");
  const cnySummary = buildCnySummary(params.sources, params.config);
  const assetSummary = buildAssetSummary(params.sources, params.config);
  return {
    generated_at: params.generatedAt.toISOString(),
    source: "stock-portfolio",
    profile: params.profile,
    market_scope: params.config.market_scope,
    ok_count: params.sources.length - failed.length,
    failed_count: failed.length,
    sources: outputSourcesForConfig(params.sources, params.config),
    cny_summary: cnySummary,
    asset_summary: assetSummary,
    warnings: [
      ...failed.map((source) => `${source.provider}/${source.config}: ${source.error}`),
      ...(cnySummary?.warnings ?? []),
      ...(assetSummary?.warnings ?? []),
    ],
    usage_notes: [
      "This payload aggregates read-only broker providers for MiniClaw stock reports.",
      params.config.include_asset_summary
        ? "This asset summary is CNY-only for reportable money values. Do not render source-currency amounts; source_currency and fx_rate_to_cny are audit metadata only."
        : "Each nested provider payload is already redacted; do not output account ids, exact total assets, cookies, validate keys, passwords, or trade passwords.",
      "CNY P&L summary is calculated from configured FX rates before the LLM runs; mention fx_rates_as_of/source when reporting converted numbers.",
      "Asset allocation by_category buckets are deterministic pre-buckets only. For final investment classification, group asset_summary.holdings_for_classification with asset_summary.classification_guidance and keep cash separate.",
      "If one broker source failed, use the remaining source data and explicitly mention the missing source without inventing holdings or P&L.",
    ],
  };
}

export function formatStockPortfolioPayload(payload: StockPortfolioPayload): string {
  return JSON.stringify(redactJsonStringValues(payload), null, 2);
}
