import type {
  MarketIntelEvidenceItem,
  MarketIntelMarketSnapshot,
  MarketIntelProviderConfig,
  MarketIntelQuoteClient,
  MarketIntelQuoteRequest,
  MarketIntelQuoteSnapshotInput,
  MarketIntelQuoteWatchBucket,
  MarketIntelSnapshotFailure,
  MarketIntelSnapshotItem,
  MarketIntelSnapshotSection,
  MarketIntelSnapshotSectionStatus,
} from "./market-intel-types.js";
import { sanitizeMarketIntelError } from "./redaction.js";
export { YahooMarketIntelQuoteClient } from "../sources/yahoo/market-intel-client.js";

const PROVIDER_SYMBOL_MAP: Record<string, string> = {
  DXY: "DX-Y.NYB",
  VIX: "^VIX",
  US10Y: "^TNX",
  WTI: "CL=F",
  GOLD: "GC=F",
  CNH: "CNH=X",
  A50: "CN=F",
  HSI_FUTURES: "HSI=F",
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index;
      const current = items[index];
      index += 1;
      if (current !== undefined) out[currentIndex] = await fn(current);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return out;
}

function providerSymbolFor(symbol: string): string | undefined {
  const trimmed = symbol.trim();
  if (!trimmed) return undefined;
  const mapped = PROVIDER_SYMBOL_MAP[trimmed.toUpperCase()];
  if (mapped) return mapped;
  if (/^[A-Z0-9.^=_-]+$/i.test(trimmed) && trimmed === trimmed.toUpperCase()) return trimmed;
  if (/^\d{6}\.(SS|SZ)$/i.test(trimmed)) return trimmed.toUpperCase();
  return undefined;
}

function quoteRequests(config: MarketIntelProviderConfig): MarketIntelQuoteRequest[] {
  const buckets: Array<[MarketIntelQuoteWatchBucket, string[]]> = [
    ["indices", config.watchlists.indices],
    ["sectors", config.watchlists.sectors],
    ["macro", config.watchlists.macro],
    ["cross_market", config.watchlists.cross_market],
    ["symbols", config.watchlists.symbols],
  ];
  const out: MarketIntelQuoteRequest[] = [];
  const seen = new Set<string>();
  for (const [bucket, symbols] of buckets) {
    for (const symbol of symbols) {
      const providerSymbol = providerSymbolFor(symbol);
      const key = `${bucket}:${symbol}`;
      if (!providerSymbol || seen.has(key)) continue;
      seen.add(key);
      out.push({ symbol, provider_symbol: providerSymbol, bucket });
    }
  }
  return out;
}

function skippedFailures(config: MarketIntelProviderConfig, client: MarketIntelQuoteClient): MarketIntelSnapshotFailure[] {
  const buckets: Array<[MarketIntelQuoteWatchBucket, string[]]> = [
    ["indices", config.watchlists.indices],
    ["sectors", config.watchlists.sectors],
    ["macro", config.watchlists.macro],
    ["cross_market", config.watchlists.cross_market],
    ["symbols", config.watchlists.symbols],
  ];
  const failures: MarketIntelSnapshotFailure[] = [];
  for (const [bucket, symbols] of buckets) {
    for (const symbol of symbols) {
      if (providerSymbolFor(symbol)) continue;
      failures.push({
        symbol,
        bucket,
        source: client.source,
        source_tier: client.source_tier,
        error: "watchlist item has no quote provider symbol mapping yet",
        skipped: true,
      });
    }
  }
  return failures;
}

function changePct(latestPrice: number, previousClose?: number): number | undefined {
  if (previousClose === undefined || !Number.isFinite(previousClose) || previousClose === 0) return undefined;
  return Math.round(((latestPrice - previousClose) / previousClose) * 10000) / 100;
}

function freshnessMinutes(runAt: Date, latestAt: string): number | undefined {
  const latest = Date.parse(latestAt);
  if (!Number.isFinite(latest)) return undefined;
  return Math.max(0, Math.round((runAt.getTime() - latest) / 60000));
}

function toSnapshotItem(params: {
  input: MarketIntelQuoteSnapshotInput;
  request: MarketIntelQuoteRequest;
  client: MarketIntelQuoteClient;
  runAt: Date;
  maxStaleMinutes: number;
}): MarketIntelSnapshotItem {
  const freshness = freshnessMinutes(params.runAt, params.input.latest_at);
  return {
    symbol: params.input.symbol,
    provider_symbol: params.input.provider_symbol,
    bucket: params.request.bucket,
    source: params.client.source,
    source_tier: params.client.source_tier,
    captured_at: params.runAt.toISOString(),
    latest_at: params.input.latest_at,
    latest_price: params.input.latest_price,
    previous_close: params.input.previous_close,
    change_pct: changePct(params.input.latest_price, params.input.previous_close),
    currency: params.input.currency,
    freshness_minutes: freshness,
    stale: freshness === undefined ? true : freshness > params.maxStaleMinutes,
  };
}

function sectionStatus(items: MarketIntelSnapshotItem[], failures: MarketIntelSnapshotFailure[]): MarketIntelSnapshotSectionStatus {
  const hardFailures = failures.filter((failure) => !failure.skipped);
  if (!items.length && !hardFailures.length) return "empty";
  if (items.length && !hardFailures.length) return "ok";
  if (items.length) return "partial";
  return "partial";
}

