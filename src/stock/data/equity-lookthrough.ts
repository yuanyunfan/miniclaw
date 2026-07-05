import type {
  StockPortfolioAssetSummary,
  StockPortfolioClassifiableHolding,
  StockPortfolioEquityLookthroughConstituentConfig,
  StockPortfolioEquityLookthroughRow,
  StockPortfolioEquityLookthroughSourceConfig,
  StockPortfolioEquityLookthroughSourceContribution,
  StockPortfolioEquityLookthroughSummary,
  StockPortfolioProviderConfig,
} from "./portfolio-types.js";

const DIRECT_SOURCE_LABEL = "直接";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

function textOf(holding: StockPortfolioClassifiableHolding): string {
  return `${holding.code} ${holding.name} ${holding.instrument_type ?? ""}`.toUpperCase();
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeCodeToken(code: string): string {
  const upper = code.trim().toUpperCase();
  return upper
    .replace(/^US\./, "")
    .replace(/^HK\./, "")
    .replace(/^SH\./, "")
    .replace(/^SZ\./, "")
    .replace(/\.SS$/, "")
    .replace(/\.SZ$/, "");
}

function codeTokens(code: string): string[] {
  return code
    .split(/[，,;/|]/)
    .map(normalizeCodeToken)
    .filter(Boolean);
}

function companyKeyForCode(code: string): string {
  return codeTokens(code)[0] ?? normalizeCodeToken(code);
}

function displayCodeForHolding(code: string): string {
  const normalized = normalizeCodeToken(code);
  return normalized || code.trim();
}

function companyKeyForConstituent(item: StockPortfolioEquityLookthroughConstituentConfig): string {
  return (item.company_key?.trim() || companyKeyForCode(item.code)).toUpperCase();
}

function allConstituentCodes(item: StockPortfolioEquityLookthroughConstituentConfig): string[] {
  return [...codeTokens(item.code), ...item.aliases.flatMap(codeTokens)];
}

function buildConstituentCatalog(sources: StockPortfolioEquityLookthroughSourceConfig[]): Map<string, {
  key: string;
  company: string;
  code: string;
}> {
  const catalog = new Map<string, { key: string; company: string; code: string }>();
  for (const source of sources) {
    for (const alias of source.company_aliases) {
      const item = { key: alias.company_key.toUpperCase(), company: alias.company, code: alias.code };
      catalog.set(item.key, item);
      for (const code of [alias.code, ...alias.aliases].flatMap(codeTokens)) {
        catalog.set(code, item);
      }
    }
    for (const constituent of source.constituents) {
      const key = companyKeyForConstituent(constituent);
      const item = { key, company: constituent.company, code: constituent.code };
      catalog.set(key, item);
      for (const code of allConstituentCodes(constituent)) {
        catalog.set(code, item);
      }
    }
  }
  return catalog;
}

function sourceMatchesHolding(source: StockPortfolioEquityLookthroughSourceConfig, holding: StockPortfolioClassifiableHolding): boolean {
  const holdingCodes = new Set(codeTokens(holding.code));
  if (source.match_codes.some((code) => codeTokens(code).some((token) => holdingCodes.has(token)))) return true;

  const name = `${holding.code} ${holding.name}`.toUpperCase();
  return source.match_names.some((needle) => {
    const normalized = needle.trim().toUpperCase();
    return normalized ? name.includes(normalized) : false;
  });
}

function isLikelyBondOrGold(holding: StockPortfolioClassifiableHolding): boolean {
  const text = textOf(holding);
  return hasAny(text, [
    /黄金|GOLD|GLD|IAU|SGOL/,
    /\b518880\b|\b518800\b|\b159934\b|\b159937\b/,
    /债|BOND|TREASURY|GOVT|国债|政金债|信用债|可转债|城投|中债/,
    /\bTLT\b|\bIEF\b|\bSHY\b|\bBND\b|\bAGG\b|\bLQD\b|\bHYG\b/,
  ]);
}

function isLikelyEquityIndex(holding: StockPortfolioClassifiableHolding): boolean {
  if (holding.category === "foreign_index" || holding.category === "domestic_index") return true;
  const text = textOf(holding);
  return hasAny(text, [
    /纳斯达克|纳指|NASDAQ|标普|S&P|SP500|道琼|DOW|MSCI|RUSSELL|罗素|日经|NIKKEI|德国|法国|欧洲|印度/,
    /沪深|中证|上证|深证|创业板|科创|恒生|国企|A50|CSI|HSI|HSTECH|HANG SENG|盈富|TRACKER FUND/,
    /\bQQQ\b|\bSPY\b|\bVOO\b|\bIVV\b|\bDIA\b|\bVTI\b|\bVT\b|\bIWM\b|\bEFA\b|\bEEM\b/,
    /\b510300\b|\b510310\b|\b510500\b|\b512800\b|\b515080\b|\b159919\b|\b159915\b|\b159920\b|\b159338\b|\b159530\b|\b588000\b|\b588080\b/,
    /\bHK\.02800\b|\bHK\.02828\b|\bHK\.03033\b/,
  ]);
}

function isDirectEquityHolding(
  holding: StockPortfolioClassifiableHolding,
  matchedLookthroughSources: StockPortfolioEquityLookthroughSourceConfig[],
): boolean {
  if (matchedLookthroughSources.length) return false;
  if (holding.category === "stock" || holding.instrument_type === "stock") return !isLikelyBondOrGold(holding);
  if (holding.instrument_type === "etf") return false;
  if (isLikelyEquityIndex(holding)) return false;
  return !isLikelyBondOrGold(holding);
}

function isStockPosition(
  holding: StockPortfolioClassifiableHolding,
  matchedLookthroughSources: StockPortfolioEquityLookthroughSourceConfig[],
  isDirect: boolean,
): boolean {
  if (isDirect || matchedLookthroughSources.length) return true;
  return isLikelyEquityIndex(holding);
}

interface PendingLookthroughRow {
  key: string;
  company: string;
  code: string;
  amount: number;
  sources: Map<string, number>;
}

function sourceLabelSortValue(label: string): number {
  return label === DIRECT_SOURCE_LABEL ? -1 : 0;
}

function addContribution(
  rows: Map<string, PendingLookthroughRow>,
  params: {
    key: string;
    company: string;
    code: string;
    sourceLabel: string;
    amount: number;
  },
): void {
  if (!Number.isFinite(params.amount) || params.amount <= 0) return;
  const existing = rows.get(params.key) ?? {
    key: params.key,
    company: params.company,
    code: params.code,
    amount: 0,
    sources: new Map<string, number>(),
  };
  existing.amount = roundMoney(existing.amount + params.amount);
  existing.sources.set(params.sourceLabel, roundMoney((existing.sources.get(params.sourceLabel) ?? 0) + params.amount));
  rows.set(params.key, existing);
}

function rowSources(row: PendingLookthroughRow): StockPortfolioEquityLookthroughSourceContribution[] {
  return [...row.sources.entries()]
    .map(([label, amount]) => ({ label, amount_cny: roundMoney(amount) }))
    .sort((a, b) => sourceLabelSortValue(a.label) - sourceLabelSortValue(b.label) || b.amount_cny - a.amount_cny || a.label.localeCompare(b.label));
}

export function buildEquityLookthroughSummary(
  summary: StockPortfolioAssetSummary | undefined,
  config: StockPortfolioProviderConfig,
): StockPortfolioEquityLookthroughSummary | undefined {
  if (!config.include_equity_lookthrough_summary) return undefined;
  if (!summary) return undefined;

  const warnings = new Set<string>();
  const catalog = buildConstituentCatalog(config.equity_lookthrough_sources);
  const rows = new Map<string, PendingLookthroughRow>();
  let stockPositionCny = 0;
  let expandedAmountCny = 0;

  for (const holding of summary.holdings_for_classification) {
    if (!Number.isFinite(holding.market_value_cny) || holding.market_value_cny <= 0) continue;
    const matchedSources = config.equity_lookthrough_sources.filter((source) => sourceMatchesHolding(source, holding));
    const isDirect = isDirectEquityHolding(holding, matchedSources);
    if (isStockPosition(holding, matchedSources, isDirect)) {
      stockPositionCny = roundMoney(stockPositionCny + holding.market_value_cny);
    }

    if (isDirect) {
      const holdingCodes = codeTokens(holding.code);
      const catalogEntry = holdingCodes.map((code) => catalog.get(code)).find(Boolean);
      const key = catalogEntry?.key ?? companyKeyForCode(holding.code);
      addContribution(rows, {
        key,
        company: catalogEntry?.company ?? holding.name,
        code: catalogEntry?.code ?? displayCodeForHolding(holding.code),
        sourceLabel: DIRECT_SOURCE_LABEL,
        amount: holding.market_value_cny,
      });
      expandedAmountCny = roundMoney(expandedAmountCny + holding.market_value_cny);
      continue;
    }

    if (!matchedSources.length) {
      if (isLikelyEquityIndex(holding)) {
        warnings.add(`${holding.code} ${holding.name} is an equity index/ETF holding but has no equity_lookthrough_sources match; it is included in stock_position_cny but not expanded into single-stock rows.`);
      }
      continue;
    }

    for (const source of matchedSources) {
      for (const constituent of source.constituents) {
        const key = companyKeyForConstituent(constituent);
        const amount = roundMoney(holding.market_value_cny * constituent.weight_pct / 100);
        addContribution(rows, {
          key,
          company: constituent.company,
          code: constituent.code,
          sourceLabel: source.label,
          amount,
        });
        expandedAmountCny = roundMoney(expandedAmountCny + amount);
      }
    }
  }

  const totalAssets = summary.total_assets_cny;
  const rankedRows: StockPortfolioEquityLookthroughRow[] = [...rows.values()]
    .sort((a, b) => b.amount - a.amount || a.company.localeCompare(b.company))
    .slice(0, config.equity_lookthrough_top_limit)
    .map((row, index) => {
      const sources = rowSources(row);
      return {
        rank: index + 1,
        company_key: row.key,
        company: row.company,
        code: row.code,
        lookthrough_amount_cny: roundMoney(row.amount),
        percentage_of_total_assets_cny: totalAssets && totalAssets !== 0
          ? roundPct(row.amount / totalAssets * 100)
          : undefined,
        percentage_of_stock_position_cny: stockPositionCny
          ? roundPct(row.amount / stockPositionCny * 100)
          : undefined,
        source_labels: sources.map((source) => source.label),
        sources,
      };
    });

  return {
    base_currency: summary.base_currency,
    total_assets_cny: totalAssets,
    stock_position_cny: stockPositionCny,
    expanded_amount_cny: expandedAmountCny,
    expanded_stock_position_percentage: stockPositionCny ? roundPct(expandedAmountCny / stockPositionCny * 100) : undefined,
    top_limit: config.equity_lookthrough_top_limit,
    rows: rankedRows,
    warnings: [...warnings],
    usage_notes: [
      "equity_lookthrough_summary combines direct single-stock holdings with configured ETF/index constituent weights.",
      "percentage_of_total_assets_cny uses asset_summary.total_assets_cny as denominator when available.",
      "percentage_of_stock_position_cny uses direct equity plus likely equity index/ETF market value as denominator; unconfigured equity ETFs remain in the denominator but are not assigned to row-level companies.",
      "Rows are sorted by lookthrough_amount_cny descending; use source_labels for the main source column.",
    ],
  };
}