function sectionFor(
  bucket: MarketIntelQuoteWatchBucket,
  items: MarketIntelSnapshotItem[],
  failures: MarketIntelSnapshotFailure[],
): MarketIntelSnapshotSection {
  const bucketItems = items.filter((item) => item.bucket === bucket);
  const bucketFailures = failures.filter((failure) => failure.bucket === bucket);
  const staleCount = bucketItems.filter((item) => item.stale).length;
  return {
    status: sectionStatus(bucketItems, bucketFailures),
    items: bucketItems,
    failures: bucketFailures,
    notes: [
      staleCount ? `${staleCount} quote item(s) are stale.` : "No stale quote items in this section.",
      bucketFailures.some((failure) => failure.skipped)
        ? "Some watchlist labels are not mapped to quote provider symbols yet."
        : "All mapped quote requests were attempted.",
    ],
  };
}

function quoteEvidence(args: {
  runAt: Date;
  snapshot: MarketIntelMarketSnapshot;
  client: MarketIntelQuoteClient;
}): MarketIntelEvidenceItem[] {
  const sections: Array<[MarketIntelQuoteWatchBucket, MarketIntelSnapshotSection]> = [
    ["indices", args.snapshot.indices],
    ["sectors", args.snapshot.sectors],
    ["macro", args.snapshot.macro],
    ["cross_market", args.snapshot.cross_market],
    ["symbols", args.snapshot.symbols],
  ];
  return sections
    .filter(([, section]) => section.items.length > 0)
    .map(([bucket, section], index) => ({
      id: `quote.${bucket}.${index + 1}`,
      category: "quote" as const,
      source: args.client.source,
      source_tier: args.client.source_tier,
      captured_at: args.runAt.toISOString(),
      summary: `${bucket} quote snapshot: items=${section.items.length}; failures=${section.failures.filter((failure) => !failure.skipped).length}; stale=${section.items.filter((item) => item.stale).length}.`,
    }));
}

export function buildEmptyMarketIntelSnapshot(): MarketIntelMarketSnapshot {
  const empty = (note: string): MarketIntelSnapshotSection => ({
    status: "empty",
    items: [],
    failures: [],
    notes: [note],
  });
  return {
    indices: empty("Quote collection skipped."),
    sectors: empty("Quote collection skipped."),
    macro: empty("Quote collection skipped."),
    cross_market: empty("Quote collection skipped."),
    symbols: empty("Quote collection skipped."),
  };
}

export async function collectMarketIntelMarketSnapshot(params: {
  args: { runAt: Date };
  config: MarketIntelProviderConfig;
  client: MarketIntelQuoteClient;
}): Promise<{
  snapshot: MarketIntelMarketSnapshot;
  evidence: MarketIntelEvidenceItem[];
  warnings: string[];
}> {
  const requests = quoteRequests(params.config);
  const skipped = skippedFailures(params.config, params.client);
  const warnings: string[] = [];
  if (params.client.source === "yahoo_chart_unofficial") {
    warnings.push("quotes: using Yahoo chart as fallback-only source; do not treat quote-derived conclusions as high-confidence without cross-checks.");
  }

  const results = await mapLimit(requests, 4, async (request): Promise<{ item?: MarketIntelSnapshotItem; failure?: MarketIntelSnapshotFailure }> => {
    try {
      const input = await params.client.getSnapshot(request);
      return {
        item: toSnapshotItem({
          input,
          request,
          client: params.client,
          runAt: params.args.runAt,
          maxStaleMinutes: params.config.quality.max_stale_minutes.quote,
        }),
      };
    } catch (err) {
      return {
        failure: {
          symbol: request.symbol,
          provider_symbol: request.provider_symbol,
          bucket: request.bucket,
          source: params.client.source,
          source_tier: params.client.source_tier,
          error: sanitizeMarketIntelError(err),
          skipped: false,
        },
      };
    }
  });

  const items = results.map((result) => result.item).filter((item): item is MarketIntelSnapshotItem => item !== undefined);
  const failures = [
    ...skipped,
    ...results.map((result) => result.failure).filter((failure): failure is MarketIntelSnapshotFailure => failure !== undefined),
  ];
  const hardFailures = failures.filter((failure) => !failure.skipped);
  if (requests.length > 0 && items.length === 0 && params.config.quality.fail_if_all_quotes_fail) {
    const detail = hardFailures.map((failure) => `${failure.symbol}: ${failure.error}`).join("; ");
    throw new Error(`market-intel quote collection failed: all mapped quote requests failed${detail ? `: ${detail}` : ""}`);
  }

  const snapshot: MarketIntelMarketSnapshot = {
    indices: sectionFor("indices", items, failures),
    sectors: sectionFor("sectors", items, failures),
    macro: sectionFor("macro", items, failures),
    cross_market: sectionFor("cross_market", items, failures),
    symbols: sectionFor("symbols", items, failures),
  };
  for (const item of items) {
    if (item.stale) warnings.push(`quotes: ${item.symbol} is stale (${item.freshness_minutes ?? "unknown"} minutes old)`);
  }
  for (const failure of hardFailures) {
    warnings.push(`quotes: ${failure.symbol} failed: ${failure.error}`);
  }
  return {
    snapshot,
    evidence: quoteEvidence({ runAt: params.args.runAt, snapshot, client: params.client }),
    warnings,
  };
}
